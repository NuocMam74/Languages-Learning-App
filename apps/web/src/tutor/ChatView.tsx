import type { Localized } from "@parlo/core";
import { usePrefs } from "../prefs.ts";
import { useAccountsPossible } from "../api-status.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Card, EmptyState, Icon, SectionTitle } from "../design/index.ts";
import { l, t } from "../i18n/index.ts";
import { lookupGloss, segmentSentence, type Glossary } from "./glossary.ts";
import { micGranted, speakVietnamese, speechInputSupported, speechOutputSupported, useDictation } from "./speech.ts";
import type { InputMode } from "./client.ts";
import type { ChatMessage } from "./use-conversation.ts";

/** Fil de discussion et barre de saisie partagés par la conversation libre et Đối đáp. */

/** Lettres propres au vietnamien (absentes du français) : la phrase est affichée en serif, lang="vi". */
const VI_ONLY = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉĩịìíọỏốồổỗộớờởỡợòóụủũứừửữựúỳýỵỷỹ]/iu;
export const looksVietnamese = (text: string) => VI_ONLY.test(text.normalize("NFC"));

export function MessageList({ messages, glossaries, streaming, onRetry }: {
  messages: readonly ChatMessage[];
  glossaries: Glossary[];
  streaming: boolean;
  onRetry?: (message: ChatMessage) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = messages.reduce((n, m) => n + m.sentences.length + (m.correction ? 1 : 0), 0);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [count, streaming]);

  const last = messages[messages.length - 1];
  const waiting = streaming && last?.role === "tutor";
  return (
    <div className="flex flex-col gap-4" data-testid="chat" aria-live="polite" aria-busy={streaming}>
      {messages.map((m) =>
        m.role === "user" ? (
          <UserMessage key={m.id} message={m} {...(onRetry ? { onRetry } : {})} />
        ) : m.sentences.length > 0 || m.fallback ? (
          <TutorMessage key={m.id} message={m} glossaries={glossaries} speakable={!(streaming && m === last)} />
        ) : null,
      )}
      {waiting && <Typing />}
      <div ref={end} />
    </div>
  );
}

/** Rattache la ponctuation qui suit un mot glosé à ce mot (évite un « ? » orphelin en début de ligne). */
function withAttachedPunctuation(segments: readonly { text: string; key: string | null }[]): { text: string; key: string | null; punct: string }[] {
  const out: { text: string; key: string | null; punct: string }[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (!seg.key && prev?.key) {
      const match = /^\s?[\p{P}\p{S}]+/u.exec(seg.text);
      if (match) {
        // Espace fine avant ? ! : (typographie française) : insécable.
        prev.punct = match[0].replace(/^\s/, "\u00a0");
        const rest = seg.text.slice(match[0].length);
        if (rest) out.push({ text: rest, key: null, punct: "" });
        continue;
      }
    }
    out.push({ ...seg, punct: "" });
  }
  return out;
}

/**
 * Les deux bulles ne se distinguent pas par une nuance mais par leur **nature** : Cô Mai parle
 * depuis une surface posée (blanc cassé, filet fin), l'apprenant depuis un jade dilué. Le rayon
 * généreux vient du système ; seul le coin côté épaule est rentré, pour que la bulle « sorte » de
 * son côté. Le vietnamien reste l'objet visuel : serif, grand, interligne large.
 */
const BUBBLE_TUTOR = "rounded-card rounded-tl-md border border-line bg-surface px-4 py-3 shadow-card";
const BUBBLE_LEARNER = "rounded-card rounded-tr-md bg-ngoc-sang px-4 py-3 text-muc";

function TutorMessage({ message, glossaries, speakable }: { message: ChatMessage; glossaries: Glossary[]; speakable: boolean }) {
  const [open, setOpen] = useState<{ key: string; text: string } | null>(null);
  const resting = message.fallback === "quota";
  const gloss: Localized | null = open ? lookupGloss(open.key, ...glossaries) : null;
  const viText = message.sentences.filter(looksVietnamese).join(" ");

  return (
    <div className="flex max-w-[88%] scroll-mt-4 flex-col items-start gap-1.5 self-start" data-testid="tutor-message" data-fallback={message.fallback ?? undefined}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ngoc">
        <Icon name="tutor" size={16} />
        {t("tutor.name")}
      </span>
      {resting && message.sentences.length === 0 && (
        <p className={`${BUBBLE_TUTOR} text-lg`}>{t("tutor.chat.resting")}</p>
      )}
      {message.sentences.map((sentence, i) => {
        const vi = looksVietnamese(sentence) || segmentSentence(sentence, ...glossaries).some((s) => s.key);
        return (
          <p
            key={i}
            {...(vi ? { lang: "vi" } : {})}
            className={`${BUBBLE_TUTOR} ${message.fallback ? "opacity-80" : ""} ${vi ? "font-serif text-[1.3rem] leading-[1.55]" : "text-lg"}`}
          >
            {vi && !message.fallback
              ? withAttachedPunctuation(segmentSentence(sentence, ...glossaries)).map((seg, j) =>
                  seg.key ? (
                    // Mot + ponctuation collée insécables (« không? » ne se coupe pas avant « ? »).
                    <span key={j} className="whitespace-nowrap">
                      <button
                        type="button"
                        // Cible tactile ≥ 44 px de haut sans changer l'interligne (padding compensé par marge négative).
                        className={`-mx-1.5 -my-1.5 inline cursor-pointer rounded-md px-1.5 py-1.5 underline decoration-ngoc/50 decoration-dotted decoration-2 underline-offset-[6px] ${open?.key === seg.key ? "bg-nghe/25" : ""}`}
                        aria-expanded={open?.key === seg.key}
                        data-gloss-word=""
                        onClick={() => setOpen(open?.key === seg.key ? null : { key: seg.key!, text: seg.text })}
                      >
                        {seg.text}
                      </button>
                      {seg.punct}
                    </span>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  ),
                )
              : sentence}
          </p>
        );
      })}
      {open && gloss && (
        <p role="status" data-testid="gloss" className="rounded-chip border border-nghe/30 bg-surface-nghe px-3 py-2">
          <span lang="vi" className="font-serif text-lg">{open.text}</span>
          <span className="text-phu-sa"> — </span>
          {l(gloss)}
        </p>
      )}
      {resting && <p className="text-sm text-phu-sa">{t("tutor.chat.restingHint")}</p>}
      {speakable && viText && !message.fallback && speechOutputSupported() && (
        <p className="flex items-center gap-2 text-sm text-phu-sa">
          <button type="button" className="flex min-h-11 items-center gap-1.5 rounded-chip px-2 font-semibold text-ngoc hover:bg-ngoc/8" onClick={() => speakVietnamese(viText)}>
            <Icon name="sound" size={18} />
            {t("tutor.chat.listen")}
          </button>
          <span className="text-phu-sa/80">{t("audio.tts")}</span>
        </p>
      )}
    </div>
  );
}

function UserMessage({ message, onRetry }: { message: ChatMessage; onRetry?: (m: ChatMessage) => void }) {
  const text = message.sentences[0] ?? "";
  const vi = looksVietnamese(text);
  return (
    <div className="flex max-w-[88%] flex-col items-end gap-1.5 self-end" data-testid="user-message">
      <p {...(vi ? { lang: "vi" } : {})} className={`${BUBBLE_LEARNER} ${vi ? "font-serif text-[1.3rem] leading-[1.55]" : "text-lg"}`}>
        {text}
      </p>
      {message.correction && (
        // La correction n'est pas une erreur : curcuma dilué, pas de laque (spec §5.8).
        <div className="max-w-full rounded-chip border border-nghe/30 bg-surface-nghe px-3 py-2 text-right" data-testid="correction">
          <p className="text-sm text-phu-sa">{t("tutor.chat.better")}</p>
          <p lang="vi" className="font-serif text-lg">{message.correction.corrected}</p>
          {message.correction.explanation && <p className="text-sm">{message.correction.explanation}</p>}
        </div>
      )}
      {message.failed && (
        <p className="flex items-center gap-3 text-sm text-son-mai" role="alert">
          {t("tutor.chat.failed")}
          {onRetry && (
            <button type="button" className="flex min-h-11 items-center gap-1.5 rounded-chip px-2 font-semibold text-ngoc hover:bg-ngoc/8" onClick={() => onRetry(message)}>
              <Icon name="refresh" size={18} />
              {t("tutor.chat.retry")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Cô Mai réfléchit : jamais une bulle vide — trois points qui respirent, dans sa propre bulle. */
function Typing() {
  return (
    <div className={`flex items-center gap-2 self-start ${BUBBLE_TUTOR}`} data-testid="typing">
      <span className="sr-only">{t("tutor.chat.typing")}</span>
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden className="size-2.5 rounded-full bg-ngoc/50 motion-safe:animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />
      ))}
    </div>
  );
}

/** Barre de saisie en bas (zone du pouce) : texte, dictée facultative, envoi. */
export function Composer({ onSend, disabled, placeholder, extra, onFocus }: {
  onSend: (text: string, inputMode: InputMode) => void | Promise<unknown>;
  disabled: boolean;
  placeholder?: string;
  extra?: ReactNode;
  /** Saisie ouverte (clavier) : Đối đáp y ramène la question de Cô Mai à l'écran. */
  onFocus?: () => void;
}) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  const [explain, setExplain] = useState(false);
  const dictation = useDictation((heard) => {
    setText(heard);
    setVoice(true);
  });
  // Dictée seulement si l'utilisateur l'a activée dans les réglages (audio potentiellement envoyé au navigateur).
  const dictationEnabled = usePrefs((p) => p.dictation);
  const canDictate = dictationEnabled && speechInputSupported();

  const submit = () => {
    const clean = text.trim();
    if (!clean || disabled) return;
    dictation.stop();
    const mode: InputMode = voice ? "voice" : "text";
    setText("");
    setVoice(false);
    void onSend(clean, mode);
  };

  const mic = async () => {
    if (dictation.state === "listening") {
      dictation.stop();
      return;
    }
    if (!explain && !(await micGranted())) {
      setExplain(true);
      return;
    }
    setExplain(false);
    dictation.start();
  };

  return (
    // Filet fin plutôt qu'une ombre : le fil de discussion passe dessous sans qu'on l'écrase.
    <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-nuoc pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="composer">
      {extra}
      {explain && (
        <Card tone="notice" className="flex flex-col gap-2" data-testid="mic-permission">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="mic" size={18} className="text-nghe" />
            {t("tutor.voice.title")}
          </p>
          <p>{t("tutor.voice.body")}</p>
          <p className="text-sm text-phu-sa">{t("tutor.voice.privacy")}</p>
          <div className="flex gap-4">
            <button type="button" className="min-h-11 rounded-chip bg-ngoc px-4 font-semibold text-nuoc transition-transform motion-safe:active:scale-[.98]" onClick={() => void mic()}>
              {t("tutor.voice.allow")}
            </button>
            <button type="button" className="min-h-11 rounded-chip px-3 font-semibold text-ngoc" onClick={() => setExplain(false)}>
              {t("tutor.voice.later")}
            </button>
          </div>
        </Card>
      )}
      {dictation.state === "listening" && <p className="text-sm text-ngoc" role="status">{t("tutor.voice.listening")}</p>}
      {dictation.state === "denied" && <p className="text-sm text-phu-sa" role="status">{t("tutor.voice.denied")}</p>}
      {dictation.state === "error" && <p className="text-sm text-phu-sa" role="status">{t("tutor.voice.error")}</p>}
      {voice && text && dictation.state !== "listening" && <p className="text-sm text-phu-sa">{t("tutor.voice.edit")}</p>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="tutor-input" className="sr-only">{t("tutor.chat.input")}</label>
        <textarea
          id="tutor-input"
          lang="vi"
          // Clavier iOS/Android en français : pas de « correction » des mots vietnamiens.
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          onFocus={onFocus}
          rows={1}
          value={text}
          placeholder={placeholder ?? t("tutor.chat.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-32 min-h-12 min-w-0 flex-1 resize-none rounded-field border border-line-strong bg-surface px-4 py-2.5 font-serif text-lg leading-normal shadow-card placeholder:truncate placeholder:text-base placeholder:text-phu-sa/80 focus:border-ngoc focus:outline-none"
        />
        {canDictate && (
          <button
            type="button"
            onClick={() => void mic()}
            aria-label={dictation.state === "listening" ? t("tutor.voice.stop") : t("tutor.voice.start")}
            aria-pressed={dictation.state === "listening"}
            className={`grid size-12 shrink-0 place-items-center rounded-full border-2 transition-[background-color,transform] motion-safe:active:scale-[.98] ${dictation.state === "listening" ? "border-son-mai bg-son-mai text-nuoc" : "border-ngoc/30 text-ngoc hover:bg-ngoc/8"}`}
          >
            <Icon name="mic" />
          </button>
        )}
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          aria-label={t("tutor.chat.send")}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-ngoc text-nuoc shadow-card transition-[background-color,transform] motion-safe:active:scale-[.98] disabled:bg-phu-sa/25 disabled:text-phu-sa/60 disabled:shadow-none"
        >
          <Icon name="send" size={22} />
        </button>
      </form>
    </div>
  );
}

/**
 * Écran d'explication : invité (compte requis), hors ligne, ou Cô Mai pas encore là. Une barque
 * amarrée plutôt qu'un mur de texte — l'attente se regarde, elle ne se subit pas.
 */
export function TutorGate({ reason, children }: { reason: "guest" | "expired" | "offline" | "soon"; children?: ReactNode }) {
  const soon = reason === "soon";
  const title = t(soon ? "journey.tutor.soon" : reason === "offline" ? "tutor.gate.offline" : "tutor.gate.account");
  const body = soon ? t("journey.tutor.soonHint") : reason === "offline" ? null : t("tutor.gate.why");
  return (
    <div className="flex flex-1 flex-col justify-center gap-4" data-testid="tutor-gate" data-reason={reason}>
      <SectionTitle tone="strong" icon="tutor">{t("tutor.name")}</SectionTitle>
      <EmptyState art="boat" title={title} {...(body ? { body } : {})} />
      {children}
    </div>
  );
}

export function GateActions({ reason }: { reason: "guest" | "expired" | "offline" | "soon" }) {
  // Cô Mai a besoin du serveur : sans lui, proposer un compte ne mène nulle part.
  const accounts = useAccountsPossible();
  if (reason === "offline" || reason === "soon" || !accounts) return null;
  return (
    <Link
      to={reason === "expired" ? "/connexion" : "/compte"}
      className="flex min-h-14 w-full items-center justify-center rounded-card bg-ngoc px-6 text-lg font-semibold text-nuoc shadow-card transition-[background-color,transform] hover:bg-ngoc/90 motion-safe:active:scale-[.98]"
    >
      {t(reason === "expired" ? "tutor.gate.login" : "tutor.gate.create")}
    </Link>
  );
}
