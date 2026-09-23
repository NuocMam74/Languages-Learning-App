import { expect, test } from "@playwright/test";
import { dismissCelebrations, onboard, onboardToHub, playUntil, skipBasics } from "./helpers.ts";

/**
 * Contrat phase23 : les chiffres, la visite guidée, le test de niveau d'abord, la fiche à emporter.
 *
 * Quatre parcours, chacun tenant une promesse que le contrat a écrite :
 *   1. le premier lancement situe avant de mettre au travail, et montre la maison ;
 *   2. les statistiques existent, se remplissent, et ne mentent pas sur les jours creux ;
 *   3. la fiche du niveau se récupère en PDF, sur l'appareil ;
 *   4. le cinquième onglet est atteignable au pouce.
 */

test("premier lancement : on situe, on visite, on ne joue pas de leçon d'office", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await page.getByRole("button", { name: "Commencer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    const choice = i === 3 ? page.getByRole("button", { name: "15 min", exact: true }) : page.locator("main button").first();
    await choice.click();
  }

  // 1. Le test de niveau, et non plus la leçon 1. C'est le chemin : « Je pars de zéro » est une
  //    réponse à côté, pas un bouton « Passer » de même poids. Il est toujours proposé, à l'écrit
  //    tant que les voix natives manquent (contrat phase26 §6).
  await expect(page).toHaveURL(/\/placement$/);
  await expect(page.getByRole("heading", { name: "Commençons par te situer" })).toBeVisible();
  await page.getByRole("button", { name: "Je pars de zéro" }).click();

  // 2. La visite, en bulles, sur le parcours lui-même (contrat phase26 §8) : pas une leçon, et
  //    pas un écran à part. Elle s'ouvre d'elle-même la première fois.
  await expect(page).toHaveURL(/\/apprendre$/);
  const step = page.getByTestId("discovery-step");
  await expect(step).toHaveAttribute("data-step", "welcome");
  await expect(page.locator('[data-testid="lesson"]')).toHaveCount(0);
  // La navigation basse reste là, sous le voile : la visite en montre justement les onglets.
  await expect(page.getByTestId("bottom-nav")).toBeVisible();

  // On avance, on recule : chaque bulle a sa place, et « Précédent » ramène à la précédente.
  const next = page.getByTestId("discovery-next");
  await next.click();
  await expect(step).toHaveAttribute("data-step", "session");
  // L'objectif choisi est repris tel quel : la visite parle de **sa** séance.
  await expect(step).toContainText("15 minutes");
  await page.getByTestId("discovery-back").click();
  await expect(step).toHaveAttribute("data-step", "welcome");
  const order = ["session", "path", "review", "memo", "stats", "help", "offline"];
  for (const key of order) {
    await next.click();
    await expect(step).toHaveAttribute("data-step", key);
  }
  // La dernière bulle referme la visite ; on reste sur le parcours.
  await next.click();
  await expect(step).toHaveCount(0);
  await expect(page).toHaveURL(/\/apprendre$/);

  // 3. La visite ne revient pas toute seule : ni en revenant sur le parcours, ni au redémarrage.
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await page.goto("/apprendre");
  await expect(page.getByTestId("hub-pack")).toBeVisible();
  await expect(step).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("hub-pack")).toBeVisible();
  await expect(step).toHaveCount(0);

  // 4. Le « ? » du parcours la relance depuis le début ; « Passer » la referme.
  await page.getByTestId("tour-help").click();
  await expect(step).toHaveAttribute("data-step", "welcome");
  await page.getByTestId("discovery-skip").click();
  await expect(step).toHaveCount(0);

  // 5. Et elle se revoit depuis les réglages, sur le parcours.
  await page.goto("/reglages");
  await expect(page.getByTestId("settings-discovery")).toBeVisible();
  await page.getByTestId("settings-discovery").click();
  await expect(page).toHaveURL(/\/apprendre$/);
  await expect(step).toHaveAttribute("data-step", "welcome");
  await page.getByTestId("discovery-skip").click();
  await expect(step).toHaveCount(0);
});

test("l'objectif choisi pendant l'onboarding est repris par la visite", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Commencer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    const choice = i === 3 ? page.getByRole("button", { name: "20 min", exact: true }) : page.locator("main button").first();
    await choice.click();
  }
  await page.getByRole("button", { name: "Je pars de zéro" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);
  await expect(page.getByTestId("discovery-step")).toHaveAttribute("data-step", "welcome");
  await page.getByTestId("discovery-next").click();
  // Le seul chiffre personnel de la visite : sans lui, elle parlerait d'une séance en général.
  // Il est posé sur la bulle de la séance du jour (contrat phase26 §8).
  await expect(page.getByTestId("discovery-step")).toHaveAttribute("data-step", "session");
  await expect(page.getByTestId("discovery-step")).toContainText("20 minutes");
});

test("les statistiques : vides d'abord, remplies après une séance, jours creux compris", async ({ page }) => {
  test.setTimeout(240_000);
  await onboardToHub(page);

  // Rien de fait : une invitation, pas une grille de zéros.
  await page.goto("/statistiques");
  await expect(page.getByTestId("stats-empty")).toBeVisible();

  // Rien de fait, rien sur le parcours non plus : la carte des chiffres attend (contrat phase26 §7).
  await page.goto("/apprendre");
  await expect(page.getByTestId("hub-goal-ring")).toBeVisible();
  await expect(page.getByTestId("hub-kpis")).toHaveCount(0);

  // Une leçon, et les compteurs prennent vie. u01 attend les bases (contrat phase26 §2) : on
  // place l'apprenant après elles pour jouer le niveau que ce test a toujours joué.
  await skipBasics(page);
  await page.goto("/lecon/vi-south.u01.l01");
  await playUntil(page, /^Leçon terminée$/);
  await dismissCelebrations(page);

  await page.goto("/statistiques");
  await expect(page.getByTestId("stats-empty")).toHaveCount(0);
  await expect(page.getByTestId("stats-kpis")).toBeVisible();
  // La séance a été jouée aujourd'hui : un jour actif au moins, et des réponses comptées.
  await expect(page.locator('[data-kpi="regularity"]')).toContainText("1 j /");
  await expect(page.locator('[data-kpi="streak"]')).toContainText("1 jour");

  // La bande de régularité dessine **tous** les jours, y compris ceux où rien n'a été fait : c'est
  // exactement ce qu'on vient y lire. Un seul jour porte une valeur, les autres sont à zéro.
  expect(await page.locator("button[data-value]").count()).toBeGreaterThan(20);
  expect(await page.locator('button[data-value="0"]').count()).toBeGreaterThan(20);

  // Les quatre onglets (contrat phase26 §7) vivent dans l'URL et portent chacun leurs chiffres.
  await expect(page.getByTestId("stats-tab")).toHaveCount(4);
  await page.getByTestId("stats-tab").filter({ hasText: "Compétences" }).click();
  await expect(page).toHaveURL(/\/statistiques\/skills$/);
  await expect(page.getByTestId("stats-shares").locator("li")).toHaveCount(4);

  await page.getByTestId("stats-tab").filter({ hasText: "Parcours" }).click();
  await expect(page).toHaveURL(/\/statistiques\/journey$/);
  await expect(page.getByTestId("stats-overall")).toBeVisible();
  await expect(page.getByTestId("stats-theme").first()).toBeVisible();

  // La ligne d'un thème ouvre sa fiche (contrat phase26 §7) : le niveau joué y a sa note.
  await page.locator('[data-testid="stats-theme"][data-unit="vi-south.u01"]').getByTestId("stats-theme-link").click();
  await expect(page).toHaveURL(/\/statistiques\/theme\/vi-south\.u01$/);
  await expect(page.getByTestId("theme-mark")).toBeVisible();
  await expect(page.getByTestId("theme-kpis").locator('[data-kpi="levels"]')).toContainText(/1\/\d+/);

  // L'historique, sur des mois : la semaine en cours porte la séance jouée.
  await page.goto("/statistiques/journey");
  await page.getByTestId("stats-tab").filter({ hasText: "Historique" }).click();
  await expect(page).toHaveURL(/\/statistiques\/history$/);
  await expect(page.getByTestId("history-period")).toBeVisible();
  await expect(page.getByTestId("history-charts")).toBeVisible();
  expect(Number(await page.getByTestId("history-charts").getAttribute("data-weeks"))).toBeGreaterThan(0);

  // Et le parcours montre désormais ses chiffres de la semaine.
  await page.goto("/apprendre");
  await expect(page.getByTestId("hub-kpis")).toBeVisible();
});

test("le cinquième onglet est dans la barre basse et mène aux chiffres", async ({ page }) => {
  test.setTimeout(180_000);
  await onboardToHub(page);
  const nav = page.getByTestId("bottom-nav");
  await expect(nav.locator("a")).toHaveCount(5);
  await nav.getByRole("link", { name: "Chiffres" }).click();
  await expect(page).toHaveURL(/\/statistiques$/);
  // Cible tactile : la contrainte des 44 px vaut aussi à cinq destinations.
  const box = await nav.getByRole("link", { name: "Chiffres" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("fiche mémoire : proposée au bilan, lisible à l'écran, téléchargée en PDF", async ({ page }) => {
  test.setTimeout(240_000);
  await onboard(page);
  await playUntil(page, /^Leçon terminée$/);

  // 1. Au bilan — le seul instant où l'on sait ce qu'on vient d'apprendre.
  const card = page.getByTestId("memo-card");
  await expect(card).toBeVisible();

  // 2. Le PDF se fabrique sur l'appareil : aucun réseau, et c'est bien un `.pdf`.
  const download = page.waitForEvent("download");
  await card.getByTestId("memo-download").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^parlo-fiche-.*\.pdf$/);
  const path = await file.path();
  expect(path).toBeTruthy();

  await dismissCelebrations(page);

  // 3. La fiche se relit à l'écran, avec ce que le niveau a enseigné.
  await page.goto("/fiches/vi-south.u01.l01");
  await expect(page.getByTestId("memo-sheet")).toBeVisible();
  expect(await page.getByTestId("memo-entry-word").count()).toBeGreaterThan(0);

  // 4. Et elle se retrouve depuis Réviser, rangée par thème.
  await page.goto("/reviser");
  await page.getByRole("link", { name: "Fiches mémoire" }).click();
  await expect(page).toHaveURL(/\/fiches$/);
  await expect(page.getByTestId("memo-entry").first()).toBeVisible();
});

test("aucune fiche pour un niveau jamais terminé", async ({ page }) => {
  test.setTimeout(180_000);
  await onboardToHub(page);
  // La liste ne montre que ce qui est fait : une fiche d'un niveau jamais joué en donnerait les
  // réponses.
  await page.goto("/fiches");
  await expect(page.locator('[data-empty-state]')).toBeVisible();
  await expect(page.getByTestId("memo-entry")).toHaveCount(0);
});
