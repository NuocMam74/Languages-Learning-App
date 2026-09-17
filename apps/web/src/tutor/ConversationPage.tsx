import { localDay, type ContentIndex, type Localized } from "@parlo/core";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { getKv, setKv } from "../db.ts";
import { Card, Chip, DeltaDawn, EmptyState, Icon, Illustration, Skeleton } from "../design/index.ts";
import { getLocale, plural, t } from "../i18n/index.ts";
import { useTutorAccess } from "./access.ts";
import { Composer, GateActions, MessageList, TutorGate } from "./ChatView.tsx";
import { getConversation, startConversation, type ConversationStart } from "./client.ts";
import { contentGlossary } from "./glossary.ts";
import { glossesFrom, messagesFromDto, messagesFromStart, useConversation, type ChatMessage } from "./use-conversation.ts";
/** Conversation libre guidée avec Cô Mai (spec §5.7, contrat phase 3 §1). */

const LAST_KEY = "tutor.lastConversation";

/** Un lien qui porte l'action principale se lit comme le bouton plein du bas (contrat §1). */
const PRIMARY_LINK =
  "flex min-h-14 w-full items-center justify-center rounded-card bg-ngoc px-6 text-lg font-semibold text-nuoc shadow-card transition-[background-color,transform] hover:bg-ngoc/90 motion-safe:active:scale-[.98]";

interface LastConversation {
  id: string;
  date: string;
}

/** Ouvertures reçues à la création, lues par l'écran de conversation (évite un GET inutile). */
const openings = new Map<string, ConversationStart>();

/** « Retour au parcours » : depuis Cô Mai, on revient sur le parcours de la langue (contrat phase7 §1). */
export function BackHome() {
  return (
    <Link to="/apprendre" className="-ml-2 flex min-h-11 items-center gap-1 self-start rounded-chip px-2 text-ngoc hover:bg-ngoc/8">
      <Icon name="chevronLeft" size={20} />
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

  if (access === "loading") return <Screen top={<BackHome />}><TutorSkeleton /></Screen>;
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
        {/* Seul moment héroïque de l'écran : le delta au lever du jour, posé une fois avant la conversation. */}
        <Card tone="feature" className="flex flex-col gap-3">
          <Illustration className="mx-auto max-w-[15rem]"><DeltaDawn /></Illustration>
          <h1 className="font-serif text-2xl leading-tight">{t("tutor.start.title")}</h1>
          <p className="text-lg">{t("tutor.start.body")}</p>
        </Card>
        <p className="flex items-start gap-2 text-phu-sa">
          <Icon name="info" size={18} className="mt-1 text-ngoc" />
          {t("tutor.start.rules")}
        </p>
        {state === "resting" && (
          <div role="status"><Card tone="notice">{t("tutor.chat.resting")} {t("tutor.chat.restingHint")}</Card></div>
        )}
        {state === "error" && (
          <div role="alert"><Card tone="alert" className="text-son-mai">{t("tutor.start.error")}</Card></div>
        )}
      </div>
    </Screen>
  );
}

/** Lecture d'IndexedDB ou attente du serveur : des barres, jamais un écran blanc (contrat §1). */
function TutorSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-4" aria-hidden>
      <Skeleton className="h-40 w-full" rounded="card" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
    </div>
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

  if (access === "loading") return <Screen top={<BackHome />}><TutorSkeleton /></Screen>;
  if (access !== "ok") {
    return (
      <Screen top={<BackHome />} action={<GateActions reason={access} />}>
        <TutorGate reason={access} />
      </Screen>
    );
  }
  if (failed) {
    return (
      <Screen top={<BackHome />} action={<Link to="/co-mai" className={PRIMARY_LINK}>{t("tutor.chat.new")}</Link>}>
        <div className="my-auto" role="alert">
          <EmptyState art="page" title={t("tutor.chat.loadError")} />
        </div>
      </Screen>
    );
  }
  if (!loaded) {
    return (
      <Screen top={<BackHome />}>
        <p className="pb-3 text-phu-sa" role="status">{t("tutor.thinking")}</p>
        <TutorSkeleton />
      </Screen>
    );
  }
  return <Chat key={conversationId} conversationId={conversationId} content={content} loaded={loaded} />;
}

function Chat({ conversationId, content, loaded }: { conversationId: string; content: ContentIndex; loaded: Loaded }) {
  const local = useMemo(() => contentGlossary(content), [content]);
  const chat = useConversation({ conversationId, mode: "free", initial: loaded.initial, initialGlosses: loaded.glosses });
  const glossaries = [chat.glosses, local];
  const closed = loaded.ended || chat.resting;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:max-w-[720px]" data-testid="conversation">
      <header className="flex items-center justify-between gap-3">
        <BackHome />
        {chat.remaining !== null && (
          // Jeton, pas une mention grise perdue : le quota est un état, il se lit d'un coup d'œil.
          <Chip tone="outline" data-testid="quota">
            {plural("tutor.chat.remaining", "tutor.chat.remaining.plural", chat.remaining)}
          </Chip>
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
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-nuoc pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {chat.resting ? (
            <Link to="/revision" className={PRIMARY_LINK}>{t("tutor.chat.review")}</Link>
          ) : (
            <Link to="/co-mai" className={PRIMARY_LINK}>{t("tutor.chat.new")}</Link>
          )}
        </div>
      ) : (
        <Composer disabled={chat.streaming} onSend={(text, mode) => chat.send(text, mode)} />
      )}
    </div>
  );
}
