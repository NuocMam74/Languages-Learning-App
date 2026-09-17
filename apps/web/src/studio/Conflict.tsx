import { useState } from "react";
import { SmallButton } from "./fields.tsx";
import { st, studioLocale } from "./i18n.ts";
import type { DraftInfo } from "./studio-api.ts";

/** Aplatit un document en « chemin → valeur » pour comparer deux versions champ par champ. */
export function flatten(value: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, "[]");
    value.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) out.set(prefix, "{}");
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));
  }
  return out;
}

export interface DiffRow {
  path: string;
  mine: string | null;
  theirs: string | null;
}

export function diffDocuments(mine: unknown, theirs: unknown): DiffRow[] {
  const a = flatten(mine);
  const b = flatten(theirs);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths.flatMap((path) => (a.get(path) === b.get(path) ? [] : [{ path, mine: a.get(path) ?? null, theirs: b.get(path) ?? null }]));
}

export function ConflictPanel({ mine, theirs, onResolve }: { mine: unknown; theirs: DraftInfo | null; onResolve: (choice: "mine" | "theirs") => void }) {
  const [showDiff, setShowDiff] = useState(false);
  const rows = showDiff ? diffDocuments(mine, theirs?.data ?? null) : [];
  return (
    <div role="alertdialog" aria-labelledby="conflict-title" aria-describedby="conflict-body" className="flex flex-col gap-3 rounded-2xl border-l-4 border-son-mai bg-white p-4" data-testid="conflict">
      <h2 id="conflict-title" className="font-semibold">{st("conflict.title")}</h2>
      <p id="conflict-body">
        {theirs ? st("conflict.body", { who: theirs.updatedBy || st("conflict.someone"), when: new Date(theirs.updatedAt).toLocaleString(studioLocale()) }) : st("conflict.bodyUnknown")}
      </p>
      <div className="flex flex-wrap gap-2">
        <SmallButton tone="primary" onClick={() => onResolve("mine")}>{st("conflict.keepMine")}</SmallButton>
        <SmallButton onClick={() => onResolve("theirs")}>{st("conflict.takeTheirs")}</SmallButton>
        <SmallButton onClick={() => setShowDiff(!showDiff)} pressed={showDiff}>{st("conflict.viewDiff")}</SmallButton>
      </div>
      {showDiff && (
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <p>{st("conflict.same")}</p>
          ) : (
            <table className="w-full text-left text-sm" data-testid="conflict-diff">
              <thead>
                <tr>
                  <th className="py-1 pr-3">{st("conflict.field")}</th>
                  <th className="py-1 pr-3">{st("conflict.mine")}</th>
                  <th className="py-1">{st("conflict.theirs")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.path} className="border-t border-phu-sa/10 align-top">
                    <td className="py-1 pr-3 font-mono">{r.path}</td>
                    <td className="py-1 pr-3">{r.mine ?? <em>{st("conflict.absent")}</em>}</td>
                    <td className="py-1">{r.theirs ?? <em>{st("conflict.absent")}</em>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function JsonEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="json-editor" className="font-medium">{st("json.label")}</label>
      <textarea
        id="json-editor"
        spellCheck={false}
        rows={24}
        value={text}
        aria-invalid={error !== null || undefined}
        aria-describedby={error ? "json-editor-error" : undefined}
        className="w-full rounded-xl border-2 border-phu-sa/20 bg-white p-3 font-mono text-sm"
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            const parsed: unknown = JSON.parse(next);
            setError(null);
            onChange(parsed);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {error && <p id="json-editor-error" className="text-sm text-son-mai">{st("json.invalid", { message: error })}</p>}
    </div>
  );
}
