import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { dismissCelebrations, onboard, playOneStep, playUntil, skipBriefing } from "./helpers.ts";

/**
 * Performance et contenu hors ligne (audit mobile P1 #6, spec §8.1) :
 * démarrage sur core.json (jamais le bundle complet), démarrage à froid rapide sur réseau lent,
 * unité téléchargée jouée hors ligne sans visite préalable, purge LRU au-delà du quota,
 * mise à jour du contenu appliquée sans perdre la séance en cours.
 */

/** Le contenu que le build vient d'écrire : la source exacte de ce que le serveur d'aperçu sert. */
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/** Réseau « Fast 3G » des DevTools (latence 562,5 ms, 1,44 Mb/s descendant). */
async function throttle(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8, uploadThroughput: (750 * 1024 * 0.9) / 8 });
}

async function quitToHub(page: Page) {
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByTestId("hub-pack")).toBeVisible();
}

async function idbPut(page: Page, store: string, value: unknown) {
  await page.evaluate(
    async ({ store, value }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("parlo");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { store, value },
  );
}

async function idbGet<T>(page: Page, store: string, key: string): Promise<T | undefined> {
  return page.evaluate(
    async ({ store, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("parlo");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const value = await new Promise<unknown>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return value as never;
    },
    { store, key },
  );
}

const unitRow = (page: Page, unit: string) => page.locator(`[data-testid="offline-unit"][data-unit="${unit}"]`);

async function download(page: Page, unit: string) {
  await unitRow(page, unit).getByRole("button", { name: /Rendre disponible hors ligne \(≈ .+\)/ }).click();
  await expect(unitRow(page, unit)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

test("premier affichage : core.json seulement (pas de bundle), skeleton puis accueil ; démarrage à froid < 1,5 s en Fast 3G", async ({ page, context }) => {
  test.setTimeout(150_000);
  const content: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/content/")) content.push(new URL(r.url()).pathname);
  });

  // Premier passage, réseau lent, sans cache : l'accueil ne dépend que du core (petit) et du JS initial.
  await throttle(context, page);
  const start = Date.now();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Commencer" })).toBeVisible({ timeout: 30_000 });
  const firstVisitMs = Date.now() - start;
  const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null);
  console.log(`[perf] première visite Fast 3G : accueil en ${firstVisitMs} ms, FCP ${fcp === null ? "?" : Math.round(fcp)} ms`);
  expect(content.some((p) => /\/content\/vi-south\/v\d+\/core\.json$/.test(p))).toBe(true);
  expect(content.some((p) => p.endsWith("/bundle.json"))).toBe(false);

  // Installation (service worker, IndexedDB) puis relance à froid sur réseau lent.
  const fast = await context.newPage();
  await onboard(fast);
  await fast.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await quitToHub(fast);
  await fast.close();
  await page.close();

  const cold = await context.newPage();
  await throttle(context, cold);
  const t0 = Date.now();
  await cold.goto("/apprendre");
  // La séance laissée en cours reprend : l'écran utile est le parcours, l'exercice **ou** la fiche
  // de préparation. Les trois sont du contenu affiché — c'est ce que cette mesure chronomètre.
  await expect(cold.getByTestId("hub-pack").or(cold.locator('[data-testid="lesson"], [data-testid="lesson-intro"]')).first()).toBeVisible();
  const wallMs = Date.now() - t0;
  const shownAt = await cold.evaluate(() => performance.now());
  console.log(`[perf] démarrage à froid Fast 3G (service worker + IndexedDB) : contenu en ${Math.round(shownAt)} ms (horloge du test : ${wallMs} ms)`);
  expect(shownAt).toBeLessThan(1500);
});

test("unité téléchargée depuis les réglages : jouée hors ligne sans avoir été visitée", async ({ page, context }) => {
  test.setTimeout(150_000);
  await onboard(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await quitToHub(page);

  // Unité 4 : ni visitée ni préchargée (le préchargement ne prend que l'unité en cours et la suivante).
  await page.goto("/reglages");
  await expect(page.getByTestId("offline-settings")).toBeVisible();
  await expect(page.getByTestId("storage-estimate")).toBeVisible();
  expect(await idbGet(page, "units", "vi-south@1:vi-south.u04")).toBeUndefined();
  await download(page, "vi-south.u04");
  await expect(unitRow(page, "vi-south.u04")).toContainText(/Disponible hors ligne · .+/);
  expect(await idbGet(page, "units", "vi-south@1:vi-south.u04")).toBeDefined();
  // Placement : entrée au début de l'unité 4 (unités précédentes sautées) pour ouvrir sa première leçon.
  await idbPut(page, "kv", { key: "vi-south:placement", value: { levelEstimate: 2, entryLessonId: "vi-south.u04.l01", completedAt: new Date().toISOString() } });

  await context.setOffline(true);
  await page.goto("/lecon/vi-south.u04.l01");
  // Hors ligne aussi, la leçon s'ouvre sur sa préparation : les fiches voyagent dans core.json.
  await skipBriefing(page);
  const lesson = page.locator('[data-testid="lesson"][data-status="answering"]');
  await expect(lesson).toBeVisible();
  for (let i = 0; i < 3; i++) await playOneStep(page, /Leçon terminée/);
  await expect(page.locator('[data-testid="lesson"]')).toHaveAttribute("data-cursor", /[1-9]/);
  // Les images de l'unité viennent du cache (aucune image cassée).
  const broken = await page.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length);
  expect(broken).toBe(0);
});

test("quota dépassé : les unités les moins récemment utilisées sont retirées, jamais l'unité en cours", async ({ page }) => {
  test.setTimeout(150_000);
  await onboard(page);
  await quitToHub(page);
  await page.goto("/reglages");
  await expect(page.getByTestId("offline-settings")).toBeVisible();
  // Quota minuscule simulé : chaque nouveau téléchargement dépasse la limite.
  await page.evaluate(() => localStorage.setItem("parlo.offlineQuotaBytes", "1"));

  // Une unité emporte les unités dont elle reprend les mots, et le quota les protège avec elle
  // (contrat phase26 §2) : u03 et u04 reprennent toutes deux u00–u02, mais aucune ne reprend
  // l'autre. Télécharger u04 après u03 doit donc évincer u03, et elle seule parmi les trois.
  await download(page, "vi-south.u01"); // unité en cours
  await download(page, "vi-south.u03");
  await download(page, "vi-south.u04");
  await expect(unitRow(page, "vi-south.u03")).toHaveAttribute("data-state", "none");
  await expect(unitRow(page, "vi-south.u01")).toHaveAttribute("data-state", "ready");
  await expect(unitRow(page, "vi-south.u04")).toHaveAttribute("data-state", "ready");
  expect(await idbGet(page, "offlineUnits", "vi-south:vi-south.u03")).toBeUndefined();
});

test.describe(() => {
  // Réponses de contenu interceptées : service worker bloqué.
  test.use({ serviceWorkers: "block" });

  test("nouvelle version du pack publiée pendant une séance : la séance continue, la version s'applique ensuite", async ({ page }) => {
    test.setTimeout(240_000);
    await onboard(page);
    // On joue jusqu'à ce que le curseur avance vraiment : consulter la fiche de préparation et
    // refermer une correction prennent des tours sans faire bouger la séance.
    let cursor: string | null = null;
    for (let i = 0; i < 10 && Number(cursor ?? 0) === 0; i++) {
      await playOneStep(page, /Leçon terminée/);
      cursor = await page.locator('[data-testid="lesson"]').getAttribute("data-cursor").catch(() => null);
    }
    expect(Number(cursor)).toBeGreaterThan(0);

    // Version 2 publiée (sans rebuild) : manifeste statique, core et unités de la v2.
    await page.route("**/api/courses/vi-south/manifest", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.route("**/content/vi-south/latest.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: "vi-south", version: 2 }) }));
    /*
     * La v2 est fabriquée **depuis le disque**, pas par `page.request.get`.
     *
     * L'ancienne version allait rechercher la v1 par le réseau, depuis l'intérieur du gestionnaire
     * de route. Or ces unités sont demandées **après** le rechargement final : la page navigue
     * pendant que la requête est en vol, sa réponse est libérée, et le gestionnaire lève
     * « Response has been disposed ». Une course, donc : elle tombait ou non selon la vitesse de la
     * machine et le temps passé au bilan. Lire le fichier que le build vient d'écrire donne
     * exactement le même contenu, sans course et sans réseau.
     */
    const v1 = (name: string) => JSON.parse(readFileSync(join(DIST, "content", "vi-south", "v1", name), "utf8")) as Record<string, unknown>;

    await page.route("**/content/vi-south/v2/core.json", async (route) => {
      const core = v1("core.json") as { pack: { version: number }; lessonIndex: { id: string; title: { fr: string } }[] };
      core.pack.version = 2;
      core.lessonIndex.find((l) => l.id === "vi-south.u01.l02")!.title.fr = "Nouvelle version publiée";
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(core) });
    });
    await page.route("**/content/vi-south/v2/units/*.json", async (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
      const unit = v1(join("units", name)) as { version: number; lessons: { id: string; title: { fr: string } }[] };
      unit.version = 2;
      for (const lesson of unit.lessons) if (lesson.id === "vi-south.u01.l02") lesson.title.fr = "Nouvelle version publiée";
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(unit) });
    });

    // Relance au milieu de la séance : reprise exacte, la v2 attend.
    await page.reload();
    await expect(page.locator('[data-testid="lesson"]')).toHaveAttribute("data-cursor", cursor ?? "");
    await expect.poll(async () => (await idbGet<{ version: number }>(page, "packs", "vi-south#pending"))?.version, { timeout: 20_000 }).toBe(2);
    expect((await idbGet<{ version: number }>(page, "packs", "vi-south"))?.version).toBe(1);

    await playUntil(page, /Leçon terminée/);
    await dismissCelebrations(page);
    await page.getByRole("button", { name: "Retour au parcours" }).click();
    await expect(page.getByTestId("hub-pack")).toBeVisible();

    // Séance terminée : la v2 s'applique au démarrage suivant, sans perte de progression.
    await page.reload();
    // Le titre de la v2 est sur la carte. On ne l'exige pas comme **lien** : depuis le contrat
    // phase10 §3, la leçon suivante ne s'ouvre qu'une fois la précédente réussie, et on répond
    // ici au hasard. Ce que cette ligne vérifie, c'est que la nouvelle version s'est appliquée.
    await expect(page.getByText("Nouvelle version publiée")).toBeVisible();
    expect((await idbGet<{ version: number }>(page, "packs", "vi-south"))?.version).toBe(2);
    expect(await idbGet(page, "lessonProgress", "vi-south.u01.l01")).toBeDefined();
  });
});
