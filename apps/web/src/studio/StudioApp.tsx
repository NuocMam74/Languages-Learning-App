import { buildContentIndex, type Lesson } from "@parlo/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { DocumentEditor } from "./DocumentEditor.tsx";
import { st } from "./i18n.ts";
import { LessonPlayer } from "./Preview.tsx";
import { PublishPanel } from "./PublishPanel.tsx";
import { ReviewQueue } from "./ReviewQueue.tsx";
import { canPublish, canUseStudio, useMyRoles } from "./roles.ts";
import { useStudio, workingKey, rawWithWorking } from "./store.ts";
import { getStudioPacks, labelOf, type StudioPack } from "./studio-api.ts";
import { docUrl, Tree } from "./Tree.tsx";

/**
 * Studio de contenu (spec §15 Phase 4, docs/contracts/phase4.md §1), chargé à la demande :
 * rien de ce dossier (ni ajv, ni les schémas) n'entre dans le bundle de l'apprenant.
 * Pensé pour des relecteurs natifs non techniciens : formulaires en français, JSON caché par défaut.
 */

function Centered({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-4 px-5">{children}</main>;
}

export default function StudioApp() {
  const roles = useMyRoles();
  if (roles.status === "loading") return <Centered><p>{st("common.loading")}</p></Centered>;
  if (roles.status === "signed_out") {
    return (
      <Centered>
        <h1 className="font-serif text-2xl">{st("guard.title")}</h1>
        <p>{st("guard.signin")}</p>
        <Link to="/connexion" className="min-h-11 py-2 font-semibold text-ngoc">{st("guard.signin.link")}</Link>
      </Centered>
    );
  }
  if (roles.status === "error") {
    return (
      <Centered>
        <p className="text-son-mai">{st("guard.error")}</p>
        <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => window.location.reload()}>{st("action.retry")}</button>
      </Centered>
    );
  }
  if (!canUseStudio(roles.roles)) {
    return (
      <Centered>
        <h1 className="font-serif text-2xl">{st("guard.title")}</h1>
        <p data-testid="studio-forbidden">{st("guard.forbidden")}</p>
        <Link to="/" className="min-h-11 py-2 font-semibold text-ngoc">{st("nav.backToApp")}</Link>
      </Centered>
    );
  }
  return (
    <Routes>
      <Route index element={<PackPicker />} />
      <Route path=":pack/*" element={<Workspace roles={roles.roles} />} />
    </Routes>
  );
}

function PackPicker() {
  const [packs, setPacks] = useState<StudioPack[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getStudioPacks().then(setPacks).catch(() => setFailed(true));
  }, []);
  if (failed) return <Centered><p className="text-son-mai">{st("packs.error")}</p></Centered>;
  if (!packs) return <Centered><p>{st("common.loading")}</p></Centered>;
  if (packs.length === 1 && packs[0]) return <Navigate to={`/studio/${encodeURIComponent(packs[0].code)}`} replace />;
  return (
    <Centered>
      <h1 className="font-serif text-2xl">{st("packs.choose")}</h1>
      <ul className="flex flex-col gap-2">
        {packs.map((p) => (
          <li key={p.code}>
            <Link to={`/studio/${encodeURIComponent(p.code)}`} className="flex min-h-11 items-center gap-3 font-semibold text-ngoc">
              {labelOf(p.name)} <span className="font-mono text-sm text-phu-sa">{p.code} · v{p.version}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Centered>
  );
}

function Workspace({ roles }: { roles: string[] }) {
  const { pack = "" } = useParams();
  const open = useStudio((s) => s.open);
  const location = useLocation();
  const navigate = useNavigate();
  const [packs, setPacks] = useState<StudioPack[]>([]);

  useEffect(() => {
    open(pack);
  }, [open, pack]);

  useEffect(() => {
    getStudioPacks().then(setPacks).catch(() => setPacks([]));
  }, []);

  const base = `/studio/${encodeURIComponent(pack)}`;
  // Sur mobile, une seule colonne : l'arbre à l'accueil du pack, le contenu ailleurs.
  const atHome = location.pathname.replace(/\/$/, "") === base;
  const navClass = ({ isActive }: { isActive: boolean }) => `min-h-11 rounded-xl px-3 py-2 font-semibold ${isActive ? "bg-ngoc text-nuoc" : "text-ngoc"}`;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))]" data-testid="studio">
      <header className="flex flex-wrap items-center gap-3 border-b border-phu-sa/10 pb-3">
        <Link to="/" className="min-h-11 py-2 text-sm text-phu-sa">{st("nav.backToApp")}</Link>
        <p className="font-serif text-2xl">{st("studio.title")}</p>
        {packs.length > 1 ? (
          <>
            <label htmlFor="studio-pack" className="sr-only">{st("packs.choose")}</label>
            <select id="studio-pack" className="min-h-11 rounded-xl border-2 border-phu-sa/20 bg-white px-2" value={pack} onChange={(e) => navigate(`/studio/${encodeURIComponent(e.target.value)}`)}>
              {packs.map((p) => <option key={p.code} value={p.code}>{labelOf(p.name)} ({p.code})</option>)}
            </select>
          </>
        ) : (
          <span className="font-mono text-sm text-phu-sa">{pack}</span>
        )}
        <nav aria-label={st("nav.label")} className="flex flex-wrap gap-1 lg:ml-auto">
          <NavLink to={base} end className={navClass}>{st("nav.content")}</NavLink>
          <NavLink to={`${base}/relecture`} className={navClass}>{st("nav.review")}</NavLink>
          {canPublish(roles) && <NavLink to={`${base}/publier`} className={navClass}>{st("nav.publish")}</NavLink>}
        </nav>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-6 py-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className={`${atHome ? "block" : "hidden"} min-w-0 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-2`}>
          <Tree code={pack} />
        </aside>
        <main className={`${atHome ? "hidden lg:block" : "block"} min-w-0`}>
          <Routes>
            <Route index element={<Welcome />} />
            <Route path="doc/:kind/:id" element={<DocumentEditor code={pack} roles={roles} />} />
            <Route path="relecture" element={<ReviewQueue code={pack} />} />
            <Route path="publier" element={<PublishPanel code={pack} roles={roles} />} />
            <Route path="jouer/:lessonId" element={<PlayLesson code={pack} />} />
            <Route path="*" element={<Navigate to={base} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="flex max-w-prose flex-col gap-3">
      <h1 className="font-serif text-2xl">{st("welcome.title")}</h1>
      <p>{st("welcome.body")}</p>
      <p className="text-sm text-phu-sa">{st("welcome.review")}</p>
    </div>
  );
}

function PlayLesson({ code }: { code: string }) {
  const { lessonId = "" } = useParams();
  const navigate = useNavigate();
  const raw = useStudio((s) => s.raw);
  const rawStatus = useStudio((s) => s.rawStatus);
  const working = useStudio((s) => s.working);
  // Copie de travail si la leçon a été ouverte dans l'éditeur, sinon version publiée.
  const content = useMemo(() => (raw ? buildContentIndex(rawWithWorking(raw, working)) : null), [raw, working]);
  const lesson = (working[workingKey("lesson", lessonId)]?.data as Lesson | undefined) ?? content?.lessons.get(lessonId);
  const close = () => navigate(docUrl(code, "lesson", lessonId));

  if (rawStatus === "loading") return <p>{st("common.loading")}</p>;
  if (!content || !lesson) return <p>{st("player.unavailable")}</p>;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl">{st("player.title", { id: lessonId })}</h1>
      <LessonPlayer content={content} lesson={lesson} onClose={close} />
    </section>
  );
}
