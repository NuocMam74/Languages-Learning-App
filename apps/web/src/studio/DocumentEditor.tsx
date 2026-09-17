import { buildContentIndex, hasFeature, type Concept, type CultureCard, type ExamFile, type Lesson, type LexicalVariants } from "@parlo/core";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { AudioRecorder } from "./AudioRecorder.tsx";
import { ConceptEditor } from "./ConceptEditor.tsx";
import { ConflictPanel, JsonEditor } from "./Conflict.tsx";
import { CultureEditor } from "./CultureEditor.tsx";
import { Badge, fieldDomId, IssuesContext, SmallButton, TelexContext } from "./fields.tsx";
import { st, studioLocale, type StudioKey } from "./i18n.ts";
import { LessonEditor } from "./LessonEditor.tsx";
import { canPublish } from "./roles.ts";
import { OptionsContext, type PackOptions } from "./StepForm.tsx";
import { rawWithWorking, useStudio } from "./store.ts";
import { DOC_KINDS, labelOf, validatePack, type DocKind, type ValidateResult } from "./studio-api.ts";
import { useDocument, type SaveState } from "./use-document.ts";
import { overlay, validateDraft, type FieldIssue } from "./validation.ts";
import { ExamEditor, VariantsEditor } from "./VariantsEditor.tsx";

const TELEX_KEY = "parlo.studio.telex";

function readTelex(): boolean {
  try {
    return localStorage.getItem(TELEX_KEY) === "1";
  } catch {
    return false;
  }
}

function SaveStatus({ state, savedAt }: { state: SaveState; savedAt: string | null }) {
  const text: Record<SaveState, string> = {
    loading: st("save.loading"),
    clean: savedAt ? st("save.draftFrom", { when: new Date(savedAt).toLocaleString(studioLocale()) }) : st("save.clean"),
    dirty: st("save.dirty"),
    saving: st("save.saving"),
    saved: st("save.saved"),
    error: st("save.error"),
    conflict: st("save.conflict"),
    load_error: st("save.loadError"),
  };
  const bad = state === "error" || state === "conflict" || state === "load_error";
  return (
    <p role="status" aria-live="polite" className={`text-sm ${bad ? "font-semibold text-son-mai" : "text-phu-sa"}`} data-testid="save-status" data-state={state}>
      {text[state]}
    </p>
  );
}

function IssueSummary({ issues }: { issues: readonly FieldIssue[] }) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  if (issues.length === 0) {
    return <p className="rounded-xl bg-ngoc-sang px-3 py-2 text-sm font-semibold text-ngoc" data-testid="issues-summary" data-errors="0">{st("issues.none")}</p>;
  }
  const focus = (path: string) => {
    // Du champ exact vers le parent le plus proche qui existe (ex. steps.2.concept → steps.2).
    const parts = path.split(".");
    for (let n = parts.length; n > 0; n--) {
      const el = document.getElementById(fieldDomId(parts.slice(0, n).join(".")));
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
        return;
      }
    }
  };
  return (
    <details open={errors.length > 0} className="rounded-xl border-2 border-son-mai/20 bg-white/70 px-3 py-2" data-testid="issues-summary" data-errors={errors.length}>
      <summary className="cursor-pointer font-semibold">
        {[errors.length ? st("issues.count.errors", { n: errors.length }) : "", warnings.length ? st("issues.count.warnings", { n: warnings.length }) : ""].filter(Boolean).join(" · ")}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {issues.slice(0, 30).map((issue, i) => (
          <li key={i}>
            <button type="button" className={`min-h-11 w-full py-1 text-left underline-offset-2 hover:underline ${issue.level === "error" ? "text-son-mai" : "text-phu-sa"}`} onClick={() => focus(issue.path)}>
              {issue.path ? <span className="font-mono">{issue.path}</span> : st("issues.document")} — {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function DocumentEditor({ code, roles }: { code: string; roles: readonly string[] }) {
  const params = useParams();
  const kind = params.kind as DocKind;
  const id = params.id ?? "";
  if (!DOC_KINDS.includes(kind)) return <p>{st("doc.unknownKind")}</p>;
  return <Editor key={`${kind}:${id}`} code={code} kind={kind} id={id} roles={roles} />;
}

function Editor({ code, kind, id, roles }: { code: string; kind: DocKind; id: string; roles: readonly string[] }) {
  const { doc, data, state, savedAt, theirs, setData, save, discard, resolveConflict, reload } = useDocument(code, kind, id);
  const raw = useStudio((s) => s.raw);
  const rawStatus = useStudio((s) => s.rawStatus);
  const working = useStudio((s) => s.working);
  const [telex, setTelex] = useState(readTelex);
  const [json, setJson] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [server, setServer] = useState<ValidateResult | "running" | "failed" | null>(null);
  const deferred = useDeferredValue(data);
  const editor = canPublish(roles);

  useEffect(() => {
    try {
      localStorage.setItem(TELEX_KEY, telex ? "1" : "0");
    } catch {
      // stockage indisponible : réglage de session seulement
    }
  }, [telex]);

  const others = useMemo(() => (raw ? rawWithWorking(raw, working, { kind, id }) : null), [raw, working, kind, id]);
  const issues = useMemo(() => (deferred === null ? [] : validateDraft({ raw: others }, kind, id, deferred)), [others, kind, id, deferred]);
  const content = useMemo(() => {
    if (!others || deferred === null) return null;
    try {
      return buildContentIndex(overlay(others, kind, id, deferred));
    } catch {
      return null;
    }
  }, [others, kind, id, deferred]);

  const options = useMemo<PackOptions>(() => {
    const c = content;
    if (!c) return { concepts: [], culture: [], lessons: [], units: [], variants: [], voices: [], tonal: true };
    return {
      concepts: [...c.concepts.values()].map((x) => ({ id: x.id, label: x.vi })),
      culture: [...c.culture.values()].map((x) => ({ id: x.id, label: labelOf(x.title) })),
      lessons: [...c.lessons.values()].map((x) => ({ id: x.id, label: labelOf(x.title) })),
      units: c.curriculum.units.map((u) => ({ id: u.id, label: labelOf(u.title) })),
      variants: (c.variants?.entries ?? []).map((e) => ({ id: e.id, label: `${e.south.join(" / ")} · ${e.north.join(" / ")}` })),
      voices: c.pack.voices.map((v) => ({ id: v.id, label: v.label })),
      tonal: hasFeature(c.pack, "tones"),
    };
  }, [content]);

  const serverValidate = async () => {
    setServer("running");
    try {
      await save();
      setServer(await validatePack(code));
    } catch {
      setServer("failed");
    }
  };

  if (state === "loading" || data === null) return <p>{st("save.loading")}</p>;
  if (state === "load_error") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-son-mai">{st("save.loadError")}</p>
        <SmallButton onClick={() => void reload()}>{st("action.retry")}</SmallButton>
      </div>
    );
  }

  const reviewed = (data as { reviewed?: unknown }).reviewed;
  const isObject = typeof data === "object" && !Array.isArray(data);
  const formKinds: DocKind[] = ["lesson", "concept", "culture", "lexical-variants", "exam"];
  const showJson = !isObject || !formKinds.includes(kind) || (editor && json);

  let form = null;
  if (!showJson) {
    switch (kind) {
      case "lesson":
        form = <LessonEditor code={code} lesson={data as Lesson} onChange={setData} content={content} />;
        break;
      case "concept": {
        const concept = data as Concept;
        form = (
          <ConceptEditor
            concept={concept}
            onChange={setData}
            recorder={
              <AudioRecorder
                code={code}
                conceptId={concept.id}
                vi={concept.vi ?? ""}
                voices={options.voices}
                beforeUpload={save}
                onUploaded={() => void reload(true)}
              />
            }
          />
        );
        break;
      }
      case "culture":
        form = <CultureEditor card={data as CultureCard} onChange={setData} content={content} />;
        break;
      case "lexical-variants":
        form = <VariantsEditor file={data as LexicalVariants} onChange={setData} />;
        break;
      case "exam":
        form = <ExamEditor exam={data as ExamFile} onChange={setData} content={content} />;
        break;
      default:
        break;
    }
  }

  return (
    <OptionsContext.Provider value={options}>
      <TelexContext.Provider value={telex}>
        <IssuesContext.Provider value={issues}>
          <article className="flex flex-col gap-4" data-testid="document-editor">
            <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-phu-sa/10 bg-nuoc pt-2 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/studio/${encodeURIComponent(code)}`} className="min-h-11 py-2 text-ngoc lg:hidden">{st("nav.backToTree")}</Link>
                <h1 className="font-serif text-2xl">
                  <span className="text-phu-sa">{st(`kind.${kind}` as StudioKey)} </span>
                  <span className="font-mono text-xl">{id}</span>
                </h1>
                {doc?.draft && <Badge tone="draft">{st("badge.draft")}</Badge>}
                {!doc?.published && <Badge tone="neutral">{st("badge.new")}</Badge>}
                {reviewed === true && <Badge tone="reviewed">{st("badge.reviewed")}</Badge>}
                {reviewed === false && <Badge tone="unreviewed">{st("badge.unreviewed")}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SaveStatus state={state} savedAt={savedAt} />
                <span className="flex-1" />
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-5 accent-ngoc" checked={telex} onChange={(e) => setTelex(e.target.checked)} />
                  {st("telex.toggle")}
                </label>
                {editor && formKinds.includes(kind) && (
                  <SmallButton onClick={() => setJson(!json)} pressed={json}>{st("json.toggle")}</SmallButton>
                )}
                {(state === "dirty" || state === "error") && <SmallButton onClick={() => void save()}>{st("save.now")}</SmallButton>}
                <SmallButton onClick={() => void serverValidate()}>{st("validate.server")}</SmallButton>
                {doc?.draft && <SmallButton tone="danger" onClick={() => setConfirmDiscard(true)}>{st("discard.button")}</SmallButton>}
              </div>
              {telex && <p className="text-sm text-phu-sa">{st("telex.help")}</p>}
              {rawStatus === "missing" && <p className="text-sm text-phu-sa">{st("validation.schemaOnly")}</p>}
            </header>

            {confirmDiscard && (
              <div role="alertdialog" aria-labelledby="discard-title" className="flex flex-col gap-2 rounded-2xl border-l-4 border-son-mai bg-white p-4">
                <p id="discard-title" className="font-semibold">{st("discard.confirm")}</p>
                <div className="flex gap-2">
                  <SmallButton tone="danger" onClick={() => { setConfirmDiscard(false); void discard(); }}>{st("discard.yes")}</SmallButton>
                  <SmallButton onClick={() => setConfirmDiscard(false)}>{st("common.cancel")}</SmallButton>
                </div>
              </div>
            )}

            {state === "conflict" && <ConflictPanel mine={data} theirs={theirs} onResolve={(c) => void resolveConflict(c)} />}

            <IssueSummary issues={issues} />

            {server && (
              <div className="rounded-xl border border-phu-sa/15 bg-white/70 px-3 py-2 text-sm" role="status" data-testid="server-validation">
                {server === "running" ? (
                  st("validate.running")
                ) : server === "failed" ? (
                  <span className="text-son-mai">{st("validate.failed")}</span>
                ) : (
                  <>
                    <p className="font-semibold">{server.errors.length === 0 ? st("validate.ok", { n: server.warnings.length }) : st("validate.errors", { n: server.errors.length })}</p>
                    <ul>
                      {server.errors.slice(0, 20).map((e, i) => (
                        <li key={i} className="text-son-mai"><span className="font-mono">{e.where}</span> — {e.message}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {showJson ? (
              editor ? <JsonEditor key={json ? "json" : "raw"} value={data} onChange={setData} /> : <p>{st("json.editorsOnly")}</p>
            ) : (
              form
            )}
          </article>
        </IssuesContext.Provider>
      </TelexContext.Provider>
    </OptionsContext.Provider>
  );
}
