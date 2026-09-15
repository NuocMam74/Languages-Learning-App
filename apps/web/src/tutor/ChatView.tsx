import type { Localized } from "@parlo/core";
import { usePrefs } from "../prefs.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
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

function TutorMessage({ message, glossaries, speakable }: { message: ChatMessage; glossaries: Glossary[]; speakable: boolean }) {
  const [open, setOpen] = useState<{ key: string; text: string } | null>(null);
  const resting = message.fallback === "quota";
  const gloss: Localized | null = open ? lookupGloss(open.key, ...glossaries) : null;
  const viText = message.sentences.filter(looksVietnamese).join(" ");

  return (
    <div className="flex max-w-[88%] flex-col items-start gap-1.5 self-start" data-testid="tutor-message" data-fallback={message.fallback ?? undefined}>
      <span className="text-sm font-semibold text-ngoc">{t("tutor.name")}</span>
      {resting && message.sentences.length === 0 && (
        <p className="rounded-2xl rounded-tl-md bg-phu-sa/5 px-4 py-2.5 text-lg">{t("tutor.chat.resting")}</p>
      )}
      {message.sentences.map((sentence, i) => {
        const vi = looksVietnamese(sentence) || segmentSentence(sentence, ...glossaries).some((s) => s.key);
        return (
          <p
            key={i}
            {...(vi ? { lang: "vi" } : {})}
            className={`rounded-2xl rounded-tl-md px-4 py-2.5 ${message.fallback ? "bg-phu-sa/5" : "bg-ngoc-sang"} ${vi ? "font-serif text-[1.3rem] leading-[1.55]" : "text-lg"}`}
          >
            {vi && !message.fallback
              ? segmentSentence(sentence, ...glossaries).map((seg, j) =>
                  seg.key ? (
                    <button
                      key={j}
                      type="button"
                      className={`inline cursor-pointer rounded-sm underline decoration-ngoc/50 decoration-dotted decoration-2 underline-offset-[6px] ${open?.key === seg.key ? "bg-nghe/25" : ""}`}
                      aria-expanded={open?.key === seg.key}
                      onClick={() => setOpen(open?.key === seg.key ? null : { key: seg.key!, text: seg.text })}
                    >
                      {seg.text}
                    </button>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  ),
                )
              : sentence}
          </p>
        );
      })}
      {open && gloss && (
        <p className="border-l-4 border-nghe pl-3" role="status" data-testid="gloss">
          <span lang="vi" className="font-serif text-lg">{open.text}</span>
          <span className="text-phu-sa"> — </span>
          {l(gloss)}
        </p>
      )}
      {resting && <p className="text-sm text-phu-sa">{t("tutor.chat.restingHint")}</p>}
      {speakable && viText && !message.fallback && speechOutputSupported() && (
        <p className="flex items-center gap-2 text-sm text-phu-sa">
          <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => speakVietnamese(viText)}>
            {t("tutor.chat.listen")}
          </button>
          <span className="text-phu-sa/70">{t("audio.tts")}</span>
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
      <p {...(vi ? { lang: "vi" } : {})} className={`rounded-2xl rounded-tr-md bg-ngoc px-4 py-2.5 text-nuoc ${vi ? "font-serif text-[1.3rem] leading-[1.55]" : "text-lg"}`}>
        {text}
      </p>
      {message.correction && (
        <div className="max-w-full border-r-4 border-nghe pr-3 text-right" data-testid="correction">
          <p className="text-sm text-phu-sa">{t("tutor.chat.better")}</p>
          <p lang="vi" className="font-serif text-lg">{message.correction.corrected}</p>
          {message.correction.explanation && <p className="text-sm">{message.correction.explanation}</p>}
        </div>
      )}
      {message.failed && (
        <p className="flex items-center gap-3 text-sm text-son-mai" role="alert">
          {t("tutor.chat.failed")}
          {onRetry && (
            <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => onRetry(message)}>
              {t("tutor.chat.retry")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-2 self-start rounded-2xl rounded-tl-md bg-ngoc-sang px-4 py-3" data-testid="typing">
      <span className="sr-only">{t("tutor.chat.typing")}</span>
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden className="size-2 rounded-full bg-ngoc/60 motion-safe:animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />
      ))}
    </div>
  );
}

/** Barre de saisie en bas (zone du pouce) : texte, dictée facultative, envoi. */
export function Composer({ onSend, disabled, placeholder, extra }: {
  onSend: (text: string, inputMode: InputMode) => void | Promise<unknown>;
  disabled: boolean;
  placeholder?: string;
  extra?: ReactNode;
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
    <div className="sticky bottom-0 flex flex-col gap-2 bg-nuoc pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="composer">
      {extra}
      {explain && (
        <div className="flex flex-col gap-2 border-l-4 border-nghe pl-3" data-testid="mic-permission">
          <p className="font-semibold">{t("tutor.voice.title")}</p>
          <p>{t("tutor.voice.body")}</p>
          <p className="text-sm text-phu-sa">{t("tutor.voice.privacy")}</p>
          <div className="flex gap-4">
            <button type="button" className="min-h-11 rounded-xl bg-ngoc px-4 font-semibold text-nuoc" onClick={() => void mic()}>
              {t("tutor.voice.allow")}
            </button>
            <button type="button" className="min-h-11 text-ngoc" onClick={() => setExplain(false)}>
              {t("tutor.voice.later")}
            </button>
          </div>
        </div>
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
          className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border-2 border-phu-sa/15 bg-white px-4 py-2.5 font-serif text-lg leading-normal focus:border-ngoc focus:outline-none"
        />
        {canDictate && (
          <button
            type="button"
            onClick={() => void mic()}
            aria-label={dictation.state === "listening" ? t("tutor.voice.stop") : t("tutor.voice.start")}
            aria-pressed={dictation.state === "listening"}
            className={`grid size-12 shrink-0 place-items-center rounded-full border-2 ${dictation.state === "listening" ? "border-son-mai bg-son-mai text-nuoc" : "border-ngoc/30 text-ngoc"}`}
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
            </svg>
          </button>
        )}
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          aria-label={t("tutor.chat.send")}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-ngoc text-nuoc disabled:bg-phu-sa/25 disabled:text-phu-sa/60"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </div>
  );
}

/** Écran d'explication : invité (compte requis) ou hors ligne. */
export function TutorGate({ reason, children }: { reason: "guest" | "expired" | "offline"; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4" data-testid="tutor-gate" data-reason={reason}>
      <p className="font-serif text-2xl">{t("tutor.name")}</p>
      <p className="text-lg">{t(reason === "offline" ? "tutor.gate.offline" : "tutor.gate.account")}</p>
      {reason !== "offline" && <p className="text-phu-sa">{t("tutor.gate.why")}</p>}
      {children}
    </div>
  );
}

export function GateActions({ reason }: { reason: "guest" | "expired" | "offline" }) {
  if (reason === "offline") return null;
  return (
    <Link
      to={reason === "expired" ? "/connexion" : "/compte"}
      className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc hover:bg-ngoc/90"
    >
      {t(reason === "expired" ? "tutor.gate.login" : "tutor.gate.create")}
    </Link>
  );
}
