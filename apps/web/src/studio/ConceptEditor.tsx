import { toneOf, type AudioRef, type Concept, type Tone } from "@parlo/core";
import { useContext, type ReactNode } from "react";
import { CheckboxField, Issues, LocalizedField, Section, SelectField, SmallButton, TextField, withOptional } from "./fields.tsx";
import { st, type StudioKey } from "./i18n.ts";
import { OptionsContext } from "./StepForm.tsx";

const TONES: readonly Tone[] = ["ngang", "huyen", "sac", "hoi", "nga", "nang"];
export const toneName = (tone: Tone) => st(`tone.${tone}` as StudioKey);

/** Ton déduit des accents : un mot d'une syllabe seulement (règle de checkContent). */
export function detectedTone(concept: Pick<Concept, "type" | "vi">): Tone | null {
  const vi = (concept.vi ?? "").trim();
  if (concept.type !== "word" || vi === "" || /\s/.test(vi)) return null;
  return toneOf(vi);
}

export function ConceptEditor({ concept, onChange, recorder }: { concept: Concept; onChange: (c: Concept) => void; recorder: ReactNode }) {
  const { tonal } = useContext(OptionsContext);
  const set = <K extends keyof Concept>(key: K, value: Concept[K]) => onChange({ ...concept, [key]: value });
  const detected = tonal ? detectedTone(concept) : null;

  const setVi = (vi: string) => {
    const next = { ...concept, vi };
    const tone = tonal ? detectedTone(next) : null;
    // Ton suivi automatiquement tant qu'il n'a pas été choisi autrement.
    const before = detectedTone(concept);
    if (tone && (concept.tone === undefined || before === null || concept.tone === before)) next.tone = tone;
    onChange(next);
  };

  const examples = concept.examples ?? [];
  const audio = concept.audio ?? [];
  const setExamples = (list: NonNullable<Concept["examples"]>) => onChange(withOptional(concept, "examples", list));
  const setAudio = (list: AudioRef[]) => set("audio", list);

  return (
    <div className="flex flex-col gap-6">
      <Section title={st("concept.section.word")}>
        <TextField label={st("field.id")} path="id" value={concept.id} readOnly onChange={() => undefined} />
        <SelectField
          label={st("concept.type")}
          path="type"
          value={concept.type}
          options={(["word", "structure", "tone", "sound"] as const).map((t) => ({ value: t, label: st(`concept.type.${t}`) }))}
          onChange={(v) => v && set("type", v)}
        />
        <TextField label={st("concept.vi")} hint={st("concept.vi.hint")} path="vi" value={concept.vi} vi onChange={setVi} />
        {tonal && (
          <div className="flex flex-col gap-1">
            <SelectField
              label={st("concept.tone")}
              path="tone"
              value={concept.tone}
              allowEmpty={st("concept.tone.none")}
              options={TONES.map((t) => ({ value: t, label: toneName(t) }))}
              onChange={(v) => onChange(withOptional(concept, "tone", v))}
            />
            {detected && (
              <p className="text-sm text-phu-sa" data-testid="tone-detected">
                {st("concept.tone.detected", { tone: toneName(detected) })}
                {concept.tone !== detected && (
                  <button type="button" className="ml-2 font-semibold text-ngoc" onClick={() => set("tone", detected)}>
                    {st("concept.tone.use")}
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        <LocalizedField label={st("concept.gloss")} path="gloss" value={concept.gloss} onChange={(v) => set("gloss", v ?? { fr: "" })} />
        <TextField label={`${st("concept.north")} ${st("field.optional")}`} hint={st("concept.north.hint")} path="northernEquivalent" value={concept.northernEquivalent} onChange={(v) => onChange(withOptional(concept, "northernEquivalent", v))} />
        <SelectField
          label={st("concept.register")}
          path="register"
          value={concept.register}
          allowEmpty={st("field.unset")}
          options={(["neutral", "familiar", "formal"] as const).map((r) => ({ value: r, label: st(`concept.register.${r}`) }))}
          onChange={(v) => onChange(withOptional(concept, "register", v))}
        />
        <TextField label={`${st("concept.ipa")} ${st("field.optional")}`} path="ipaSouth" value={concept.ipaSouth} onChange={(v) => onChange(withOptional(concept, "ipaSouth", v))} />
        <TextField label={`${st("concept.image")} ${st("field.optional")}`} hint={st("concept.image.hint")} path="image" value={concept.image} onChange={(v) => onChange(withOptional(concept, "image", v))} />
        <LocalizedField label={st("concept.note")} path="note" optional multiline value={concept.note} onChange={(v) => onChange(withOptional(concept, "note", v))} />
        <CheckboxField label={st("field.reviewed")} hint={st("field.reviewed.hint")} path="reviewed" checked={concept.reviewed === true} onChange={(v) => set("reviewed", v)} />
      </Section>

      <Section title={st("concept.section.examples")}>
        {examples.map((ex, i) => (
          <fieldset key={i} className="flex flex-col gap-2 rounded-2xl border-2 border-phu-sa/10 p-3">
            <legend className="px-1 font-semibold">{st("concept.example", { n: i + 1 })}</legend>
            <TextField label={st("concept.example.vi")} path={`examples.${i}.vi`} value={ex.vi} vi onChange={(v) => setExamples(examples.map((e, k) => (k === i ? { ...e, vi: v } : e)))} />
            <TextField label={st("field.locale.fr")} path={`examples.${i}.fr`} value={ex.fr} onChange={(v) => setExamples(examples.map((e, k) => (k === i ? { ...e, fr: v } : e)))} />
            <TextField label={`${st("field.locale.en")} ${st("field.optional")}`} path={`examples.${i}.en`} value={ex.en} onChange={(v) => setExamples(examples.map((e, k) => (k === i ? withOptional(e, "en", v) : e)))} />
            <TextField label={`${st("concept.example.audio")} ${st("field.optional")}`} path={`examples.${i}.audio`} value={ex.audio} onChange={(v) => setExamples(examples.map((e, k) => (k === i ? withOptional(e, "audio", v) : e)))} />
            <SmallButton tone="danger" onClick={() => setExamples(examples.filter((_, k) => k !== i))}>{st("concept.example.delete")}</SmallButton>
          </fieldset>
        ))}
        <SmallButton onClick={() => setExamples([...examples, { vi: "", fr: "" }])}>{st("concept.example.add")}</SmallButton>
      </Section>

      <Section title={st("concept.section.audio")}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-1 pr-2">{st("audio.voice")}</th>
                <th className="py-1 pr-2">{st("audio.src")}</th>
                <th className="py-1 pr-2">{st("audio.source")}</th>
                <th className="py-1 pr-2">{st("audio.speed")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {audio.map((a, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <label className="sr-only" htmlFor={`audio-${i}-voice`}>{st("audio.voice")}</label>
                    <input id={`audio-${i}-voice`} className="w-full rounded-lg border border-phu-sa/20 bg-white px-2 py-1" value={a.voice} onChange={(e) => setAudio(audio.map((x, k) => (k === i ? { ...x, voice: e.target.value } : x)))} />
                  </td>
                  <td className="py-1 pr-2">
                    <label className="sr-only" htmlFor={`audio-${i}-src`}>{st("audio.src")}</label>
                    <input id={`audio-${i}-src`} className="w-full rounded-lg border border-phu-sa/20 bg-white px-2 py-1 font-mono" value={a.src} onChange={(e) => setAudio(audio.map((x, k) => (k === i ? { ...x, src: e.target.value } : x)))} />
                    <Issues path={`audio.${i}.src`} id={`audio-${i}-src-issues`} />
                  </td>
                  <td className="py-1 pr-2">
                    <label className="sr-only" htmlFor={`audio-${i}-source`}>{st("audio.source")}</label>
                    <select id={`audio-${i}-source`} className="rounded-lg border border-phu-sa/20 bg-white px-2 py-1" value={a.source} onChange={(e) => setAudio(audio.map((x, k) => (k === i ? { ...x, source: e.target.value as AudioRef["source"] } : x)))}>
                      <option value="native">{st("audio.source.native")}</option>
                      <option value="tts">{st("audio.source.tts")}</option>
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <label className="sr-only" htmlFor={`audio-${i}-speed`}>{st("audio.speed")}</label>
                    <select id={`audio-${i}-speed`} className="rounded-lg border border-phu-sa/20 bg-white px-2 py-1" value={a.speed} onChange={(e) => setAudio(audio.map((x, k) => (k === i ? { ...x, speed: e.target.value as AudioRef["speed"] } : x)))}>
                      <option value="natural">{st("audio.speed.natural")}</option>
                      <option value="slow">{st("audio.speed.slow")}</option>
                    </select>
                  </td>
                  <td className="py-1">
                    <button type="button" className="min-h-9 px-2 text-son-mai" onClick={() => setAudio(audio.filter((_, k) => k !== i))}>{st("action.remove")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Issues path="audio" id="field-audio-issues" />
        <SmallButton onClick={() => setAudio([...audio, { voice: "", src: "", source: "native", speed: "natural" }])}>{st("audio.add")}</SmallButton>
        <TextField label={`${st("concept.pitch")} ${st("field.optional")}`} hint={st("concept.pitch.hint")} path="pitch" value={concept.pitch} onChange={(v) => onChange(withOptional(concept, "pitch", v))} />
        {recorder}
      </Section>
    </div>
  );
}
