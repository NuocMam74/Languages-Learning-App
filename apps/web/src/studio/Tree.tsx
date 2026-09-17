import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { examLevels } from "../exams/exam-files.ts";
import { Badge } from "./fields.tsx";
import { st } from "./i18n.ts";
import { useStudio } from "./store.ts";
import { labelOf, type DocKind } from "./studio-api.ts";

/** Arbre du pack : unités → leçons, concepts, cartes culture, variantes, examens ; recherche et état relu/brouillon. */

export const docUrl = (code: string, kind: DocKind, id: string) => `/studio/${encodeURIComponent(code)}/doc/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;

const norm = (s: string) => s.normalize("NFC").toLocaleLowerCase("vi");

function Item({ to, children, draft, reviewed }: { to: string; children: ReactNode; draft?: boolean; reviewed?: boolean }) {
  return (
    <li>
      <NavLink
        to={to}
        className={({ isActive }) => `flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 py-1 ${isActive ? "bg-ngoc-sang font-semibold" : "hover:bg-white/80"}`}
      >
        <span className="min-w-0">{children}</span>
        <span className="flex shrink-0 gap-1">
          {draft && <Badge tone="draft">{st("badge.draft")}</Badge>}
          {reviewed === false && <Badge tone="unreviewed">{st("badge.toReview")}</Badge>}
          {reviewed === true && <Badge tone="reviewed">{st("badge.reviewed")}</Badge>}
        </span>
      </NavLink>
    </li>
  );
}

function Group({ title, count, children, open }: { title: string; count: number; children: ReactNode; open: boolean }) {
  return (
    <details open={open} className="flex flex-col">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between font-semibold">
        <span>{title}</span>
        <span className="text-sm font-normal text-phu-sa">{count}</span>
      </summary>
      <ul className="flex flex-col">{children}</ul>
    </details>
  );
}

function NewDocument({ code }: { code: string }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<DocKind>("concept");
  const [id, setId] = useState("");
  const placeholder = kind === "lesson" ? `${code}.u01.l10` : kind === "culture" ? "cc_…" : "c_…";
  return (
    <form
      className="flex flex-col gap-2 border-t border-phu-sa/10 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = id.trim();
        if (clean) navigate(docUrl(code, kind, clean));
      }}
    >
      <p className="font-semibold">{st("tree.new")}</p>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="new-kind">{st("tree.new.kind")}</label>
        <select id="new-kind" className="min-h-11 min-w-0 shrink rounded-xl border-2 border-phu-sa/20 bg-white px-2" value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
          <option value="concept">{st("kind.concept")}</option>
          <option value="lesson">{st("kind.lesson")}</option>
          <option value="culture">{st("kind.culture")}</option>
        </select>
        <label className="sr-only" htmlFor="new-id">{st("tree.new.id")}</label>
        <input id="new-id" className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-phu-sa/20 bg-white px-2 font-mono" placeholder={placeholder} value={id} onChange={(e) => setId(e.target.value)} />
      </div>
      <button type="submit" className="min-h-11 self-start font-semibold text-ngoc">{st("tree.new.create")}</button>
    </form>
  );
}

export function Tree({ code }: { code: string }) {
  const tree = useStudio((s) => s.tree);
  const status = useStudio((s) => s.treeStatus);
  const refresh = useStudio((s) => s.refreshTree);
  const [query, setQuery] = useState("");
  const q = norm(query.trim());
  const match = (...texts: string[]) => !q || texts.some((t) => norm(t).includes(q));

  if (status === "loading" || status === "idle") return <p className="p-2">{st("common.loading")}</p>;
  if (status === "error" || !tree) {
    return (
      <div className="flex flex-col items-start gap-2 p-2">
        <p className="text-son-mai">{st("tree.error")}</p>
        <button type="button" className="min-h-11 font-semibold text-ngoc" onClick={() => void refresh()}>{st("action.retry")}</button>
      </div>
    );
  }

  const units = tree.units
    .map((u) => ({ ...u, lessons: u.lessons.filter((l) => match(l.id, labelOf(l.title), labelOf(u.title))) }))
    .filter((u) => u.lessons.length > 0 || match(u.id, labelOf(u.title)));
  const concepts = tree.concepts.filter((c) => match(c.id, c.vi));
  const culture = tree.culture.filter((c) => match(c.id));
  const exams = examLevels(code).filter((level) => match(level, `examen ${level}`));
  const searching = q.length > 0;

  return (
    <nav aria-label={st("tree.label")} className="flex min-w-0 flex-col gap-3" data-testid="studio-tree">
      <div className="flex flex-col gap-1">
        <label htmlFor="tree-search" className="font-medium">{st("tree.search")}</label>
        <input id="tree-search" type="search" className="min-h-11 w-full min-w-0 rounded-xl border-2 border-phu-sa/20 bg-white px-3 py-2" value={query} placeholder={st("tree.search.placeholder")} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <Group title={st("tree.lessons")} count={units.reduce((n, u) => n + u.lessons.length, 0)} open={searching}>
        {units.map((unit) => (
          <li key={unit.id} className="flex flex-col">
            <p className="mt-2 px-2 text-sm font-semibold text-phu-sa">{labelOf(unit.title)} <span className="font-mono font-normal">{unit.id}</span></p>
            <ul>
              {unit.lessons.map((lesson) => (
                <Item key={lesson.id} to={docUrl(code, "lesson", lesson.id)} draft={lesson.draft} reviewed={lesson.reviewed}>
                  <span className="block truncate">{labelOf(lesson.title)}</span>
                  <span className="block font-mono text-xs text-phu-sa">{lesson.id}</span>
                </Item>
              ))}
            </ul>
          </li>
        ))}
      </Group>

      <Group title={st("tree.concepts")} count={concepts.length} open={searching}>
        {concepts.slice(0, searching ? 200 : 1000).map((c) => (
          <Item key={c.id} to={docUrl(code, "concept", c.id)} draft={c.draft} reviewed={c.reviewed}>
            <span lang="vi" className="font-serif text-lg">{c.vi}</span> <span className="font-mono text-xs text-phu-sa">{c.id}</span>
          </Item>
        ))}
      </Group>

      <Group title={st("tree.culture")} count={culture.length} open={searching}>
        {culture.map((c) => (
          <Item key={c.id} to={docUrl(code, "culture", c.id)} draft={c.draft} reviewed={c.reviewed}>
            <span className="font-mono text-sm">{c.id}</span>
          </Item>
        ))}
      </Group>

      <Group title={st("tree.other")} count={3 + exams.length} open={false}>
        <Item to={docUrl(code, "lexical-variants", code)}>{st("kind.lexical-variants")}</Item>
        {exams.map((level) => (
          <Item key={level} to={docUrl(code, "exam", `${code}.exam.${level}`)}>{st("tree.exam", { level: level.toUpperCase() })}</Item>
        ))}
        <Item to={docUrl(code, "curriculum", code)}>{st("kind.curriculum")}</Item>
        <Item to={docUrl(code, "pack", code)}>{st("kind.pack")}</Item>
      </Group>

      <NewDocument code={code} />
    </nav>
  );
}
