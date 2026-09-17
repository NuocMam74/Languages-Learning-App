import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, resolvedTheme } from "../theme.ts";
import { usePrefs } from "../prefs.ts";
import { CelebrationLayer } from "./Celebration.tsx";
import { useCelebrations } from "./celebrate.ts";
import type { Celebration } from "./store.ts";

/**
 * La carte de félicitations (contrat phase9 §5) et le thème (§8).
 *
 * Ce qui est vérifié, c'est ce que la personne voit : son **nom** (jamais « utilisateur »), une
 * carte à la fois, un vrai dialogue qu'Échap ferme — et un thème appliqué sur `<html>`.
 */

beforeEach(() => {
  useCelebrations.getState().reset();
  // Le mode silencieux coupe les sons : un test ne doit pas dépendre de WebAudio.
  usePrefs.setState({ silent: true, feedbackSounds: false, theme: "system" });
});
afterEach(() => {
  cleanup();
  useCelebrations.getState().reset();
  applyTheme("system");
});

const coins: Celebration = { kind: "coins", coins: 25 };
const level: Celebration = { kind: "level", level: 4, name: { fr: "Người mới" } };

describe("félicitations", () => {
  it("ne montre rien quand il n'y a rien à fêter", () => {
    render(<CelebrationLayer />);
    expect(screen.queryByTestId("celebration")).toBeNull();
  });

  it("appelle la personne par le nom de son profil", () => {
    useCelebrations.setState({ queue: [coins], name: "Mai" });
    render(<CelebrationLayer />);
    expect(screen.getByTestId("celebration").textContent).toContain("Mai");
  });

  it("dit « bravo » sans nom plutôt que d'en inventer un", () => {
    useCelebrations.setState({ queue: [coins], name: null });
    render(<CelebrationLayer />);
    const text = screen.getByTestId("celebration").textContent ?? "";
    expect(text).toContain("Bravo");
    // Jamais de mot-valise à la place d'un prénom.
    expect(text.toLowerCase()).not.toContain("utilisateur");
    expect(text).not.toContain("{name}");
  });

  it("montre une carte à la fois, dans l'ordre, et annonce ce qui reste", () => {
    useCelebrations.setState({ queue: [level, coins], name: "Mai" });
    render(<CelebrationLayer />);
    expect(screen.getAllByTestId("celebration")).toHaveLength(1);
    expect(screen.getByTestId("celebration").dataset.kind).toBe("level");
    expect(screen.getByTestId("celebration-remaining").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("celebration-ok"));
    expect(screen.getByTestId("celebration").dataset.kind).toBe("coins");
    expect(screen.queryByTestId("celebration-remaining")).toBeNull();

    fireEvent.click(screen.getByTestId("celebration-ok"));
    expect(screen.queryByTestId("celebration")).toBeNull();
  });

  it("nomme le palier de niveau du pack quand il y en a un", () => {
    useCelebrations.setState({ queue: [level], name: null });
    render(<CelebrationLayer />);
    expect(screen.getByTestId("celebration").textContent).toContain("Người mới");
  });

  it("est un dialogue : rôle, focus posé, et Échap ferme", () => {
    useCelebrations.setState({ queue: [coins], name: "Mai" });
    render(<CelebrationLayer />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId("celebration-ok"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("celebration")).toBeNull();
  });

  it("la file ignore une salve vide et empile les suivantes", () => {
    const { celebrate } = useCelebrations.getState();
    celebrate([]);
    expect(useCelebrations.getState().queue).toHaveLength(0);
    celebrate([coins]);
    celebrate([level]);
    expect(useCelebrations.getState().queue.map((c) => c.kind)).toEqual(["coins", "level"]);
  });
});

describe("thème", () => {
  it("ne publie rien en mode système : `prefers-color-scheme` décide seul", () => {
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe(resolvedTheme("system"));
  });

  it("publie un choix explicite sur `<html>`, dans les deux sens", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("résout « système » sans matchMedia (aucun écran ne doit planter pour si peu)", () => {
    const original = window.matchMedia;
    // @ts-expect-error — on retire volontairement l'API pour vérifier le repli.
    delete window.matchMedia;
    expect(resolvedTheme("system")).toBe("light");
    expect(resolvedTheme("dark")).toBe("dark");
    window.matchMedia = original;
  });
});
