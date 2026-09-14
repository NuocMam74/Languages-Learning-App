import { expect, test, type Page } from "@playwright/test";

/**
 * Critère d'acceptation Phase 0 (spec §15) : un utilisateur invité termine une
 * leçon hors ligne, et sa progression est conservée après redémarrage.
 */

async function onboard(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await page.getByRole("button", { name: "Commencer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    await page.locator("main button").first().click();
  }
  await expect(page).toHaveURL(/\/lecon\/vi-south\.u01\.l01$/);
}

/** Répond à l'étape affichée, juste ou non : la leçon doit se terminer quoi qu'il arrive. */
async function playOneStep(page: Page): Promise<"done" | "step"> {
  const finished = page.getByRole("heading", { name: "Leçon terminée" });
  const lesson = page.locator('[data-testid="lesson"][data-status="answering"], [data-testid="lesson"][data-status="feedback"]');
  await expect(finished.or(lesson)).toBeVisible();
  if (await finished.isVisible()) return "done";

  const cursor = await lesson.getAttribute("data-cursor");
  const cont = page.getByRole("button", { name: "Continuer" });
  const done = page.getByRole("button", { name: "C'est fait" });
  const radio = page.getByRole("radio").first();
  const check = page.getByRole("button", { name: "Valider" });

  const wasFeedback = (await lesson.getAttribute("data-status")) === "feedback";
  if (wasFeedback) {
    await cont.click(); // correction affichée après une erreur
  } else if (await done.isVisible()) {
    await done.click();
  } else if (await radio.isVisible()) {
    await radio.click();
    await check.click();
  } else if (await check.isVisible()) {
    await page.locator("main .flex-wrap").last().locator("button:not([disabled])").first().click();
    await check.click();
  } else {
    await cont.click(); // carte culture, mini-jeu à venir
  }

  // Attend un nouvel état stable : correction affichée, étape suivante, question de la carte culture, ou fin.
  await expect(async () => {
    if (await finished.isVisible()) return;
    const el = page.getByTestId("lesson");
    const status = await el.getAttribute("data-status");
    const moved = (await el.getAttribute("data-cursor")) !== cursor;
    const freshQuestion = (await radio.isVisible()) && (await page.locator('[role="radio"][aria-checked="true"]').count()) === 0;
    const ready = (status === "feedback" && (await cont.isVisible())) || (status === "answering" && (moved || freshQuestion || wasFeedback));
    expect(ready).toBe(true);
  }).toPass({ timeout: 10_000 });
  return "step";
}

async function finishLesson(page: Page) {
  for (let i = 0; i < 60; i++) {
    if ((await playOneStep(page)) === "done") return;
  }
  throw new Error("La leçon ne se termine pas");
}

test("un invité termine une leçon hors ligne et la retrouve après redémarrage", async ({ page, context }) => {
  await onboard(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  await context.setOffline(true);
  await finishLesson(page);
  await expect(page.getByText(/^\+\d+ XP$/)).toBeVisible();
  await page.getByRole("button", { name: "Retour au parcours" }).click();

  const xpBefore = await page.getByText(/^\d+ XP$/).textContent();
  expect(xpBefore).not.toBe("0 XP");

  // Redémarrage à froid, toujours hors ligne : servi par le service worker, état depuis IndexedDB.
  await page.reload();
  await expect(page.getByText("Hors ligne", { exact: false })).toBeVisible();
  await expect(page.getByText(/^\d+ XP$/)).toHaveText(xpBefore ?? "");
  await expect(page.getByText("1 jour de suite")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cinq tons à entendre" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible();
});

test("une leçon interrompue reprend exactement au même endroit", async ({ page }) => {
  await onboard(page);
  for (let i = 0; i < 3; i++) await playOneStep(page);
  const progress = page.getByRole("progressbar");
  const before = await progress.getAttribute("aria-valuenow");
  expect(Number(before)).toBeGreaterThan(0);

  await page.goto("/");
  await expect(page).toHaveURL(/\/lecon\/vi-south\.u01\.l01$/);
  await expect(progress).toHaveAttribute("aria-valuenow", before ?? "");
});
