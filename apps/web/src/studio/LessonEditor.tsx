import type { ContentIndex, Lesson, LessonStep, StepType } from "@parlo/core";
import { useContext, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CheckboxField, Issues, IdListField, LocalizedField, NumberField, Section, SelectField, SmallButton, TextField, IssuesContext, fieldDomId } from "./fields.tsx";
import { st } from "./i18n.ts";
import { StepPreview } from "./Preview.tsx";
import { OptionsContext, retype, StepForm, stepTypeLabel, StepTypeSelect } from "./StepForm.tsx";
import { STEP_TYPES, stepTemplate } from "./templates.ts";

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Liste d'étapes (leçon) ou d'items (section d'examen) : ajout, déplacement, suppression, aperçu. */
export function StepList({ steps, path, types, onChange, preview, itemLabel }: {
  steps: readonly LessonStep[];
  path: string;
  types: readonly StepType[];
  onChange: (steps: LessonStep[]) => void;
  preview: ((index: number) => ReactNode) | null;
  itemLabel: (n: number) => string;
}) {
  const [newType, setNewType] = useState<StepType>(types[0] ?? "listen_pick_text");
  const [open, setOpen] = useState<number | null>(null);
  const issues = useContext(IssuesContext);
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4">
        {steps.map((step, i) => {
          const stepPath = `${path}.${i}`;
          const count = issues.filter((x) => x.level === "error" && (x.path === stepPath || x.path.startsWith(`${stepPath}.`))).length;
          return (
            <li key={i} className="flex flex-col gap-3 rounded-2xl border-2 border-phu-sa/10 bg-white/60 p-4" data-testid={`step-${i}`} id={fieldDomId(stepPath)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {itemLabel(i + 1)} — {stepTypeLabel(step.type)}
                  {count > 0 && <span className="ml-2 text-sm text-son-mai">{st("issues.count.errors", { n: count })}</span>}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <SmallButton onClick={() => onChange(moveItem(steps, i, i - 1))} disabled={i === 0} label={st("step.moveUp.label", { n: i + 1 })}>{st("action.moveUp")}</SmallButton>
                  <SmallButton onClick={() => onChange(moveItem(steps, i, i + 1))} disabled={i === steps.length - 1} label={st("step.moveDown.label", { n: i + 1 })}>{st("action.moveDown")}</SmallButton>
                  {preview && (
                    <SmallButton onClick={() => setOpen(open === i ? null : i)} pressed={open === i} label={st("step.preview.label", { n: i + 1 })}>{st("action.preview")}</SmallButton>
                  )}
                  <SmallButton tone="danger" onClick={() => onChange(steps.filter((_, k) => k !== i))} label={st("step.delete.label", { n: i + 1 })}>{st("action.delete")}</SmallButton>
                </div>
              </div>
              <StepTypeSelect path={`${stepPath}.type`} value={step.type} types={types} onChange={(t) => onChange(steps.map((s, k) => (k === i ? retype(s, t) : s)))} />
              <StepForm step={step} path={stepPath} onChange={(s) => onChange(steps.map((x, k) => (k === i ? s : x)))} />
              <Issues path={stepPath} id={`${fieldDomId(stepPath)}-issues`} />
              {preview && open === i && <div className="border-t border-phu-sa/10 pt-3">{preview(i)}</div>}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <StepTypeSelect label={st("step.new.type")} path={`${path}.new`} value={newType} types={types} onChange={setNewType} />
        </div>
        <SmallButton tone="primary" onClick={() => onChange([...steps, stepTemplate(newType, steps[steps.length - 1])])}>{st("step.add")}</SmallButton>
      </div>
    </div>
  );
}

export function LessonEditor({ code, lesson, onChange, content }: { code: string; lesson: Lesson; onChange: (l: Lesson) => void; content: ContentIndex | null }) {
  const opts = useContext(OptionsContext);
  const set = <K extends keyof Lesson>(key: K, value: Lesson[K]) => onChange({ ...lesson, [key]: value });
  const conceptOptions = opts.concepts.filter((c) => (lesson.concepts ?? []).includes(c.id));
  const steps = Array.isArray(lesson.steps) ? lesson.steps : [];

  return (
    <div className="flex flex-col gap-6">
      <Section title={st("lesson.section.about")}>
        <TextField label={st("field.id")} path="id" value={lesson.id} readOnly onChange={() => undefined} />
        <TextField label={st("lesson.unit")} path="unit" value={lesson.unit} onChange={(v) => set("unit", v)} />
        <SelectField
          label={st("lesson.kind")}
          path="kind"
          value={lesson.kind}
          options={(["lesson", "review", "unit_test"] as const).map((k) => ({ value: k, label: st(`lesson.kind.${k}`) }))}
          onChange={(v) => onChange(v ? { ...lesson, kind: v } : (({ kind: _k, ...rest }) => rest)(lesson))}
        />
        <LocalizedField label={st("lesson.title")} path="title" value={lesson.title} onChange={(v) => set("title", v ?? { fr: "" })} />
        <LocalizedField label={st("lesson.goal")} path="goal" value={lesson.goal} multiline onChange={(v) => set("goal", v ?? { fr: "" })} />
        <NumberField label={st("lesson.minutes")} hint={st("lesson.minutes.hint")} path="estimatedMinutes" value={lesson.estimatedMinutes} onChange={(v) => set("estimatedMinutes", v)} />
        <IdListField label={st("lesson.prerequisites")} path="prerequisites" value={lesson.prerequisites} options={opts.lessons.filter((o) => o.id !== lesson.id)} onChange={(v) => set("prerequisites", v)} />
        <IdListField label={st("lesson.concepts")} hint={st("lesson.concepts.hint")} path="concepts" value={lesson.concepts} options={opts.concepts} onChange={(v) => set("concepts", v)} />
        <IdListField label={st("lesson.srsIntroduce")} hint={st("lesson.srsIntroduce.hint")} path="review.srsIntroduce" value={lesson.review?.srsIntroduce} options={conceptOptions} onChange={(v) => set("review", { srsIntroduce: v })} />
        <CheckboxField label={st("field.reviewed")} hint={st("field.reviewed.hint")} path="reviewed" checked={lesson.reviewed === true} onChange={(v) => set("reviewed", v)} />
      </Section>

      <Section
        title={st("lesson.section.steps", { n: steps.length })}
        actions={
          <Link to={`/studio/${encodeURIComponent(code)}/jouer/${encodeURIComponent(lesson.id)}`} className="min-h-11 rounded-xl border-2 border-ngoc px-3 py-2 font-semibold text-ngoc">
            {st("lesson.play")}
          </Link>
        }
      >
        <StepList
          steps={steps}
          path="steps"
          types={STEP_TYPES}
          itemLabel={(n) => st("step.label", { n })}
          onChange={(next) => set("steps", next)}
          preview={content ? (i) => <StepPreview content={content} lesson={lesson} stepIndex={i} /> : null}
        />
        <Issues path="steps" id="field-steps-issues" />
      </Section>
    </div>
  );
}
