import { expect, test, type Page } from "@playwright/test";
import { dismissCelebrations, onboard, openAllBriefingPanels, playUntil, skipBriefing } from "./helpers.ts";

/**
 * Changer d'appareil (contrat phase17) et favoris (contrat phase18).
 *
 * Deux promesses qui ne se vérifient qu'en vrai, parce qu'elles traversent l'application entière :
 *   1. ce qui sort d'un appareil rentre dans un autre — progression, réglages, favoris compris ;
 *   2. un exercice aimé se retrouve et se rejoue **seul**, sans refaire toute la leçon.
 */

const mockGuest = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "unauthorized" }) }));

test("aimer un exercice, le retrouver, le rejouer seul", async ({ page }) => {
  test.setTimeout(300_000);
  await mockGuest(page);
  await onboard(page);
  await skipBriefing(page);

  // Le cœur vit dans l'en-tête de l'exercice : c'est là qu'on sait si on l'aime.
  const heart = page.getByTestId("favorite-button");
  await expect(heart).toHaveAttribute("data-liked", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("data-liked", "true");
  const liked = await heart.getAttribute("data-favorite");
  expect(liked).toMatch(/^vi-south\.u01\.l01#\d+$/);

  await playUntil(page, /^Leçon terminée$/);
  // Les félicitations se posent **par-dessus** le bilan et interceptent les clics : on les referme
  // d'abord, comme le ferait un apprenant. Elles arrivent après le bilan, d'où `dismissCelebrations`
  // qui leur laisse le temps de monter plutôt qu'un test d'affichage immédiat.
  await dismissCelebrations(page);
  // Et la leçon qu'on vient de finir s'aime depuis le bilan.
  await page.getByTestId("recap-favorite").getByTestId("favorite-button").click();
  await page.getByRole("button", { name: "Retour au parcours" }).click();

  // On les retrouve au même endroit, séparés : les leçons, les exercices.
  await page.goto("/reviser/favoris");
  await expect(page.getByTestId("favorites-lessons")).toBeVisible();
  await expect(page.getByTestId("favorite-group")).toBeVisible();
  // L'exercice se dit par ce qu'il montre, jamais par son identifiant technique.
  await expect(page.getByTestId("favorite-step").first()).not.toContainText("_");

  // Rejouer **seulement** l'exercice aimé : la séance est restreinte à son étape.
  await page.getByTestId("favorite-replay-steps").click();
  await expect(page).toHaveURL(/\/entrainement\?etapes=\d/);
  await expect(page.getByTestId("practice-banner")).toContainText("favoris");
  await expect(page.getByTestId("lesson")).toBeVisible();
  // Une seule étape dans la file : la barre l'annonce.
  await expect(page.getByRole("progressbar", { name: /Étape 1 sur 1/ })).toBeVisible();
});

test("un favori se retire du même geste, et le rayon redevient vide", async ({ page }) => {
  test.setTimeout(180_000);
  await mockGuest(page);
  await onboard(page);
  await skipBriefing(page);
  const heart = page.getByTestId("favorite-button");
  await heart.click();
  await expect(heart).toHaveAttribute("data-liked", "true");

  await page.goto("/reviser/favoris");
  await expect(page.getByTestId("favorites-empty")).toHaveCount(0);
  await page.getByTestId("favorite-step").getByTestId("favorite-button").click();
  // Rien à confirmer : le rayon se vide et le dit.
  await expect(page.getByTestId("favorites-empty")).toBeVisible();
});

test("changer d'appareil : le fichier dit ce qu'il contient avant d'écrire quoi que ce soit", async ({ page }) => {
  test.setTimeout(300_000);
  await mockGuest(page);
  await onboard(page);
  await openAllBriefingPanels(page);
  await page.getByTestId("intro-start").click();
  await playUntil(page, /^Leçon terminée$/);
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour au parcours" }).click();

  // L'écran se trouve depuis les réglages, en tête de la section « Données ».
  await page.goto("/reglages");
  await page.getByTestId("settings-transfer").click();
  await expect(page).toHaveURL(/\/reglages\/appareil$/);

  // Ce que cet appareil contient, avant tout export : une progression réelle.
  const here = page.getByTestId("transfer-here");
  await expect(here).toBeVisible();
  await expect(here).toContainText(/[1-9]\d* XP/);

  // Un fichier qui n'en est pas un est refusé, avec son motif — jamais « fichier invalide ».
  await page.getByTestId("transfer-file").setInputFiles({
    name: "autre-chose.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "pas-parlo" })),
  });
  await expect(page.getByTestId("transfer-error")).toContainText("ne vient pas de Parlo");

  // Un vrai transfert, lui, montre son contenu et attend une confirmation.
  const file = {
    app: "parlo",
    kind: "transfer",
    version: 1,
    exportedAt: "2026-03-01T10:00:00.000Z",
    prefs: { locale: "fr", theme: "system", feedbackSounds: true, silent: false, dictation: false },
    tables: {
      srsCards: [],
      lessonProgress: [{ lessonId: "vi-south.u01.l01", packCode: "vi-south", status: "completed", bestScore: 1, mastered: true, attempts: 1, completedAt: "2026-03-01T10:00:00.000Z" }],
      kv: [
        { key: "vi-south:totals", value: { xp: 4242 } },
        // Un export réel porte toujours le profil : sans lui, l'app repart à juste titre sur
        // l'accueil — on ne connaît pas encore la personne.
        { key: "vi-south:profile", value: { motivation: null, entourage: null, selfLevel: null, dailyGoalMin: 5, onboardedAt: "2026-03-01T10:00:00.000Z" } },
      ],
      notes: [],
      favorites: [],
    },
  };
  await page.getByTestId("transfer-file").setInputFiles({
    name: "parlo-progression-2026-03-01.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByTestId("transfer-incoming")).toContainText("4242 XP");
  // L'appareil a déjà joué : le choix remplacer / fusionner se pose.
  await expect(page.getByTestId("transfer-mode-replace")).toBeVisible();

  await page.getByTestId("transfer-apply").click();
  await expect(page.getByTestId("transfer-done")).toBeVisible();

  // On suit le chemin réel : le bouton de l'écran, qui recharge l'application pour que tout se
  // relise depuis la base fraîchement écrite.
  await page.getByRole("button", { name: "Aller au parcours" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);
  // Et la progression du fichier est bien celle de l'appareil, maintenant.
  await expect(page.getByText("4242 XP", { exact: true })).toBeVisible({ timeout: 30_000 });
});
