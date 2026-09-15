import { localDay, type ContentIndex, type Localized } from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { getKv, setKv } from "../db.ts";
import { getLocale, plural, t } from "../i18n/index.ts";
import { useTutorAccess } from "./access.ts";
import { Composer, GateActions, MessageList, TutorGate } from "./ChatView.tsx";
import { getConversation, startConversation, type ConversationStart } from "./client.ts";
import { contentGlossary } from "./glossary.ts";
import { glossesFrom, messagesFromDto, messagesFromStart, useConversation, type ChatMessage } from "./use-conversation.ts";
/** Conversation libre guidée avec Cô Mai (spec §5.7, contrat phase 3 §1). */

const LAST_KEY = "tutor.lastConversation";
interface LastConversation {
  id: string;
  date: string;
}

/** Ouvertures reçues à la création, lues par l'écran de conversation (évite un GET inutile). */
const openings = new Map<string, ConversationStart>();

export function BackHome() {
  return (
    <Link to="/" className="-ml-2 flex min-h-11 items-center gap-1 self-start px-2 text-ngoc">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {t("tutor.back")}
    </Link>
  );
}

export function TutorStartPage() {
  const access = useTutorAccess();
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "starting" | "resting" | "error">("idle");
  const [last, setLast] = useState<LastConversation | null>(null);

  useEffect(() => {
    void getKv<LastConversation | null>(LAST_KEY, null).then((value) => setLast(value && value.date === localDay(new Date()) ? value : null));
  }, []);

  const start = async () => {
    setState("starting");
    try {
      const started = await startConversation({ locale: getLocale(), mode: "free" });
      openings.set(started.conversationId, started);
      await setKv<LastConversation>(LAST_KEY, { id: started.conversationId, date: localDay(new Date()) });
      navigate(`/co-mai/${encodeURIComponent(started.conversationId)}`, { replace: true });
    } catch (error) {
      setState(error instanceof ApiError && error.status === 429 ? "resting" : "error");
    }
  };

  if (access === "loading") return <Screen top={<BackHome />}><div /></Screen>;
  if (access !== "ok") {
    return (
      <Screen top={<BackHome />} action={<GateActions reason={access} />}>
        <TutorGate reason={access} />
      </Screen>
    );
  }

  return (
    <Screen
      top={<BackHome />}
      action={
        <div className="flex flex-col gap-2">
          <Button onClick={() => void start()} disabled={state === "starting" || state === "resting"}>
            {state === "starting" ? t("tutor.thinking") : t("tutor.start.cta")}
          </Button>
          {last && (
            <Button variant="quiet" onClick={() => navigate(`/co-mai/${encodeURIComponent(last.id)}`)}>
              {t("tutor.start.resume")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-1 flex-col justify-center gap-4" data-testid="tutor-start">
        <h1 className="font-serif text-2xl">{t("tutor.start.title")}</h1>
        <p className="text-lg">{t("tutor.start.body")}</p>
        <p className="text-phu-sa">{t("tutor.start.rules")}</p>
        {state === "resting" && <p className="border-l-4 border-nghe pl-3" role="status">{t("tutor.chat.resting")} {t("tutor.chat.restingHint")}</p>}
        {state === "error" && <p className="text-son-mai" role="alert">{t("tutor.start.error")}</p>}
      </div>
    </Screen>
  );
}

interface Loaded {
  initial: ChatMessage[];
  glosses: Map<string, Localized>;
  ended: boolean;
}

export function ConversationPage({ content }: { content: ContentIndex }) {
  const { conversationId = "" } = useParams();
  const access = useTutorAccess();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (access !== "ok" || loaded) return;
    const opening = openings.get(conversationId);
    if (opening) {
      setLoaded({ initial: messagesFromStart(opening), glosses: glossesFrom(opening.opening.glosses), ended: false });
      return;
    }
    let cancelled = false;
    getConversation(conversationId)
      .then((dto) => {
        if (cancelled) return;
        setLoaded({ initial: messagesFromDto(dto), glosses: glossesFrom(dto.turns.flatMap((turn) => turn.glosses ?? [])), ended: dto.endedAt !== null });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [access, conversationId, loaded]);

  if (access === "loading") return <Screen top={<BackHome />}><div /></Screen>;
  if (access !== "ok") {
    return (
      <Screen top={<BackHome />} action={<GateActions reason={access} />}>
        <TutorGate reason={access} />
      </Screen>
    );
  }
  if (failed) {
    return (
      <Screen top={<BackHome />} action={<Link to="/co-mai" className="flex min-h-14 items-center justify-center rounded-2xl bg-ngoc text-lg font-semibold text-nuoc">{t("tutor.chat.new")}</Link>}>
        <p className="my-auto text-center text-lg text-phu-sa" role="alert">{t("tutor.chat.loadError")}</p>
      </Screen>
    );
  }
  if (!loaded) return <Screen top={<BackHome />}><p className="my-auto text-center text-phu-sa">{t("tutor.thinking")}</p></Screen>;
  return <Chat key={conversationId} conversationId={conversationId} content={content} loaded={loaded} />;
}

function Chat({ conversationId, content, loaded }: { conversationId: string; content: ContentIndex; loaded: Loaded }) {
  const local = useMemo(() => contentGlossary(content), [content]);
  const chat = useConversation({ conversationId, mode: "free", initial: loaded.initial, initialGlosses: loaded.glosses });
  const glossaries = [chat.glosses, local];
  const closed = loaded.ended || chat.resting;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] md:max-w-[720px]" data-testid="conversation">
      <header className="flex items-center justify-between gap-3">
        <BackHome />
        {chat.remaining !== null && (
          <span className="text-sm text-phu-sa" data-testid="quota">
            {plural("tutor.chat.remaining", "tutor.chat.remaining.plural", chat.remaining)}
          </span>
        )}
      </header>
      <main className="flex flex-1 flex-col pt-2 pb-4">
        <h1 className="sr-only">{t("tutor.start.title")}</h1>
        <MessageList
          messages={chat.messages}
          glossaries={glossaries}
          streaming={chat.streaming}
          onRetry={(m) => {
            chat.dismiss(m.id);
            void chat.send(m.sentences[0] ?? "", "text");
          }}
        />
      </main>
      {closed ? (
        <div className="sticky bottom-0 flex flex-col gap-2 bg-nuoc pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {chat.resting ? (
            <Link to="/revision" className="flex min-h-14 items-center justify-center rounded-2xl bg-ngoc text-lg font-semibold text-nuoc">{t("tutor.chat.review")}</Link>
          ) : (
            <Link to="/co-mai" className="flex min-h-14 items-center justify-center rounded-2xl bg-ngoc text-lg font-semibold text-nuoc">{t("tutor.chat.new")}</Link>
          )}
        </div>
      ) : (
        <Composer disabled={chat.streaming} onSend={(text, mode) => chat.send(text, mode)} />
      )}
    </div>
  );
}
