import { CULTURE_MAX_WORDS, type ContentIndex, type CultureCard, type Lesson, type Localized } from "@parlo/core";
import { useState } from "react";
import { CheckboxField, Issues, LocalizedField, Section, SmallButton, TextField, withOptional } from "./fields.tsx";
import { st } from "./i18n.ts";
import { StepPreview } from "./Preview.tsx";

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

function Counter({ text }: { text: string }) {
  const n = wordCount(text);
  const over = n > CULTURE_MAX_WORDS;
  return (
    <p className={`text-sm ${over ? "font-semibold text-son-mai" : "text-phu-sa"}`} aria-live="polite" data-testid="word-counter">
      {st("culture.words", { n, max: CULTURE_MAX_WORDS })}
    </p>
  );
}

export function CultureEditor({ card, onChange, content }: { card: CultureCard; onChange: (c: CultureCard) => void; content: ContentIndex | null }) {
  const [preview, setPreview] = useState(false);
  const set = <K extends keyof CultureCard>(key: K, value: CultureCard[K]) => onChange({ ...card, [key]: value });
  const question = card.question ?? { prompt: { fr: "" }, options: [], answer: 0 };
  const setQuestion = (q: CultureCard["question"]) => set("question", q);
  const options = question.options ?? [];

  // Leçon synthétique d'une étape : la carte passe par le même moteur que dans l'app.
  const lesson: Lesson = { id: "studio.preview", unit: "studio", title: card.title, goal: card.title, estimatedMinutes: 2, prerequisites: [], concepts: [], steps: [{ type: "culture_card", ref: card.id }], review: { srsIntroduce: [] }, reviewed: false };

  return (
    <div className="flex flex-col gap-6">
      <Section
        title={st("culture.section.card")}
        actions={content ? <SmallButton onClick={() => setPreview(!preview)} pressed={preview}>{st("action.preview")}</SmallButton> : undefined}
      >
        {preview && content && <StepPreview content={content} lesson={lesson} stepIndex={0} />}
        <TextField label={st("field.id")} path="id" value={card.id} readOnly onChange={() => undefined} />
        <LocalizedField label={st("culture.title")} path="title" value={card.title} onChange={(v) => set("title", v ?? { fr: "" })} />
        <LocalizedField label={st("culture.body")} path="body" value={card.body} multiline onChange={(v) => set("body", v ?? { fr: "" })} counter={(text) => <Counter text={text} />} />
        <TextField label={`${st("culture.vi")} ${st("field.optional")}`} path="vi" value={card.vi} vi onChange={(v) => onChange(withOptional(card, "vi", v))} />
        <TextField label={`${st("culture.audio")} ${st("field.optional")}`} path="audio" value={card.audio} onChange={(v) => onChange(withOptional(card, "audio", v))} />
        <CheckboxField label={st("field.reviewed")} hint={st("field.reviewed.hint")} path="reviewed" checked={card.reviewed === true} onChange={(v) => set("reviewed", v)} />
      </Section>

      <Section title={st("culture.section.question")}>
        <LocalizedField label={st("culture.prompt")} path="question.prompt" value={question.prompt} onChange={(v) => setQuestion({ ...question, prompt: v ?? { fr: "" } })} />
        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium">{st("culture.options")}</legend>
          {options.map((option, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-2xl border-2 border-phu-sa/10 p-3">
              <label className="flex min-h-11 items-center gap-2 font-semibold">
                <input type="radio" name="culture-answer" className="size-5 accent-ngoc" checked={question.answer === i} onChange={() => setQuestion({ ...question, answer: i })} />
                {st("culture.option.correct", { n: i + 1 })}
              </label>
              <LocalizedField label={st("culture.option", { n: i + 1 })} path={`question.options.${i}`} value={option} onChange={(v) => setQuestion({ ...question, options: options.map((o, k) => (k === i ? (v ?? { fr: "" }) : o)) })} />
              {options.length > 2 && (
                <SmallButton
                  tone="danger"
                  onClick={() => setQuestion({ ...question, options: options.filter((_, k) => k !== i), answer: question.answer > i ? question.answer - 1 : question.answer === i ? 0 : question.answer })}
                >
                  {st("culture.option.delete")}
                </SmallButton>
              )}
            </div>
          ))}
          {options.length < 4 && <SmallButton onClick={() => setQuestion({ ...question, options: [...options, { fr: "" } as Localized] })}>{st("culture.option.add")}</SmallButton>}
          <Issues path="question.options" id="field-question-options-issues" />
          <Issues path="question.answer" id="field-question-answer-issues" />
        </fieldset>
        <LocalizedField label={st("culture.explain")} optional multiline path="question.explain" value={question.explain} onChange={(v) => setQuestion(withOptional(question, "explain", v))} />
      </Section>
    </div>
  );
}
