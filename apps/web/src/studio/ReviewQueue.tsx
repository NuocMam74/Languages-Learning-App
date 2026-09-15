import { buildContentIndex } from "@parlo/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { playConcept } from "../audio.ts";
import { doubtsFor, generalDoubts, loadDoubts, type DoubtsFile } from "./doubts.ts";
import { SmallButton } from "./fields.tsx";
import { st, type StudioKey } from "./i18n.ts";
import { useStudio } from "./store.ts";
import { getReviewQueue, postReview, type ReviewItem } from "./studio-api.ts";
import { docUrl } from "./Tree.tsx";

/**
 * File de relecture native (contrat phase4 §1 « Relecture native ») : grands caractères, doutes listés,
 * écoute si un audio existe. Clavier : j / k (suivant / précédent), a (approuver), c (demander une correction).
 */

type Verdict = "approve" | "changes";

export function ReviewQueue({ code }: { code: string }) {
  const raw = useStudio((s) => s.raw);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState("");
  const [index, setIndex] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<Record<string, Verdict>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const content = useMemo(() => (raw ? buildContentIndex(raw) : null), [raw]);
  const [doubtsFile, setDoubtsFile] = useState<DoubtsFile>({});

  useEffect(() => {
    let alive = true;
    void loadDoubts(code).then((f) => alive && setDoubtsFile(f));
    return () => {
      alive = false;
    };
  }, [code]);

  const load = useCallback(() => {
    setItems(null);
    setFailed(false);
    getReviewQueue(code, kind ? { kind } : {})
      .then((list) => {
        setItems(list);
        setIndex(0);
      })
      .catch(() => setFailed(true));
  }, [code, kind]);

  useEffect(load, [load]);

  const current = items?.[index];
  const keyOf = (item: ReviewItem) => `${item.kind}:${item.id}`;

  const send = useCallback(
    async (verdict: Verdict) => {
      if (!current || sending) return;
      if (verdict === "changes" && comment.trim() === "") {
        setError(st("review.commentRequired"));
        commentRef.current?.focus();
        return;
      }
      setSending(true);
      setError(null);
      try {
        await postReview(code, current.kind, current.id, verdict, comment.trim().normalize("NFC"));
        setDone((d) => ({ ...d, [keyOf(current)]: verdict }));
        setComment("");
        if (items && index < items.length - 1) setIndex(index + 1);
        void useStudio.getState().refreshTree();
      } catch {
        setError(st("review.failed"));
      } finally {
        setSending(false);
      }
    },
    [current, sending, comment, code, items, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!items || items.length === 0) return;
      if (e.key === "j") {
        e.preventDefault();
        setIndex((i) => Math.min(items.length - 1, i + 1));
        setError(null);
      } else if (e.key === "k") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
        setError(null);
      } else if (e.key === "a") {
        e.preventDefault();
        void send("approve");
      } else if (e.key === "c") {
        e.preventDefault();
        commentRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, send]);

  const concept = current?.kind === "concept" ? content?.concepts.get(current.id) : undefined;
  const general = generalDoubts(doubtsFile);
  const groups = current ? doubtsFor(doubtsFile, current.kind, current.id, current.doubts, raw) : null;
  const hasAudio = !!concept?.audio.some((a) => a.source === "native");

  return (
    <section className="flex flex-col gap-4" data-testid="review-queue">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-2xl">{st("review.title")}</h1>
        <div className="flex flex-col gap-1">
          <label htmlFor="review-kind" className="text-sm font-medium">{st("review.filter")}</label>
          <select id="review-kind" className="min-h-11 rounded-xl border-2 border-phu-sa/20 bg-white px-2" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{st("review.filter.all")}</option>
            <option value="lesson">{st("kind.lesson")}</option>
            <option value="concept">{st("kind.concept")}</option>
            <option value="culture">{st("kind.culture")}</option>
          </select>
        </div>
      </div>
      <p className="text-sm text-phu-sa">{st("review.keys")}</p>
      {general.length > 0 && (
        <details className="rounded-xl border border-nghe/40 bg-white/60 px-3 py-2" data-testid="review-general-doubts">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">{st("review.doubts.general", { n: general.reduce((n, g) => n + g.doubts.length, 0) })}</summary>
          {general.map((g) => (
            <div key={g.group} className="py-1">
              <p className="font-medium">{g.group}</p>
              <ul className="list-disc pl-5">
                {g.doubts.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          ))}
        </details>
      )}

      {failed && (
        <div className="flex items-center gap-3">
          <p className="text-son-mai">{st("review.loadFailed")}</p>
          <SmallButton onClick={load}>{st("action.retry")}</SmallButton>
        </div>
      )}
      {!failed && items === null && <p>{st("common.loading")}</p>}
      {items && items.length === 0 && <p className="text-lg">{st("review.empty")}</p>}

      {items && current && (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <ol className="flex max-h-[60vh] flex-col overflow-y-auto rounded-xl border border-phu-sa/10 bg-white/60" aria-label={st("review.list")}>
            {items.map((item, i) => (
              <li key={keyOf(item)}>
                <button
                  type="button"
                  aria-current={i === index || undefined}
                  className={`flex min-h-11 w-full flex-col px-3 py-2 text-left ${i === index ? "bg-ngoc-sang" : ""}`}
                  onClick={() => setIndex(i)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{item.title || item.id}</span>
                    {done[keyOf(item)] && <span className={`text-xs font-semibold ${done[keyOf(item)] === "approve" ? "text-ngoc" : "text-son-mai"}`}>{st(done[keyOf(item)] === "approve" ? "review.done.approve" : "review.done.changes")}</span>}
                  </span>
                  <span className="font-mono text-xs text-phu-sa">{item.id}</span>
                </button>
              </li>
            ))}
          </ol>

          <article className="flex flex-col gap-5 rounded-2xl bg-white/70 p-5" aria-live="polite" data-testid="review-item">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-phu-sa">
                {st(`kind.${current.kind}` as StudioKey)} · {st("review.position", { n: index + 1, total: items.length })}
              </p>
              <Link to={docUrl(code, current.kind, current.id)} className="min-h-11 py-2 font-semibold text-ngoc">{st("review.open")}</Link>
            </header>
            <h2 className="text-xl font-semibold">{current.title || current.id}</h2>
            <ul className="flex flex-col gap-3">
              {current.vi.map((text, i) => (
                <li key={i} lang="vi" className="font-serif text-vi leading-snug break-words">{text}</li>
              ))}
            </ul>
            {hasAudio && concept && content && (
              <SmallButton onClick={() => void playConcept(content, concept, { speed: "natural", allowTts: false })}>{st("review.listen")}</SmallButton>
            )}
            {groups && groups.own.length > 0 && (
              <div className="rounded-xl border-l-4 border-nghe bg-nghe/10 p-3" data-testid="review-doubts">
                <p className="font-semibold">{st("review.doubts")}</p>
                <ul className="list-disc pl-5">
                  {groups.own.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            {groups && groups.units.map((u) => (
              <div key={u.unit} className="rounded-xl border-l-4 border-nghe/60 bg-nghe/5 p-3" data-testid="review-unit-doubts">
                <p className="font-semibold">{st("review.doubts.unit", { unit: u.unit })}</p>
                <ul className="list-disc pl-5">
                  {u.doubts.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <label htmlFor="review-comment" className="font-medium">{st("review.comment")}</label>
              <textarea
                id="review-comment"
                ref={commentRef}
                rows={3}
                value={comment}
                aria-describedby={error ? "review-error" : undefined}
                className="w-full rounded-xl border-2 border-phu-sa/20 bg-white px-3 py-2"
                onChange={(e) => setComment(e.target.value.normalize("NFC"))}
              />
            </div>
            {error && <p id="review-error" role="alert" className="text-son-mai">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={sending} onClick={() => void send("approve")} className="min-h-14 rounded-2xl bg-ngoc px-6 text-lg font-semibold text-nuoc disabled:opacity-60">
                {st("review.approve")}
              </button>
              <button type="button" disabled={sending} onClick={() => void send("changes")} className="min-h-14 rounded-2xl border-2 border-son-mai px-6 text-lg font-semibold text-son-mai disabled:opacity-60">
                {st("review.changes")}
              </button>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
