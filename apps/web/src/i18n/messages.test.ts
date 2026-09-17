import { describe, expect, it } from "vitest";

/**
 * Complétude des chaînes d'interface (spec §2 : fr par défaut, en en seconde langue).
 * Tous les modules de i18n/messages (studio compris) sont lus directement, indépendamment du
 * mécanisme de chargement de i18n/index.ts. Même garde en CI : `npm run i18n:check`.
 */
type Module = { fr?: Record<string, string>; en?: Record<string, string> };

const files = import.meta.glob<Module>("./messages/*.ts", { eager: true });
const modules = Object.entries(files)
  .filter(([path]) => !path.endsWith("/index.ts") && !path.includes(".test."))
  .map(([path, mod]) => [path.replace("./messages/", ""), mod] as const);

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

describe("messages d'interface", () => {
  it("les modules sont trouvés", () => {
    expect(modules.map(([name]) => name)).toEqual(expect.arrayContaining(["base.ts", "studio.ts", "classes.ts", "games.ts", "exams.ts", "tutor.ts", "social.ts"]));
  });

  describe.each(modules)("%s", (_name, mod) => {
    it("exporte fr et en", () => {
      expect(mod.fr).toBeTypeOf("object");
      expect(mod.en).toBeTypeOf("object");
    });

    it("fr et en ont exactement les mêmes clés", () => {
      expect(Object.keys(mod.en ?? {}).sort()).toEqual(Object.keys(mod.fr ?? {}).sort());
    });

    it("aucune traduction vide", () => {
      const empty = Object.entries({ ...mod.fr, ...mod.en }).filter(([, text]) => typeof text !== "string" || text.trim() === "");
      expect(empty).toEqual([]);
    });

    it("mêmes placeholders en fr et en", () => {
      const diff = Object.entries(mod.fr ?? {})
        .filter(([key, fr]) => placeholders(fr).join(",") !== placeholders(mod.en?.[key] ?? "").join(","))
        .map(([key]) => key);
      expect(diff).toEqual([]);
    });

    it("paires singulier / pluriel complètes", () => {
      const keys = new Set(Object.keys(mod.fr ?? {}));
      const orphans = [...keys].filter((k) => k.endsWith(".plural") && !keys.has(k.slice(0, -".plural".length)));
      expect(orphans).toEqual([]);
    });
  });

  it("les clés des modules de l'apprenant ne se chevauchent pas", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [name, mod] of modules) {
      if (name === "studio.ts") continue; // dictionnaire séparé (studio/i18n.ts)
      for (const key of Object.keys(mod.fr ?? {})) {
        if (seen.has(key)) clashes.push(`${key} (${seen.get(key)} / ${name})`);
        else seen.set(key, name);
      }
    }
    expect(clashes).toEqual([]);
  });
});
