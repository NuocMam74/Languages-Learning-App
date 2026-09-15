import type { Localized } from "@parlo/core";
import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { st } from "./i18n.ts";
import { telexInput } from "./telex.ts";
import type { FieldIssue } from "./validation.ts";

/**
 * Champs de formulaire du studio : libellé visible, erreurs reliées par aria-describedby,
 * normalisation Unicode NFC à la saisie, Telex facultatif sur les champs vietnamiens.
 */

export const TelexContext = createContext(false);
export const IssuesContext = createContext<readonly FieldIssue[]>([]);

export const fieldDomId = (path: string) => `field-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/** Supprime les clés vides (exactOptionalPropertyTypes : jamais de `undefined` explicite dans le JSON). */
export function withOptional<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined | null | ""): T {
  const next = { ...obj };
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty) delete next[key];
  else next[key] = value as T[K];
  return next;
}

export function Issues({ path, id, exact = true }: { path: string; id: string; exact?: boolean }) {
  const all = useContext(IssuesContext);
  const list = all.filter((i) => (exact ? i.path === path : i.path === path || i.path.startsWith(`${path}.`)));
  if (list.length === 0) return null;
  return (
    <ul id={id} className="flex flex-col gap-1 text-sm" data-testid={`issues-${path}`}>
      {list.map((issue, k) => (
        <li key={k} className={issue.level === "error" ? "text-son-mai" : "text-phu-sa"}>
          <span className="font-semibold">{issue.level === "error" ? st("issue.error") : st("issue.warning")}</span> {issue.message}
        </li>
      ))}
    </ul>
  );
}

function useFieldIssues(path: string) {
  const all = useContext(IssuesContext);
  return all.filter((i) => i.path === path);
}

const inputClass = (invalid: boolean, vi: boolean) =>
  `w-full rounded-xl border-2 bg-white px-3 py-2 ${invalid ? "border-son-mai" : "border-phu-sa/20"} ${vi ? "font-serif text-2xl" : ""}`;

interface TextFieldProps {
  label: string;
  path: string;
  value: string | undefined;
  onChange: (value: string) => void;
  hint?: string;
  vi?: boolean;
  multiline?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  footer?: ReactNode;
}

export function TextField({ label, path, value, onChange, hint, vi = false, multiline = false, readOnly = false, placeholder, footer }: TextFieldProps) {
  const id = fieldDomId(path);
  const issues = useFieldIssues(path);
  const telex = useContext(TelexContext) && vi;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const current = value ?? "";

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const handle = (typed: string, position: number | null) => {
    if (telex && position !== null) {
      const converted = telexInput(current, typed, position);
      if (converted) {
        caret.current = converted.caret;
        onChange(converted.value);
        return;
      }
    }
    const normalized = typed.normalize("NFC");
    if (normalized.length !== typed.length && position !== null) caret.current = Math.max(0, position - (typed.length - normalized.length));
    onChange(normalized);
  };

  const describedBy = [hint ? `${id}-hint` : "", issues.length ? `${id}-issues` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    ref,
    value: current,
    readOnly,
    placeholder,
    lang: vi ? "vi" : undefined,
    "aria-invalid": issues.some((i) => i.level === "error") || undefined,
    "aria-describedby": describedBy,
    className: inputClass(issues.some((i) => i.level === "error"), vi),
    onChange: (e: { target: HTMLInputElement | HTMLTextAreaElement }) => handle(e.target.value, e.target.selectionStart),
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-phu-sa">
          {hint}
        </p>
      )}
      {multiline ? <textarea rows={3} {...common} /> : <input type="text" autoComplete="off" spellCheck={!vi} {...common} />}
      {footer}
      <Issues path={path} id={`${id}-issues`} />
    </div>
  );
}

export function NumberField({ label, path, value, onChange, step = 1, hint }: { label: string; path: string; value: number | undefined; onChange: (v: number) => void; step?: number; hint?: string }) {
  const id = fieldDomId(path);
  const issues = useFieldIssues(path);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-sm text-phu-sa">{hint}</p>}
      <input
        id={id}
        type="number"
        step={step}
        value={value ?? ""}
        aria-invalid={issues.some((i) => i.level === "error") || undefined}
        aria-describedby={[hint ? `${id}-hint` : "", issues.length ? `${id}-issues` : ""].filter(Boolean).join(" ") || undefined}
        className={`${inputClass(issues.some((i) => i.level === "error"), false)} max-w-40`}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
      <Issues path={path} id={`${id}-issues`} />
    </div>
  );
}

export function SelectField<T extends string>({ label, path, value, options, onChange, allowEmpty }: {
  label: string;
  path: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (v: T | undefined) => void;
  allowEmpty?: string;
}) {
  const id = fieldDomId(path);
  const issues = useFieldIssues(path);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">{label}</label>
      <select
        id={id}
        value={value ?? ""}
        aria-invalid={issues.some((i) => i.level === "error") || undefined}
        aria-describedby={issues.length ? `${id}-issues` : undefined}
        className={`${inputClass(issues.some((i) => i.level === "error"), false)} min-h-11`}
        onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as T))}
      >
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <Issues path={path} id={`${id}-issues`} />
    </div>
  );
}

export function CheckboxField({ label, path, checked, onChange, hint }: { label: string; path: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = fieldDomId(path);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 font-medium">
        <input id={id} type="checkbox" className="size-5 accent-ngoc" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
        {label}
      </label>
      {hint && <p id={`${id}-hint`} className="text-sm text-phu-sa">{hint}</p>}
      <Issues path={path} id={`${id}-issues`} />
    </div>
  );
}

const LOCALES = ["fr", "en"] as const;

/** Texte en français (obligatoire) et en anglais (facultatif). */
export function LocalizedField({ label, path, value, onChange, multiline, optional, counter }: {
  label: string;
  path: string;
  value: Localized | undefined;
  onChange: (v: Localized | undefined) => void;
  multiline?: boolean;
  optional?: boolean;
  counter?: (text: string) => ReactNode;
}) {
  const set = (locale: string, text: string) => {
    const next: Record<string, string> = { ...(value ?? { fr: "" }) };
    if (text === "" && locale !== "fr") delete next[locale];
    else next[locale] = text;
    const empty = Object.values(next).every((v) => v === "");
    onChange(optional && empty ? undefined : (next as Localized));
  };
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-phu-sa/15 p-3">
      <legend className="px-1 font-medium">{label}{optional ? ` ${st("field.optional")}` : ""}</legend>
      {LOCALES.map((locale) => (
        <TextField
          key={locale}
          label={st(locale === "fr" ? "field.locale.fr" : "field.locale.en")}
          path={`${path}.${locale}`}
          value={value?.[locale]}
          multiline={multiline ?? false}
          onChange={(text) => set(locale, text)}
          footer={counter ? counter(value?.[locale] ?? "") : undefined}
        />
      ))}
      <Issues path={path} id={`${fieldDomId(path)}-issues`} />
    </fieldset>
  );
}

/** Liste de textes (réponses acceptées, jetons…). */
export function StringListField({ label, path, value, onChange, vi, hint, addLabel }: {
  label: string;
  path: string;
  value: readonly string[] | undefined;
  onChange: (v: string[]) => void;
  vi?: boolean;
  hint?: string;
  addLabel?: string;
}) {
  const list = value ?? [];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium">{label}</legend>
      {hint && <p className="text-sm text-phu-sa">{hint}</p>}
      {list.map((item, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <TextField label={st("field.item", { n: i + 1 })} path={`${path}.${i}`} value={item} vi={vi ?? false} onChange={(text) => onChange(list.map((v, k) => (k === i ? text : v)))} />
          </div>
          <button type="button" className="min-h-11 px-2 text-son-mai" aria-label={st("field.remove.item", { n: i + 1 })} onClick={() => onChange(list.filter((_, k) => k !== i))}>
            {st("action.remove")}
          </button>
        </div>
      ))}
      <button type="button" className="min-h-11 self-start font-semibold text-ngoc" onClick={() => onChange([...list, ""])}>
        {addLabel ?? st("action.addItem")}
      </button>
      <Issues path={path} id={`${fieldDomId(path)}-issues`} />
    </fieldset>
  );
}

export interface IdOption {
  id: string;
  label: string;
}

/** Choix d'identifiants existants (concepts, leçons…) : puces + champ de recherche avec suggestions. */
export function IdListField({ label, path, value, options, onChange, hint, ordered }: {
  label: string;
  path: string;
  value: readonly string[] | undefined;
  options: readonly IdOption[];
  onChange: (v: string[]) => void;
  hint?: string;
  ordered?: boolean;
}) {
  const list = value ?? [];
  const [query, setQuery] = useState("");
  const listId = useId();
  const inputId = fieldDomId(path);
  const labels = new Map(options.map((o) => [o.id, o.label]));
  const add = () => {
    const q = query.trim();
    const match = options.find((o) => o.id === q) ?? options.find((o) => `${o.id} — ${o.label}` === q) ?? options.find((o) => o.label === q);
    const id = match?.id ?? q;
    if (id && !list.includes(id)) onChange([...list, id]);
    setQuery("");
  };
  const move = (i: number, d: number) => {
    const next = [...list];
    const [item] = next.splice(i, 1);
    if (item !== undefined) next.splice(i + d, 0, item);
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium">{label}</legend>
      {hint && <p className="text-sm text-phu-sa">{hint}</p>}
      <ul className="flex flex-wrap gap-2">
        {list.map((id, i) => (
          <li key={id} className="flex items-center gap-1 rounded-xl bg-ngoc-sang py-1 pr-1 pl-3">
            <span>
              <span className="font-mono text-sm">{id}</span>
              {labels.get(id) && <span lang="vi" className="ml-2 font-serif">{labels.get(id)}</span>}
            </span>
            {ordered && i > 0 && <button type="button" className="min-h-9 px-2 text-sm text-ngoc" onClick={() => move(i, -1)}>{st("action.moveUp")}</button>}
            <button type="button" className="min-h-9 px-2 text-son-mai" aria-label={st("field.remove.id", { id })} onClick={() => onChange(list.filter((v) => v !== id))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">{st("field.search", { label })}</label>
        <input
          id={inputId}
          list={listId}
          value={query}
          placeholder={st("field.search.placeholder")}
          className={inputClass(false, false)}
          onChange={(e) => setQuery(e.target.value.normalize("NFC"))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="min-h-11 rounded-xl border-2 border-ngoc px-3 font-semibold text-ngoc" onClick={add}>
          {st("action.add")}
        </button>
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </datalist>
      </div>
      <Issues path={path} id={`${inputId}-issues`} />
    </fieldset>
  );
}

/** Un seul identifiant existant. */
export function IdField({ label, path, value, options, onChange, hint, optional }: {
  label: string;
  path: string;
  value: string | undefined;
  options: readonly IdOption[];
  onChange: (v: string | undefined) => void;
  hint?: string;
  optional?: boolean;
}) {
  const listId = useId();
  const id = fieldDomId(path);
  const issues = useFieldIssues(path);
  const match = options.find((o) => o.id === value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">{label}{optional ? ` ${st("field.optional")}` : ""}</label>
      {hint && <p id={`${id}-hint`} className="text-sm text-phu-sa">{hint}</p>}
      <input
        id={id}
        list={listId}
        value={value ?? ""}
        autoComplete="off"
        aria-invalid={issues.some((i) => i.level === "error") || undefined}
        aria-describedby={[hint ? `${id}-hint` : "", issues.length ? `${id}-issues` : ""].filter(Boolean).join(" ") || undefined}
        className={`${inputClass(issues.some((i) => i.level === "error"), false)} font-mono`}
        onChange={(e) => onChange(e.target.value.trim() === "" ? undefined : e.target.value.trim().normalize("NFC"))}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </datalist>
      {match && <p lang="vi" className="font-serif text-lg">{match.label}</p>}
      <Issues path={path} id={`${id}-issues`} />
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-phu-sa/10 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-2xl">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Badge({ tone, children }: { tone: "draft" | "reviewed" | "unreviewed" | "neutral"; children: ReactNode }) {
  const styles = {
    draft: "bg-nghe/25 text-muc",
    reviewed: "bg-ngoc-sang text-ngoc",
    unreviewed: "bg-son-mai/10 text-son-mai",
    neutral: "bg-phu-sa/10 text-phu-sa",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}

export function SmallButton({ children, onClick, tone = "default", disabled, label, pressed, testId }: {
  children: ReactNode;
  onClick: () => void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  label?: string;
  pressed?: boolean;
  testId?: string;
}) {
  const styles = {
    default: "border-phu-sa/20 bg-white/70 text-muc",
    primary: "border-ngoc bg-ngoc text-nuoc disabled:border-phu-sa/20 disabled:bg-phu-sa/25 disabled:text-phu-sa/60",
    danger: "border-son-mai/40 bg-white/70 text-son-mai",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={`min-h-11 rounded-xl border-2 px-3 font-semibold ${styles[tone]}`}
    >
      {children}
    </button>
  );
}
