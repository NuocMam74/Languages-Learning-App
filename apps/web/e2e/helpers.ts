import { expect, type Page } from "@playwright/test";

/** Aides partagées des parcours e2e (séance, onboarding). */

export async function onboard(page: Page, minutes = "5 min") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(page.getByRole("heading", { name: "Quelle langue veux-tu parler ?" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    const choice = i === 3 ? page.getByRole("button", { name: minutes, exact: true }) : page.locator("main button").first();
    await choice.click();
  }
  // Le placement n'est proposé que si assez d'items ont leur audio natif (contrat parcours §1).
  const placement = page.getByRole("heading", { name: "Un mini-test de 90 secondes ?" });
  // Depuis le contrat phase10 §1, une leçon qui introduit du nouveau s'ouvre sur sa fiche de
  // découverte : l'arrivée peut donc être la fiche **ou** le premier exercice.
  const lesson = page.locator('[data-testid="lesson"], [data-testid="lesson-intro"]');
  await expect(placement.or(lesson).first()).toBeVisible();
  if (await placement.isVisible()) await page.getByRole("button", { name: /^Passer/ }).click();
  await expect(page).toHaveURL(/\/lecon\/vi-south\.u01\.l01$/);
}

/** Répond à l'item affiché, juste ou non : la séance doit aller au bilan quoi qu'il arrive. */
export async function playOneStep(page: Page, finished: RegExp): Promise<"done" | "step"> {
  // Fiche de découverte (contrat phase10 §1) : une séance qui introduit du nouveau s'ouvre sur la
  // présentation des mots. Elle n'est pas un item — on la lit et on passe aux exercices.
  // On guette le **bouton**, pas la fiche : il vit dans la barre d'action de `Screen`, montée juste
  // après le corps de la fiche. Guetter la fiche puis cliquer le bouton laissait une fenêtre où le
  // premier était là et le second pas encore — le clic attendait alors sans fin.
  const introStart = page.getByTestId("intro-start");
  if (await introStart.isVisible().catch(() => false)) {
    await introStart.click({ timeout: 10_000 }).catch(() => {});
    return "step";
  }
  const heading = page.getByRole("heading", { name: finished });
  const session = page.locator('[data-testid="lesson"][data-status="answering"], [data-testid="lesson"][data-status="feedback"]');
  await expect(heading.or(session)).toBeVisible();
  if (await heading.isVisible()) return "done";

  const cursor = await session.getAttribute("data-cursor");
  const cont = page.getByRole("button", { name: "Continuer" });
  const done = page.getByRole("button", { name: "C'est fait" });
  const radio = page.getByRole("radio").first();
  const check = page.getByRole("button", { name: "Valider" });

  // Catalogue complet (contrat phase6) : appariement, dialogue à embranchements, écrits et écoute
  // globale ne se jouent pas comme un QCM. On répond au hasard : ce qui compte ici est que la
  // séance avance jusqu'au bilan, juste ou faux.
  const pairs = page.getByTestId("match-pairs");
  const dialogueTurn = page.getByTestId("dialogue-turn");
  const input = page.getByTestId("answer-input");
  const gistListen = page.getByTestId("gist-listen");
  const roleplay = page.getByTestId("roleplay");

  const wasFeedback = (await session.getAttribute("data-status")) === "feedback";
  if (wasFeedback) {
    await cont.click();
  } else if (await pairs.isVisible()) {
    const columns = pairs.locator("ul");
    const count = await columns.first().locator("button").count();
    for (let i = 0; i < count; i++) {
      await columns.first().locator("button").nth(i).click();
      await columns.last().locator("button").nth(i).click();
    }
    await check.click();
  } else if (await dialogueTurn.isVisible()) {
    for (let i = 0; i < 8 && !(await page.getByTestId("dialogue-summary").isVisible()); i++) {
      await page.getByRole("radio").first().click();
      if (await cont.isVisible()) await cont.click();
    }
    await check.click();
  } else if (await gistListen.isVisible()) {
    await gistListen.click();
    await expect(radio).toBeVisible({ timeout: 15_000 });
    await radio.click();
    await check.click();
  } else if (await input.isVisible()) {
    await input.fill("?");
    await check.click();
  } else if (await done.isVisible()) {
    await done.click();
    // Jeu de rôle : une réplique par prise, la même action revient jusqu'à la dernière.
    for (let i = 0; i < 4 && (await roleplay.isVisible()) && (await done.isVisible()); i++) await done.click();
  } else if (await radio.isVisible()) {
    await radio.click();
    await check.click();
  } else if (await check.isVisible()) {
    await page.locator("main .flex-wrap").last().locator("button:not([disabled])").first().click();
    await check.click();
  } else {
    await cont.first().click(); // carte culture, « Continuer sans jouer »
  }

  await expect(async () => {
    if (await heading.isVisible()) return;
    // Lecture atomique : pendant la transition vers le bilan l'écran de séance est démonté,
    // et getAttribute attendrait sans fin.
    const snap = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="lesson"]');
      return el ? { status: el.getAttribute("data-status"), cursor: el.getAttribute("data-cursor") } : null;
    });
    if (!snap) throw new Error("transition en cours");
    const status = snap.status;
    const moved = snap.cursor !== cursor;
    const freshQuestion = (await radio.isVisible()) && (await page.locator('[role="radio"][aria-checked="true"]').count()) === 0;
    const ready = (status === "feedback" && (await cont.first().isVisible())) || (status === "answering" && (moved || freshQuestion || wasFeedback));
    expect(ready).toBe(true);
  }).toPass({ timeout: 10_000 });
  return "step";
}

export async function playUntil(page: Page, finished: RegExp) {
  for (let i = 0; i < 120; i++) {
    if ((await playOneStep(page, finished)) === "done") return;
  }
  throw new Error("La séance ne se termine pas");
}

