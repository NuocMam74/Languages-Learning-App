import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { onboard, playUntil } from "./helpers.ts";

/**
 * Phase 3 — deuxième pack (ADR 0006, contrat phase3 §5) : un apprenant du vietnamien du Sud
 * choisit l'espagnol, termine une leçon hors ligne, revient au vietnamien sans rien perdre,
 * et les deux progressions survivent au redémarrage.
 */

const CONTENT = join(import.meta.dirname, "..", "..", "..", "content");
const readJson = <T>(...parts: string[]) => JSON.parse(readFileSync(join(CONTENT, ...parts), "utf8")) as T;
const esName = readJson<{ name: { fr: string } }>("es", "pack.json").name.fr;
const viName = readJson<{ name: { fr: string } }>("vi-south", "pack.json").name.fr;
const titleOf = (pack: string, unit: string, lesson: string) => readJson<{ title: { fr: string } }>(pack, "lessons", unit, `${lesson}.json`).title.fr;

async function finishLesson(page: Page) {
  await playUntil(page, /^Leçon terminée$/);
  await expect(page.getByText(/^\+\d+ XP$/)).toBeVisible();
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page.getByTestId("hub-pack")).toBeVisible();
}

async function hubXp(page: Page): Promise<string> {
  const xp = page.getByText(/^\d+ XP$/);
  await expect(xp).toBeVisible();
  return (await xp.textContent()) ?? "";
}

test("espagnol hors ligne, retour au vietnamien intact, les deux progressions persistent", async ({ page, context }) => {
  test.setTimeout(300_000);

  // 1. Vietnamien du Sud (parcours existant) : une leçon terminée.
  await onboard(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await finishLesson(page);
  await expect(page.getByTestId("hub-pack")).toHaveText(viName);
  const viXp = await hubXp(page);
  expect(viXp).not.toBe("0 XP");

  // 2. Changer de langue depuis le hub : l'espagnol est sélectionnable (plus « bientôt »).
  await page.getByTestId("hub-pack").click();
  await expect(page.getByRole("heading", { name: "Quelle langue veux-tu parler ?" })).toBeVisible();
  const esRadio = page.getByRole("radio", { name: esName });
  await expect(esRadio).toBeVisible();
  await expect(page.getByText(/Espagnol · bientôt/)).toHaveCount(0);
  await esRadio.click();
  await page.getByRole("button", { name: "Continuer" }).click();

  // Onboarding propre au pack, sans placement (le pack n'en a pas) : directement la première leçon.
  await expect(page).toHaveURL(/\/onboarding$/);
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    await page.locator("main button").first().click();
  }
  await expect(page).toHaveURL(/\/lecon\/es\.u01\.l01$/);

  // 3. Leçon d'espagnol hors ligne.
  await context.setOffline(true);
  await finishLesson(page);
  await expect(page.getByTestId("hub-pack")).toHaveText(esName);
  const esXp = await hubXp(page);
  expect(esXp).not.toBe("0 XP");
  await expect(page.getByRole("link", { name: titleOf("es", "u01", "l02") })).toBeVisible();

  // 4. Retour au vietnamien depuis les réglages, toujours hors ligne : progression intacte.
  await page.getByRole("link", { name: "Réglages" }).click();
  const viRadio = page.getByRole("radio", { name: viName });
  await expect(viRadio).toBeEnabled();
  await viRadio.click();
  await expect(page.getByTestId("hub-pack")).toHaveText(viName);
  await expect(page.getByText(/^\d+ XP$/)).toHaveText(viXp);
  await expect(page.getByRole("link", { name: titleOf("vi-south", "u01", "l01") })).toBeVisible();
  await expect(page.getByRole("link", { name: titleOf("vi-south", "u01", "l02") })).toBeVisible();

  // 5. Redémarrage à froid : le pack actif et sa progression sont relus depuis IndexedDB.
  await page.reload();
  await expect(page.getByTestId("hub-pack")).toHaveText(viName);
  await expect(page.getByText(/^\d+ XP$/)).toHaveText(viXp);

  // L'espagnol aussi a gardé sa progression (déjà onboardé : retour direct au hub).
  await page.getByTestId("hub-pack").click();
  await page.getByRole("radio", { name: esName }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByTestId("hub-pack")).toHaveText(esName);
  await expect(page.getByText(/^\d+ XP$/)).toHaveText(esXp);
  await page.reload();
  await expect(page.getByTestId("hub-pack")).toHaveText(esName);
  await expect(page.getByText(/^\d+ XP$/)).toHaveText(esXp);
  await expect(page.getByRole("link", { name: titleOf("es", "u01", "l01") })).toBeVisible();

  // Les changements de langue sont journalisés pour la synchronisation (outbox commune).
  const switches = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("outbox").objectStore("outbox").getAll();
          req.onsuccess = () => resolve((req.result as { event: { type: string; payload: unknown } }[]).filter((r) => r.event.type === "pack_switched").map((r) => r.event.payload));
          req.onerror = () => reject(req.error);
        };
      }),
  );
  expect(switches).toEqual([
    { fromPack: null, toPack: "vi-south" },
    { fromPack: "vi-south", toPack: "es" },
    { fromPack: "es", toPack: "vi-south" },
    { fromPack: "vi-south", toPack: "es" },
  ]);
});
