import { afterEach, describe, expect, it } from "vitest";
import { usePrefs } from "../prefs.ts";
import { ensureMessages, messagesReady, t } from "./index.ts";

/** Chargement des chaînes par langue et domaine : t() synchrone, jamais de clé brute, langue du document suivie. */

afterEach(() => usePrefs.getState().setLocale(null));

describe("chaînes d'interface chargées à la demande", () => {
  it("après ensureMessages, tous les domaines sont prêts dans les deux langues", async () => {
    await ensureMessages("all", "en");
    expect(messagesReady("all", "fr")).toBe(true);
    expect(messagesReady("all", "en")).toBe(true);
    expect(t("offline.title", {}, "fr")).toBe("Hors ligne");
    expect(t("offline.title", {}, "en")).toBe("Offline");
    expect(t("offline.unit.download", { size: "2,4 Mo" }, "fr")).toBe("Rendre disponible hors ligne (≈ 2,4 Mo)");
  });

  it("clé inconnue (domaine non chargé) : chaîne vide, jamais la clé brute", () => {
    expect(t("inexistant.cle" as never)).toBe("");
  });

  it("langue du document = langue d'interface (lecteurs d'écran)", () => {
    usePrefs.getState().setLocale("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    usePrefs.getState().setLocale("fr");
    expect(document.documentElement.lang).toBe("fr");
  });
});
