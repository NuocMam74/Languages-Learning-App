import { applyDiacritic, describeDiacritics, telexInput, type DiacriticKey, type InputMethod } from "@parlo/core";
import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { t, type MessageKey } from "../i18n/index.ts";
import { activePackLang } from "../packs/active.ts";
import { useInputMethod } from "./method.ts";

/**
 * Clavier vietnamien intégré (spec §8.4, contrat phase6 §5) : un champ ordinaire qui convertit la
 * frappe (Telex ou VNI, `@parlo/core` fait toute la logique) doublé d'une barre de 13 diacritiques
 * pour ceux qui ne connaissent pas la méthode — la barre est un secours tactile, pas la voie normale.
 *
 * Le champ reste un `input` système : clavier natif, dictée, copier-coller, correcteur coupé
 * (`autoCorrect` / `autoCapitalize` / `spellCheck` off) pour ne pas « corriger » le vietnamien, et
 * 16 px au moins pour qu'iOS ne zoome pas à la mise au point.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Entrée au clavier matériel = valider (même geste que le bouton du bas). */
  onSubmit?: () => void;
  label: string;
  disabled?: boolean;
  /**
   * Champ en langue cible : conversion Telex/VNI et barre de diacritiques. `false` pour la langue
   * d'interface (translate_to_fr) — un champ ordinaire, sinon « Maman » deviendrait « Mâman ».
   */
  target?: boolean;
}

/** Fin du mot en cours (lettres, chiffres en VNI) autour du curseur : ce que la barre modifie. */
function wordAround(value: string, caret: number): { start: number; end: number } {
  const typed = /[\p{L}\p{M}\p{Nd}]/u;
  let start = caret;
  while (start > 0 && typed.test(value[start - 1] ?? "")) start--;
  let end = caret;
  while (end < value.length && typed.test(value[end] ?? "")) end++;
  return { start, end };
}

const TONE_LABEL: Record<string, MessageKey> = {
  tone_sac: "tone.sac",
  tone_huyen: "tone.huyen",
  tone_hoi: "tone.hoi",
  tone_nga: "tone.nga",
  tone_nang: "tone.nang",
};

function keyLabel(key: DiacriticKey, method: InputMethod): string {
  if (key.id === "tone_none") return t("exercise.keyboard.toneNone");
  const shortcut = method === "vni" ? key.vni : key.telex;
  const tone = TONE_LABEL[key.id];
  return tone
    ? t("exercise.keyboard.toneKey", { tone: t(tone), shortcut })
    : t("exercise.keyboard.letterKey", { letter: key.label, shortcut });
}

export function VietnameseInput({ value, onChange, onSubmit, label, disabled = false, target = true }: Props) {
  const field = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(value.length);
  // Position à replacer après le rendu : la conversion (« as » → « á ») raccourcit le texte.
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const next = pending.current;
    if (next === null || !field.current) return;
    pending.current = null;
    field.current.setSelectionRange(next, next);
    setCaret(next);
  });

  const method = useInputMethod((s) => s.method);
  const setMethod = useInputMethod((s) => s.setMethod);

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const typed = event.currentTarget.value;
    const at = event.currentTarget.selectionStart ?? typed.length;
    // Langue d'interface : aucune conversion, c'est un champ ordinaire.
    const converted = target ? telexInput(value, typed, at, method) : null;
    if (converted) {
      pending.current = converted.caret;
      onChange(converted.value);
      return;
    }
    setCaret(at);
    onChange(typed);
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !onSubmit) return;
    event.preventDefault();
    onSubmit();
  };

  const apply = (keyId: string) => {
    const { start, end } = wordAround(value, caret);
    const word = value.slice(start, end);
    const next = applyDiacritic(word, keyId);
    if (next === word.normalize("NFC")) return;
    pending.current = start + next.length;
    onChange(value.slice(0, start) + next + value.slice(end));
    field.current?.focus();
  };

  const { start, end } = wordAround(value, caret);
  const keys = target ? describeDiacritics(value.slice(start, end)) : [];

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-2">
        <span className="text-phu-sa">{label}</span>
        <input
          ref={field}
          value={value}
          onChange={change}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? value.length)}
          onKeyDown={keyDown}
          disabled={disabled}
          type="text"
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          lang={target ? (activePackLang() ?? undefined) : undefined}
          data-testid="answer-input"
          className={`min-h-14 w-full rounded-2xl border-2 border-phu-sa/20 bg-white/80 px-4 text-lg disabled:text-phu-sa/70 ${target ? "font-serif" : ""}`}
        />
      </label>

      {target && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-7 gap-1" role="group" aria-label={t("exercise.keyboard.bar")} data-testid="diacritic-bar">
            {keys.map((key) => (
              <button
                key={key.id}
                type="button"
                data-key={key.id}
                disabled={disabled || key.preview === null}
                aria-label={keyLabel(key, method)}
                title={key.preview ?? undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(key.id)}
                className="min-h-11 rounded-xl border-2 border-phu-sa/15 bg-white/70 font-serif text-lg disabled:border-dashed disabled:bg-transparent disabled:text-phu-sa/35"
              >
                {key.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-phu-sa">{t("exercise.keyboard.method")}</span>
            {(["telex", "vni"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={method === option}
                disabled={disabled}
                onClick={() => setMethod(option)}
                data-method={option}
                className={`min-h-11 rounded-xl px-3 font-semibold ${method === option ? "bg-ngoc-sang text-ngoc" : "text-phu-sa"}`}
              >
                {t(option === "telex" ? "exercise.keyboard.telex" : "exercise.keyboard.vni")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
