import type { GameId, LessonStep, Localized, StepType } from "@parlo/core";
import { createContext, useContext } from "react";
import { IdField, IdListField, LocalizedField, SelectField, StringListField, TextField, withOptional, type IdOption } from "./fields.tsx";
import { st, type StudioKey } from "./i18n.ts";
import { stepTemplate } from "./templates.ts";

/** Formulaire typé d'une étape de leçon (ou d'un item d'examen), un par type de lesson.schema.json. */

export interface PackOptions {
  concepts: IdOption[];
  culture: IdOption[];
  lessons: IdOption[];
  units: IdOption[];
  variants: IdOption[];
  voices: IdOption[];
  tonal: boolean;
}

export const OptionsContext = createContext<PackOptions>({ concepts: [], culture: [], lessons: [], units: [], variants: [], voices: [], tonal: true });

export const stepTypeLabel = (type: string) => st(`step.${type}` as StudioKey);

const GAMES: readonly GameId[] = ["cho_noi", "karaoke_tonal", "xe_om", "bua_com", "doi_dap", "nho_mat"];

export function StepTypeSelect({ path, value, types, onChange, label }: { path: string; value: StepType | undefined; types: readonly StepType[]; onChange: (t: StepType) => void; label?: string }) {
  const { tonal } = useContext(OptionsContext);
  const options = types.filter((t) => tonal || !["tone_identify", "tone_minimal_pair", "tone_produce"].includes(t)).map((t) => ({ value: t, label: stepTypeLabel(t) }));
  return <SelectField label={label ?? st("step.type")} path={path} value={value} options={options} onChange={(v) => v && onChange(v)} />;
}

export function StepForm({ step, path, onChange }: { step: LessonStep; path: string; onChange: (s: LessonStep) => void }) {
  const opts = useContext(OptionsContext);
  const p = (key: string) => `${path}.${key}`;
  // Chaque branche reconstruit une étape du même type : TypeScript garde la cohérence avec le schéma.
  const hasExplain = step.type !== "culture_card" && step.type !== "match_pairs" && step.type !== "game";
  const explain = hasExplain ? (
    <LocalizedField
      label={st("step.explain")}
      path={p("explain")}
      optional
      multiline
      value={(step as { explain?: Localized }).explain}
      onChange={(v) => onChange(withOptional(step as LessonStep & { explain?: Localized }, "explain", v))}
    />
  ) : null;

  const conceptField = (s: Extract<LessonStep, { concept: string }>) => (
    <IdField label={st("step.concept")} path={p("concept")} value={s.concept} options={opts.concepts} hint={st("step.concept.hint")} onChange={(v) => onChange({ ...s, concept: v ?? "" })} />
  );

  switch (step.type) {
    case "culture_card":
      return <IdField label={st("step.ref")} path={p("ref")} value={step.ref} options={opts.culture} onChange={(v) => onChange({ ...step, ref: v ?? "" })} />;

    case "listen_pick_image":
      return (
        <>
          {conceptField(step)}
          <IdListField label={st("step.distractors.concepts")} hint={st("step.distractors.image.hint")} path={p("distractors")} value={step.distractors} options={opts.concepts} onChange={(v) => onChange({ ...step, distractors: v })} />
          {explain}
        </>
      );

    case "listen_pick_text":
      return (
        <>
          {conceptField(step)}
          <StringListField label={st("step.distractors.text")} hint={st("step.distractors.text.hint")} path={p("distractors")} value={step.distractors} vi onChange={(v) => onChange({ ...step, distractors: v })} />
          {explain}
        </>
      );

    case "listen_transcribe":
      return (
        <>
          {conceptField(step)}
          <StringListField label={st("step.accepted.other")} hint={st("step.accepted.other.hint")} path={p("accepted")} value={step.accepted} vi onChange={(v) => onChange(withOptional(step, "accepted", v))} />
          {explain}
        </>
      );

    case "tone_identify":
    case "tone_produce":
      return (
        <>
          {conceptField(step)}
          {explain}
        </>
      );

    case "speak_repeat":
      return (
        <>
          {conceptField(step)}
          <TextField label={`${st("step.pitchRef")} ${st("field.optional")}`} hint={st("step.pitchRef.hint")} path={p("pitchRef")} value={step.pitchRef} onChange={(v) => onChange(withOptional(step, "pitchRef", v))} />
          {explain}
        </>
      );

    case "tone_minimal_pair":
      return (
        <>
          <StringListField label={st("step.pair")} hint={st("step.pair.hint")} path={p("pair")} value={step.pair} vi onChange={(v) => onChange({ ...step, pair: v })} />
          <IdListField label={st("step.audioConcepts")} hint={st("step.audioConcepts.hint")} path={p("audioConcepts")} value={step.audioConcepts} options={opts.concepts} ordered onChange={(v) => onChange(withOptional(step, "audioConcepts", v))} />
          {explain}
        </>
      );

    case "match_pairs":
      return (
        <>
          <IdListField label={st("step.concepts")} hint={st("step.matchPairs.hint")} path={p("concepts")} value={step.concepts} options={opts.concepts} onChange={(v) => onChange({ ...step, concepts: v })} />
          <SelectField
            label={st("step.mode")}
            path={p("mode")}
            value={step.mode}
            allowEmpty={st("step.mode.default")}
            options={(["audio_text", "text_gloss", "audio_image"] as const).map((m) => ({ value: m, label: st(`step.mode.${m}`) }))}
            onChange={(v) => onChange(withOptional(step, "mode", v))}
          />
        </>
      );

    case "build_sentence":
      return (
        <>
          <TextField label={st("step.target")} path={p("target")} value={step.target} vi onChange={(v) => onChange({ ...step, target: v })} />
          <StringListField
            label={st("step.tokens")}
            hint={st("step.tokens.hint")}
            path={p("tokens")}
            value={step.tokens}
            vi
            onChange={(v) => onChange({ ...step, tokens: v })}
          />
          <button
            type="button"
            className="min-h-11 self-start font-semibold text-ngoc"
            onClick={() => onChange({ ...step, tokens: step.target.replace(/[.,!?;:…]/g, "").split(/\s+/).filter(Boolean) })}
          >
            {st("step.tokens.split")}
          </button>
          <LocalizedField label={st("step.translation")} path={p("translation")} value={step.translation} onChange={(v) => onChange({ ...step, translation: v ?? { fr: "" } })} />
          <IdField label={st("step.audioConcept")} optional path={p("audioConcept")} value={step.audioConcept} options={opts.concepts} onChange={(v) => onChange(withOptional(step, "audioConcept", v))} />
          {explain}
        </>
      );

    case "fill_gap":
      return (
        <>
          <TextField label={st("step.gapText")} hint={st("step.gapText.hint")} path={p("text")} value={step.text} vi onChange={(v) => onChange({ ...step, text: v })} />
          <TextField label={st("step.answer")} path={p("answer")} value={step.answer} vi onChange={(v) => onChange({ ...step, answer: v })} />
          <StringListField label={st("step.options")} hint={st("step.options.hint")} path={p("options")} value={step.options} vi onChange={(v) => onChange({ ...step, options: v })} />
          <LocalizedField label={st("step.translation")} optional path={p("translation")} value={step.translation} onChange={(v) => onChange(withOptional(step, "translation", v))} />
          {explain}
        </>
      );

    case "translate_to_vi":
      return (
        <>
          <LocalizedField label={st("step.source.fr")} path={p("source")} value={step.source} onChange={(v) => onChange({ ...step, source: v ?? { fr: "" } })} />
          <StringListField label={st("step.accepted.vi")} hint={st("step.accepted.hint")} path={p("accepted")} value={step.accepted} vi onChange={(v) => onChange({ ...step, accepted: v })} />
          {explain}
        </>
      );

    case "translate_to_fr":
      return (
        <>
          <TextField label={st("step.source.vi")} path={p("source")} value={step.source} vi onChange={(v) => onChange({ ...step, source: v })} />
          <StringListField label={st("step.accepted.fr")} hint={st("step.accepted.hint")} path={p("accepted.fr")} value={step.accepted.fr} onChange={(v) => onChange({ ...step, accepted: { ...step.accepted, fr: v } })} />
          <StringListField
            label={`${st("step.accepted.en")} ${st("field.optional")}`}
            path={p("accepted.en")}
            value={step.accepted.en}
            onChange={(v) => {
              const accepted: Partial<Record<string, string[]>> = { ...step.accepted };
              if (v.length === 0) delete accepted.en;
              else accepted.en = v;
              onChange({ ...step, accepted: accepted as typeof step.accepted });
            }}
          />
          {explain}
        </>
      );

    case "spot_the_south":
      return (
        <>
          <IdField label={st("step.variant")} hint={st("step.variant.hint")} path={p("variant")} value={step.variant} options={opts.variants} onChange={(v) => onChange({ ...step, variant: v ?? "" })} />
          {explain}
        </>
      );

    case "game": {
      const list = Array.isArray(step.conceptPool);
      return (
        <>
          <SelectField label={st("step.game")} path={p("game")} value={step.game} options={GAMES.map((g) => ({ value: g, label: st(`game.${g}` as StudioKey) }))} onChange={(v) => v && onChange({ ...step, game: v })} />
          <SelectField
            label={st("step.pool")}
            path={p("conceptPool")}
            value={list ? "list" : (step.conceptPool as string)}
            options={(["lesson", "unit", "known", "list"] as const).map((v) => ({ value: v, label: st(`step.pool.${v}`) }))}
            onChange={(v) => onChange({ ...step, conceptPool: v === "list" ? [] : ((v ?? "lesson") as "lesson" | "unit" | "known") })}
          />
          {Array.isArray(step.conceptPool) && (
            <IdListField label={st("step.concepts")} path={p("conceptPool")} value={step.conceptPool} options={opts.concepts} onChange={(v) => onChange({ ...step, conceptPool: v })} />
          )}
        </>
      );
    }
  }
}

/** Changement de type : nouvelle étape du bon type (le concept est gardé quand c'est possible). */
export function retype(step: LessonStep, type: StepType): LessonStep {
  return step.type === type ? step : stepTemplate(type, step);
}
