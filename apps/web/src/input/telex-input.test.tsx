import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearInputMethod, useInputMethod } from "./method.ts";
import { VietnameseInput } from "./VietnameseInput.tsx";

/**
 * Clavier vietnamien intégré (spec §8.4) : la conversion vient de `@parlo/core` — ce qui est testé
 * ici, c'est le champ : frappe caractère par caractère, curseur, barre de diacritiques, méthode.
 */

const nfc = (s: string) => s.normalize("NFC");

function Harness({ target = true }: { target?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <>
      <VietnameseInput value={value} onChange={setValue} label="Réponse" target={target} />
      <output data-testid="value">{value}</output>
    </>
  );
}

/** Frappe caractère par caractère, comme un vrai clavier (valeur + curseur à chaque touche). */
function typeText(input: HTMLInputElement, text: string) {
  for (const ch of text) {
    const at = input.selectionStart ?? input.value.length;
    const next = input.value.slice(0, at) + ch + input.value.slice(at);
    fireEvent.change(input, { target: { value: next, selectionStart: at + 1 } });
  }
}

const field = () => screen.getByTestId("answer-input") as HTMLInputElement;
const value = () => screen.getByTestId("value").textContent;
const key = (id: string) => document.querySelector<HTMLButtonElement>(`[data-key="${id}"]`)!;

afterEach(cleanup);
beforeEach(() => clearInputMethod());

describe("VietnameseInput — frappe", () => {
  const cases: [string, string][] = [
    ["hoaf", "hòa"],
    ["ddi", "đi"],
    ["tieengs", "tiếng"],
    ["camr own", "cảm ơn"],
    ["Ddaay laf mas tooi", "Đây là má tôi"],
  ];
  for (const [typed, expected] of cases) {
    it(`telex : ${typed} → ${expected}`, () => {
      render(<Harness />);
      typeText(field(), typed);
      expect(value()).toBe(nfc(expected));
    });
  }

  it("le curseur suit la conversion : on peut continuer à taper", () => {
    render(<Harness />);
    const input = field();
    typeText(input, "mas");
    expect(input.selectionStart).toBe(2);
    typeText(input, " tooi");
    expect(value()).toBe(nfc("má tôi"));
  });

  it("champ en langue d'interface : aucune conversion, aucune barre (« Maman » reste « Maman »)", () => {
    render(<Harness target={false} />);
    typeText(field(), "Maman");
    expect(value()).toBe("Maman");
    expect(screen.queryByTestId("diacritic-bar")).toBeNull();
  });

  it("le champ n'est pas « corrigé » par le système et ne zoome pas à la mise au point", () => {
    render(<Harness />);
    const input = field();
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("inputmode")).toBe("text");
    // text-lg = 1.125rem = 18px ≥ 16px (seuil de zoom iOS).
    expect(input.className).toContain("text-lg");
  });
});

describe("VietnameseInput — méthode de saisie", () => {
  it("VNI : ma1 → má, et la méthode est mémorisée", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "VNI" }));
    typeText(field(), "ma1");
    expect(value()).toBe(nfc("má"));
    expect(localStorage.getItem("parlo.inputMethod")).toBe("vni");
    expect(useInputMethod.getState().method).toBe("vni");
  });

  it("les touches de la barre annoncent le raccourci de la méthode active", () => {
    render(<Harness />);
    expect(key("tone_sac").getAttribute("aria-label")).toContain("s");
    fireEvent.click(screen.getByRole("button", { name: "VNI" }));
    expect(key("tone_sac").getAttribute("aria-label")).toContain("1");
  });
});

describe("VietnameseInput — barre de diacritiques", () => {
  it("pose le ton sur le mot en cours, et seulement les touches utiles sont actives", () => {
    render(<Harness />);
    typeText(field(), "ma");
    expect(key("stroke_d").disabled).toBe(true);
    expect(key("circ_e").disabled).toBe(true);
    expect(key("tone_sac").disabled).toBe(false);
    // L'aperçu du mot obtenu est porté par la touche (spec §8.4).
    expect(key("tone_sac").title).toBe(nfc("má"));
    fireEvent.click(key("tone_sac"));
    expect(value()).toBe(nfc("má"));
  });

  it("n'agit que sur le dernier mot", () => {
    render(<Harness />);
    typeText(field(), "ba ma");
    fireEvent.click(key("tone_huyen"));
    expect(value()).toBe(nfc("ba mà"));
  });

  it("13 touches, toutes à portée du pouce", () => {
    render(<Harness />);
    const keys = [...screen.getByTestId("diacritic-bar").querySelectorAll("button")];
    expect(keys).toHaveLength(13);
    expect(keys.every((k) => k.className.includes("min-h-11"))).toBe(true);
  });
});
