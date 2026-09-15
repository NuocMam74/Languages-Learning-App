import { useState } from "react";
import { ApiError } from "../api.ts";
import { SmallButton } from "./fields.tsx";
import { st, type StudioKey } from "./i18n.ts";
import { canPublish } from "./roles.ts";
import { useStudio } from "./store.ts";
import { labelOf, publishDocuments, validatePack, type DocKind, type PublishResult, type ServerIssue, type ValidateResult } from "./studio-api.ts";

/** Publication (éditeurs) : choix des brouillons, validation serveur, message, chemins écrits. */

interface Candidate {
  kind: DocKind;
  id: string;
  label: string;
}

export function PublishPanel({ code, roles }: { code: string; roles: readonly string[] }) {
  const tree = useStudio((s) => s.tree);
  const working = useStudio((s) => s.working);
  const refreshTree = useStudio((s) => s.refreshTree);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState<ValidateResult | "running" | "failed" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<{ text: string; issues: ServerIssue[] } | null>(null);

  if (!canPublish(roles)) return <p className="text-lg">{st("publish.editorsOnly")}</p>;

  const candidates: Candidate[] = [
    ...(tree?.units.flatMap((u) => u.lessons.filter((l) => l.draft).map((l) => ({ kind: "lesson" as const, id: l.id, label: labelOf(l.title) }))) ?? []),
    ...(tree?.concepts.filter((c) => c.draft).map((c) => ({ kind: "concept" as const, id: c.id, label: c.vi })) ?? []),
    ...(tree?.culture.filter((c) => c.draft).map((c) => ({ kind: "culture" as const, id: c.id, label: "" })) ?? []),
  ];
  // Documents hors de l'arbre (variantes, examens, cursus, pack) ouverts pendant la session.
  for (const w of Object.values(working)) {
    if (!["lesson", "concept", "culture"].includes(w.kind) && !candidates.some((c) => c.kind === w.kind && c.id === w.id)) {
      candidates.push({ kind: w.kind, id: w.id, label: "" });
    }
  }
  const key = (c: { kind: DocKind; id: string }) => `${c.kind}:${c.id}`;

  const toggle = (c: Candidate) => {
    const next = new Set(selected);
    if (next.has(key(c))) next.delete(key(c));
    else next.add(key(c));
    setSelected(next);
  };

  const check = async () => {
    setValidation("running");
    try {
      setValidation(await validatePack(code));
    } catch {
      setValidation("failed");
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      const documents = candidates.filter((c) => selected.has(key(c))).map(({ kind, id }) => ({ kind, id }));
      const res = await publishDocuments(code, documents, message.trim().normalize("NFC"));
      setResult(res);
      setSelected(new Set());
      setMessage("");
      void refreshTree();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { errors?: ServerIssue[]; detail?: { errors?: ServerIssue[] } } | null;
        setError({ text: st("publish.invalid"), issues: body?.errors ?? body?.detail?.errors ?? [] });
      } else if (e instanceof ApiError && e.status === 403) {
        setError({ text: st("publish.disabled"), issues: [] });
      } else {
        setError({ text: st("publish.failed"), issues: [] });
      }
    } finally {
      setPublishing(false);
    }
  };

  const canSend = selected.size > 0 && message.trim().length > 0 && !publishing;

  return (
    <section className="flex flex-col gap-4" data-testid="publish-panel">
      <h1 className="font-serif text-2xl">{st("publish.title")}</h1>
      <p className="text-sm text-phu-sa">{st("publish.hint")}</p>

      {candidates.length === 0 ? (
        <p>{st("publish.nothing")}</p>
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">{st("publish.documents")}</legend>
          {candidates.map((c) => (
            <label key={key(c)} className="flex min-h-11 items-center gap-3">
              <input type="checkbox" className="size-5 accent-ngoc" checked={selected.has(key(c))} onChange={() => toggle(c)} />
              <span>
                <span className="text-phu-sa">{st(`kind.${c.kind}` as StudioKey)}</span> <span className="font-mono">{c.id}</span>
                {c.label && <span lang="vi" className="ml-2 font-serif">{c.label}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="publish-message" className="font-medium">{st("publish.message")}</label>
        <textarea id="publish-message" rows={3} className="w-full rounded-xl border-2 border-phu-sa/20 bg-white px-3 py-2" value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby="publish-message-hint" />
        <p id="publish-message-hint" className="text-sm text-phu-sa">{st("publish.message.hint")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <SmallButton onClick={() => void check()}>{st("validate.server")}</SmallButton>
        <SmallButton tone="primary" disabled={!canSend} onClick={() => void publish()}>{publishing ? st("publish.running") : st("publish.button", { n: selected.size })}</SmallButton>
      </div>

      {validation && (
        <div role="status" className="rounded-xl border border-phu-sa/15 bg-white/70 px-3 py-2 text-sm" data-testid="publish-validation">
          {validation === "running" ? st("validate.running") : validation === "failed" ? <span className="text-son-mai">{st("validate.failed")}</span> : (
            <>
              <p className="font-semibold">{validation.errors.length === 0 ? st("validate.ok", { n: validation.warnings.length }) : st("validate.errors", { n: validation.errors.length })}</p>
              <ul>
                {validation.errors.map((e, i) => <li key={i} className="text-son-mai"><span className="font-mono">{e.where}</span> — {e.message}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border-l-4 border-son-mai bg-white p-3">
          <p className="font-semibold text-son-mai">{error.text}</p>
          <ul className="text-sm">
            {error.issues.map((e, i) => <li key={i}><span className="font-mono">{e.where}</span> — {e.message}</li>)}
          </ul>
        </div>
      )}

      {result && (
        <div role="status" className="flex flex-col gap-2 rounded-xl bg-ngoc-sang p-3" data-testid="publish-result">
          <p className="font-semibold">{st("publish.done", { n: result.written.length, version: result.packVersion })}</p>
          <ul className="font-mono text-sm">
            {result.written.map((path) => <li key={path}>{path}</li>)}
          </ul>
          <p className="text-sm">{st("publish.done.next")}</p>
        </div>
      )}
    </section>
  );
}
