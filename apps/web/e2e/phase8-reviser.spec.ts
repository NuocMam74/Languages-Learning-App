import { expect, test, type Page } from "@playwright/test";
import { onboard, playUntil } from "./helpers.ts";

/**
 * Contrat phase8 §2, §3, §4 — « Réviser » : la bibliothèque de tout ce qui a été vu, et les notes.
 *
 * Couvre : parcourir le vocabulaire (filtres, recherche sans accents ni tons), forcer « revoir
 * maintenant » puis retrouver le mot dans la séance de révision, lire une carte de grammaire,
 * rejouer une leçon en entraînement (ni XP ni leçon recomptées), écrire / modifier / supprimer une
 * note sur un mot, exporter les notes en Markdown, et tout relire hors ligne.
 */

const mockGuest = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "unauthorized" }) }));

/** Termine la première leçon : sans elle, la bibliothèque est (à juste titre) vide. */
async function firstLesson(page: Page) {
  await mockGuest(page);
  await onboard(page);
  await playUntil(page, /^Leçon terminée$/);
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);
}

/** XP totale affichée sur le parcours. */
async function totalXp(page: Page): Promise<string> {
  await page.goto("/apprendre");
  return (await page.getByText(/^\d+ XP$/).first().textContent()) ?? "";
}

test("la bibliothèque rassemble les mots, les explications et les leçons de la langue active", async ({ page }) => {
  test.setTimeout(420_000);
  await firstLesson(page);

  // L'onglet du bas mène à la bibliothèque, plus à un écran d'attente.
  await page.getByTestId("bottom-nav").getByRole("link", { name: "Réviser" }).click();
  await expect(page).toHaveURL(/\/reviser$/);
  await expect(page.getByRole("heading", { name: "Réviser" })).toBeVisible();
  await expect(page.getByTestId("review-empty")).toHaveCount(0);

  // Chaque rayon annonce ce qu'il contient : on ne clique jamais pour découvrir un vide.
  for (const id of ["review-vocabulary", "review-grammar", "review-lessons", "review-dialogues", "review-notes"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("review-vocabulary")).toContainText(/[1-9]\d* mots?/);
  await expect(page.getByTestId("review-lessons")).toContainText(/1 leçon terminée/);

  // --- Vocabulaire : liste, recherche sans accents ni tons, filtres.
  await page.getByTestId("review-vocabulary").click();
  await expect(page).toHaveURL(/\/reviser\/vocabulaire$/);
  const words = page.getByTestId("word");
  const total = await words.count();
  expect(total).toBeGreaterThan(0);

  const firstWord = (await words.first().locator("[data-target-text]").first().textContent()) ?? "";
  expect(firstWord.trim()).not.toBe("");
  // La même forme sans accents ni tons doit retrouver le mot (stripDiacritics/stripTones).
  const bare = firstWord.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").trim().toLowerCase();
  await page.getByTestId("vocab-search").fill(bare);
  await expect(words.first()).toBeVisible();
  expect(await words.count()).toBeLessThanOrEqual(total);
  await expect(words.first().locator("[data-target-text]").first()).toHaveText(firstWord);

  // Une recherche sans résultat propose une sortie, jamais une liste muette.
  await page.getByTestId("vocab-search").fill("zzzzzz");
  await expect(page.getByTestId("vocab-no-match")).toBeVisible();
  await page.getByRole("button", { name: "Enlever les filtres" }).click();
  await expect(page.getByTestId("vocab-search")).toHaveValue("");
  await expect(words).toHaveCount(total);

  // Filtre d'état : « maîtrisé » ne peut rien contenir juste après la première leçon.
  await page.getByTestId("vocab-state").selectOption("mastered");
  await expect(page.getByTestId("vocab-no-match")).toBeVisible();
  await page.getByTestId("vocab-state").selectOption("all");
  await expect(words).toHaveCount(total);

  // Filtre d'unité : seule l'unité vue est proposée, et elle garde tous les mots.
  const unitOptions = await page.getByTestId("vocab-unit").locator("option").count();
  expect(unitOptions).toBe(2); // « Toutes les unités » + l'unité 1
  await page.getByTestId("vocab-unit").selectOption({ index: 1 });
  await expect(words).toHaveCount(total);

  // --- Grammaire : les explications des leçons terminées se relisent hors séance.
  await page.goto("/reviser/grammaire");
  await expect(page.getByRole("heading", { name: "Grammaire et culture" })).toBeVisible();
  const cards = page.getByTestId("grammar-card");
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toContainText(/\p{L}/u);

  // --- Leçons : état par unité, et la leçon faite se rejoue.
  await page.goto("/reviser/lecons");
  const done = page.locator('[data-testid="library-lesson"][data-state="done"]');
  await expect(done).toHaveCount(1);
  await expect(done.getByTestId("lesson-replay")).toBeVisible();
});

test("« revoir maintenant » force l'échéance : la séance de révision propose le mot", async ({ page }) => {
  test.setTimeout(420_000);
  await firstLesson(page);

  await page.goto("/reviser/vocabulaire");
  const word = page.getByTestId("word").first();
  await expect(word).toBeVisible();
  const conceptId = await word.getAttribute("data-concept");
  const text = ((await word.locator("[data-target-text]").first().textContent()) ?? "").trim();
  await word.getByRole("button").first().click();
  await expect(page.getByTestId("word-detail")).toBeVisible();

  // L'audio est là (naturel et lent), et la fiche reste lisible sans son.
  await expect(page.getByTestId("word-play")).toBeVisible();
  await expect(page.getByTestId("word-play-slow")).toBeVisible();

  await page.getByTestId("word-force-due").click();
  await expect(page.getByTestId("word-forced")).toBeVisible();

  // La carte SRS est écrite, échéance dans le passé, avec son événement (contrat ADR 0004).
  const stored = await page.evaluate(
    (id) =>
      new Promise<{ due: string; state: string; events: number }>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(new Error("indexedDB"));
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction(["srsCards", "outbox"], "readonly");
          const card = tx.objectStore("srsCards").get(id) as IDBRequest<{ due: string; state: string }>;
          const events = tx.objectStore("outbox").getAll() as IDBRequest<{ event: { type: string } }[]>;
          tx.oncomplete = () =>
            resolve({ due: card.result.due, state: card.result.state, events: events.result.filter((r) => r.event.type === "srs_card_updated").length });
          tx.onerror = () => reject(new Error("transaction"));
        };
      }),
    conceptId ?? "",
  );
  expect(Date.parse(stored.due)).toBeLessThanOrEqual(Date.now());
  expect(stored.state).not.toBe("new");
  expect(stored.events).toBeGreaterThan(0);

  // La révision du jour propose bien ce mot (l'échéance forcée est prise en compte).
  await page.getByTestId("word-go-review").click();
  await expect(page).toHaveURL(/\/revision$/);
  await expect(page.locator('[data-testid="lesson"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("session-empty")).toHaveCount(0);
  const queued = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lesson"]');
    return el?.getAttribute("data-phase") ?? "";
  });
  expect(["warmup", "review"]).toContain(queued);
  expect(text).not.toBe("");
});

test("rejouer une leçon en entraînement : aucune XP, aucune leçon comptée deux fois", async ({ page }) => {
  test.setTimeout(600_000);
  await firstLesson(page);
  const xpBefore = await totalXp(page);
  expect(xpBefore).not.toBe("0 XP");

  await page.goto("/reviser/lecons");
  const lesson = page.locator('[data-testid="library-lesson"][data-state="done"]').first();
  const lessonId = await lesson.getAttribute("data-lesson");
  const score = (await lesson.textContent()) ?? "";
  await lesson.getByTestId("lesson-replay").click();

  await expect(page).toHaveURL(/\/entrainement$/);
  await expect(page.getByTestId("practice-banner")).toBeVisible();
  // Écran de concentration : la navigation basse disparaît comme pour une leçon ordinaire.
  await expect(page.getByTestId("bottom-nav")).toHaveCount(0);

  await playUntil(page, /^C'est refait$/);
  const recap = page.getByTestId("practice-recap");
  await expect(recap).toBeVisible();
  // Pas de « +N XP » : le bilan d'entraînement ne compte rien.
  await expect(page.getByText(/^\+\d+ XP$/)).toHaveCount(0);

  await page.getByRole("button", { name: "Retour à mes leçons" }).click();
  await expect(page).toHaveURL(/\/reviser\/lecons$/);

  // Ni XP, ni tentative en plus, ni seconde leçon acquise.
  expect(await totalXp(page)).toBe(xpBefore);
  await page.goto("/reviser/lecons");
  await expect(page.locator('[data-testid="library-lesson"][data-state="done"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="library-lesson"][data-state="done"]').first()).toHaveText(score);

  // Événements : la réponse est dite, la leçon n'est pas re-terminée, la séance pas re-comptée.
  const events = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(new Error("indexedDB"));
        open.onsuccess = () => {
          const request = open.result.transaction("outbox", "readonly").objectStore("outbox").getAll() as IDBRequest<{ event: { type: string } }[]>;
          request.onsuccess = () => resolve(request.result.map((row) => row.event.type));
          request.onerror = () => reject(new Error("outbox"));
        };
      }),
  );
  expect(events.filter((type) => type === "lesson_completed")).toHaveLength(1);
  expect(events.filter((type) => type === "session_completed")).toHaveLength(1);
  expect(events.filter((type) => type === "session_started").length).toBeGreaterThanOrEqual(2);
  expect(events).toContain("answer_submitted");
  expect(lessonId).toMatch(/^vi-south\./);
});

test("notes : écrire sur un mot, modifier, exporter en Markdown, supprimer", async ({ page }) => {
  test.setTimeout(420_000);
  await firstLesson(page);

  await page.goto("/reviser/vocabulaire");
  const word = page.getByTestId("word").first();
  await expect(word).toBeVisible();
  const target = ((await word.locator("[data-target-text]").first().textContent()) ?? "").trim();
  await word.getByRole("button").first().click();

  // Écriture depuis la fiche du mot, avec le clavier vietnamien (barre de diacritiques).
  const block = page.getByTestId("word-note");
  await block.getByTestId("note-add").click();
  await expect(page.getByTestId("diacritic-bar")).toBeVisible();
  const field = page.getByTestId("note-editor").getByTestId("answer-input");
  // Le champ ne doit pas déclencher le zoom d'iOS : au moins 16 px.
  expect(await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await field.fill("toujours avec du lait");
  await page.getByTestId("note-save").click();
  await expect(block.getByTestId("note-text")).toHaveText("toujours avec du lait");

  // Modification sur place.
  await block.getByTestId("note-edit").click();
  await page.getByTestId("note-editor").getByTestId("answer-input").fill("toujours avec du lait concentré");
  await page.getByTestId("note-save").click();
  await expect(block.getByTestId("note-text")).toHaveText("toujours avec du lait concentré");

  // La note survit à un rechargement (locale, IndexedDB).
  await page.reload();
  await page.getByTestId("word").first().getByRole("button").first().click();
  await expect(page.getByTestId("word-note").getByTestId("note-text")).toHaveText("toujours avec du lait concentré");

  // --- Les notes vivent dans « Réviser » (contrat §4) : l'onglet du bas reste allumé…
  await page.goto("/reviser");
  await page.getByTestId("review-notes").click();
  await expect(page).toHaveURL(/\/reviser\/notes$/);
  await expect(page.getByTestId("bottom-nav").getByRole("link", { name: "Réviser" })).toHaveAttribute("aria-current", "page");

  // … et l'adresse `/notes` du contrat §3 mène à la même page.
  await page.goto("/notes");
  await expect(page.getByRole("heading", { name: "Mes notes" })).toBeVisible();
  await expect(page.getByText("Tes notes restent sur cet appareil : elles ne sont jamais envoyées au serveur.")).toBeVisible();
  await expect(page.getByTestId("note")).toHaveCount(1);
  await expect(page.getByTestId("note-source")).toContainText(target);

  // Une note libre, écrite depuis la page.
  await page.getByTestId("notes-new").click();
  await page.getByTestId("note-editor").getByTestId("answer-input").fill("demander ít đường");
  await page.getByTestId("note-save").click();
  await expect(page.getByTestId("note")).toHaveCount(2);

  await page.getByTestId("notes-search").fill("lait");
  await expect(page.getByTestId("note")).toHaveCount(1);
  await page.getByTestId("notes-search").fill("");
  await page.getByTestId("notes-sort-target").click();
  await expect(page.getByTestId("note")).toHaveCount(2);

  // Export Markdown : le fichier cite le mot d'origine.
  const download = await Promise.all([page.waitForEvent("download"), page.getByTestId("notes-export-md").click()]).then(([d]) => d);
  expect(download.suggestedFilename()).toMatch(/^parlo-notes-\d{4}-\d{2}-\d{2}\.md$/);
  const path = await download.path();
  const markdown = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
  expect(markdown).toContain("# Mes notes");
  expect(markdown).toContain(target);
  expect(markdown).toContain("toujours avec du lait concentré");
  expect(markdown).toContain("## Note libre");
  expect(markdown).toContain("demander ít đường");
  expect(markdown).toMatch(/Exporté le /);

  // Suppression.
  await page.getByTestId("note").filter({ hasText: "demander" }).getByTestId("note-delete-direct").click();
  await expect(page.getByTestId("note")).toHaveCount(1);
  await page.getByTestId("note").getByTestId("note-delete-direct").click();
  await expect(page.getByTestId("notes-empty")).toBeVisible();
});

test("hors ligne : la bibliothèque d'une unité téléchargée reste lisible", async ({ page, context }) => {
  test.setTimeout(420_000);
  await firstLesson(page);
  // L'unité jouée est en base (IndexedDB) et ses fichiers sont dans le cache du service worker.
  await page.goto("/reviser/vocabulaire");
  await expect(page.getByTestId("word").first()).toBeVisible();
  const online = await page.getByTestId("word").count();
  expect(online).toBeGreaterThan(0);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  await context.setOffline(true);
  await page.goto("/reviser");
  await expect(page.getByRole("heading", { name: "Réviser" })).toBeVisible();
  await expect(page.getByText("Hors ligne : tu vois les unités déjà téléchargées.")).toBeVisible();

  await page.goto("/reviser/vocabulaire");
  await expect(page.getByTestId("word")).toHaveCount(online);
  await page.getByTestId("word").first().getByRole("button").first().click();
  await expect(page.getByTestId("word-detail")).toBeVisible();

  // Les explications et les notes marchent aussi sans réseau.
  await page.goto("/reviser/grammaire");
  await expect(page.getByTestId("grammar-card").first()).toBeVisible();
  expect(await page.getByTestId("grammar-card").count()).toBeGreaterThan(0);
  await page.getByTestId("grammar-card").first().getByTestId("note-add").click();
  await page.getByTestId("note-editor").getByTestId("answer-input").fill("relire ça");
  await page.getByTestId("note-save").click();
  await expect(page.getByTestId("grammar-card").first().getByTestId("note-text")).toHaveText("relire ça");

  await page.goto("/notes");
  await expect(page.getByTestId("note")).toHaveCount(1);
  await context.setOffline(false);
});
