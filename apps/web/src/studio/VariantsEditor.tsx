import type { ExamFile, ExamItem, LexicalVariantEntry, LexicalVariants } from "@parlo/core";
import { EXAM_SKILLS, type ContentIndex, type LessonStep } from "@parlo/core";
import { useContext, useState, type ReactNode } from "react";
import { CheckboxField, IdListField, Issues, LocalizedField, NumberField, Section, SelectField, SmallButton, StringListField, TextField, IssuesContext, withOptional } from "./fields.tsx";
import { st } from "./i18n.ts";
import { StepList } from "./LessonEditor.tsx";
import { StepPreview } from "./Preview.tsx";
import { OptionsContext } from "./StepForm.tsx";
import { EXAM_STEP_TYPES } from "./templates.ts";
import { examLesson, type ExamStep } from "@parlo/core";

/** Tableau Sud / Nord : une entrée à la fois, avec recherche. */
export function VariantsEditor({ file, onChange }: { file: LexicalVariants; onChange: (f: LexicalVariants) => void }) {
  const entries = file.entries ?? [];
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const issues = useContext(IssuesContext);
  const q = query.trim().toLocaleLowerCase("vi");
  const visible = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !q || [entry.id, entry.gloss?.fr ?? "", ...(entry.south ?? []), ...(entry.north ?? [])].some((s) => s.toLocaleLowerCase("vi").includes(q)));
  const current = selected !== null ? entries[selected] : undefined;
  const setEntry = (i: number, entry: LexicalVariantEntry) => onChange({ ...file, entries: entries.map((e, k) => (k === i ? entry : e)) });
  const base = selected !== null ? `entries.${selected}` : "";

  return (
    <div className="flex flex-col gap-6">
      <Section title={st("variants.section")}>
        <p className="text-sm text-phu-sa">{st("variants.hint")}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="variants-search" className="font-medium">{st("variants.search")}</label>
          <input id="variants-search" className="w-full rounded-xl border-2 border-phu-sa/20 bg-white px-3 py-2" value={query} onChange={(e) => setQuery(e.target.value.normalize("NFC"))} />
        </div>
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-xl border border-phu-sa/10 bg-white/60">
          {visible.map(({ entry, index }) => {
            const errors = issues.filter((i) => i.level === "error" && i.path.startsWith(`entries.${index}.`)).length;
            return (
              <li key={index}>
                <button
                  type="button"
                  aria-current={selected === index || undefined}
                  className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left ${selected === index ? "bg-ngoc-sang" : ""}`}
                  onClick={() => setSelected(index)}
                >
                  <span>
                    <span lang="vi" className="font-serif text-lg">{(entry.south ?? []).join(" / ")}</span>
                    <span className="mx-2 text-phu-sa">·</span>
                    <span lang="vi" className="font-serif text-phu-sa">{(entry.north ?? []).join(" / ")}</span>
                    <span className="ml-2 text-sm">{entry.gloss?.fr}</span>
                  </span>
                  {errors > 0 && <span className="text-sm text-son-mai">{st("issues.count.errors", { n: errors })}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <SmallButton
          onClick={() => {
            onChange({ ...file, entries: [...entries, { id: "lv_", gloss: { fr: "" }, south: [""], north: [""], severity: "error", reviewed: false }] });
            setSelected(entries.length);
          }}
        >
          {st("variants.add")}
        </SmallButton>
        <NumberField label={st("variants.version")} path="version" value={file.version} onChange={(v) => onChange({ ...file, version: v })} />
      </Section>

      {current && selected !== null && (
        <Section title={st("variants.entry", { id: current.id })} actions={<SmallButton tone="danger" onClick={() => { onChange({ ...file, entries: entries.filter((_, k) => k !== selected) }); setSelected(null); }}>{st("variants.delete")}</SmallButton>}>
          <TextField label={st("field.id")} path={`${base}.id`} value={current.id} onChange={(v) => setEntry(selected, { ...current, id: v })} />
          <LocalizedField label={st("variants.gloss")} path={`${base}.gloss`} value={current.gloss} onChange={(v) => setEntry(selected, { ...current, gloss: v ?? { fr: "" } })} />
          <StringListField label={st("variants.south")} path={`${base}.south`} value={current.south} vi onChange={(v) => setEntry(selected, { ...current, south: v })} />
          <StringListField label={st("variants.north")} path={`${base}.north`} value={current.north} vi onChange={(v) => setEntry(selected, { ...current, north: v })} />
          <SelectField
            label={st("variants.severity")}
            path={`${base}.severity`}
            value={current.severity}
            options={(["error", "warning", "none"] as const).map((s) => ({ value: s, label: st(`variants.severity.${s}`) }))}
            onChange={(v) => v && setEntry(selected, { ...current, severity: v })}
          />
          <StringListField label={st("variants.exceptions")} hint={st("variants.exceptions.hint")} path={`${base}.exceptions`} value={current.exceptions} vi onChange={(v) => setEntry(selected, withOptional(current, "exceptions", v))} />
          <LocalizedField label={st("variants.note")} optional multiline path={`${base}.note`} value={current.note} onChange={(v) => setEntry(selected, withOptional(current, "note", v))} />
          <CheckboxField label={st("field.reviewed")} path={`${base}.reviewed`} checked={current.reviewed === true} onChange={(v) => setEntry(selected, { ...current, reviewed: v })} />
        </Section>
      )}
    </div>
  );
}

/** Examen : métadonnées et items par section (chaque item est une étape de leçon). */
export function ExamEditor({ exam, onChange, content }: { exam: ExamFile; onChange: (e: ExamFile) => void; content: ContentIndex | null }) {
  const opts = useContext(OptionsContext);
  const set = <K extends keyof ExamFile>(key: K, value: ExamFile[K]) => onChange({ ...exam, [key]: value });
  const sections = exam.sections ?? [];
  const total = sections.reduce((n, s) => n + (s.items?.length ?? 0), 0);

  const preview = (s: number) => (i: number): ReactNode => {
    const item = sections[s]?.items[i];
    if (!content || !item) return null;
    // Leçon synthétique de l'examen (concepts des unités requises) réduite à l'item.
    let lesson;
    try {
      lesson = { ...examLesson(content, exam), steps: [item.step as LessonStep] };
    } catch {
      return null;
    }
    return <StepPreview content={content} lesson={lesson} stepIndex={0} />;
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title={st("exam.section.about")}>
        <TextField label={st("field.id")} path="id" value={exam.id} readOnly onChange={() => undefined} />
        <SelectField label={st("exam.level")} path="level" value={exam.level} options={(["A0", "A1", "A2"] as const).map((v) => ({ value: v, label: v }))} onChange={(v) => v && set("level", v)} />
        <LocalizedField label={st("exam.certificate")} path="certificate" value={exam.certificate} onChange={(v) => set("certificate", v ?? { fr: "" })} />
        <IdListField label={st("exam.units")} path="requiresUnits" value={exam.requiresUnits} options={opts.units} onChange={(v) => set("requiresUnits", v)} />
        <NumberField label={st("exam.duration")} path="durationMinutes" value={exam.durationMinutes} onChange={(v) => set("durationMinutes", v)} />
        <NumberField label={st("exam.threshold")} hint={st("exam.threshold.hint")} step={0.05} path="passThreshold" value={exam.passThreshold} onChange={(v) => set("passThreshold", v)} />
        <NumberField label={st("exam.retry")} path="retryAfterHours" value={exam.retryAfterHours} onChange={(v) => set("retryAfterHours", v)} />
        <CheckboxField label={st("field.reviewed")} hint={st("field.reviewed.hint")} path="reviewed" checked={exam.reviewed === true} onChange={(v) => set("reviewed", v)} />
        <p className="text-sm text-phu-sa">{st("exam.total", { n: total })}</p>
        <Issues path="sections" id="field-sections-issues" />
      </Section>

      {sections.map((section, s) => (
        <Section key={s} title={st("exam.skillTitle", { skill: st(`exam.skill.${section.skill}`), n: section.items?.length ?? 0 })}>
          <SelectField
            label={st("exam.skill")}
            path={`sections.${s}.skill`}
            value={section.skill}
            options={EXAM_SKILLS.map((k) => ({ value: k, label: st(`exam.skill.${k}`) }))}
            onChange={(v) => v && set("sections", sections.map((x, k) => (k === s ? { ...x, skill: v } : x)))}
          />
          <StepList
            steps={(section.items ?? []).map((item) => item.step)}
            path={`sections.${s}.items`}
            types={EXAM_STEP_TYPES}
            itemLabel={(n) => st("exam.item", { n })}
            preview={content ? preview(s) : null}
            onChange={(steps) => {
              const items: ExamItem[] = steps.map((step, i) => {
                const old = section.items?.[i];
                return old?.silent ? { step: step as ExamStep, silent: true } : { step: step as ExamStep };
              });
              set("sections", sections.map((x, k) => (k === s ? { ...x, items } : x)));
            }}
          />
          {(section.items ?? []).some((it) => it.silent) && <p className="text-sm text-phu-sa">{st("exam.silent.some")}</p>}
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{st("exam.silent")}</legend>
            {(section.items ?? []).map((item, i) => (
              <CheckboxField
                key={i}
                label={st("exam.silent.item", { n: i + 1 })}
                path={`sections.${s}.items.${i}.silent`}
                checked={item.silent === true}
                onChange={(v) => set("sections", sections.map((x, k) => (k === s ? { ...x, items: x.items.map((it, j) => (j === i ? (v ? { ...it, silent: true } : { step: it.step }) : it)) } : x)))}
              />
            ))}
          </fieldset>
        </Section>
      ))}
    </div>
  );
}
