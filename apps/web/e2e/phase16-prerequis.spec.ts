import { expect, test, type Page } from "@playwright/test";
import { dismissCelebrations, onboard, openAllBriefingPanels, playUntil } from "./helpers.ts";

/**
 * Contrat phase16 — savoir avant de faire.
 *
 * Deux garanties, et ce sont exactement les deux plaintes qui ont motivé le contrat :
 *   1. on n'entre pas dans les exercices d'une leçon sans avoir consulté ce qu'ils vont exiger ;
 *   2. « Réviser » dit par où commencer, au lieu d'aligner huit rayons de même poids.
 *
 * Plus le corollaire du pack sans voix : ce qui n'est pas jouable n'est pas proposé, et le manque
 * se dit une fois.
 */

const mockGuest = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "unauthorized" }) }));

test("la préparation est une porte : les exercices n'ouvrent qu'une fois tout consulté", async ({ page }) => {
  test.setTimeout(180_000);
  await mockGuest(page);
  await onboard(page);

  const brief = page.getByTestId("lesson-intro");
  await expect(brief).toBeVisible();

  // Il y a quelque chose à préparer, et le bouton est fermé tant qu'il reste un volet.
  const panels = page.locator('[data-testid^="brief-panel-"]');
  const total = await panels.count();
  expect(total).toBeGreaterThan(0);
  const start = page.getByTestId("intro-start");
  await expect(start).toBeDisabled();
  await expect(page.getByTestId("brief-remaining")).toBeVisible();

  // Ouvrir tous les volets sauf le dernier ne suffit pas : la porte ne s'entrouvre pas.
  for (let i = 0; i < total - 1; i++) await panels.nth(i).click();
  await expect(start).toBeDisabled();

  await panels.nth(total - 1).click();
  await expect(start).toBeEnabled();
  await expect(page.getByTestId("brief-remaining")).toHaveCount(0);
  // Un volet ouvert ne se referme pas : on ne défait pas une consultation.
  await panels.first().click();
  await expect(start).toBeEnabled();

  await start.click();
  await expect(page.getByTestId("lesson")).toBeVisible();
});

test("la préparation montre la consigne d'un format avant de le noter", async ({ page }) => {
  test.setTimeout(180_000);
  await mockGuest(page);
  await onboard(page);
  await expect(page.getByTestId("lesson-intro")).toBeVisible();
  await openAllBriefingPanels(page);

  // La toute première leçon introduit des formats qu'aucun écran n'a encore expliqués : on lit la
  // consigne avant que l'exercice compte.
  await expect(page.getByTestId("brief-format").first()).toBeVisible();
  await expect(page.getByTestId("intro-start")).toBeEnabled();
});

test("Réviser dit par où commencer, et l'échelle va du simple au difficile", async ({ page }) => {
  test.setTimeout(420_000);
  await mockGuest(page);
  await onboard(page);
  await playUntil(page, /^Leçon terminée$/);
  await page.getByRole("button", { name: "Retour au parcours" }).click();

  // Une première leçon terminée déclenche ses récompenses : on referme leurs cartes comme le
  // ferait un apprenant, puis on passe par l'onglet du bas — le chemin réel.
  await dismissCelebrations(page);
  await page.getByTestId("bottom-nav").getByRole("link", { name: "Réviser" }).click();
  // La porte passe devant les rayons : c'est la question qu'on se pose en arrivant.
  const door = page.getByTestId("review-order");
  await expect(door).toBeVisible();
  await door.click();
  await expect(page).toHaveURL(/\/reviser\/ordre$/);

  // Un seul barreau est désigné, et l'échelle est entière : on voit le chemin, pas seulement
  // l'étape suivante.
  await expect(page.getByTestId("study-next")).toBeVisible();
  await expect(page.locator('[data-testid^="study-rung-"]')).toHaveCount(7);
  // Les deux urgences en tête, puis du concret au propre-au-vietnamien.
  await expect(page.getByTestId("study-rung-due")).toBeVisible();
  await expect(page.getByTestId("study-rung-speaking")).toBeVisible();

  // Rien n'est verrouillé : un barreau entamé mène aux écrans qui existent déjà.
  const step = page.getByTestId("study-step").first();
  await expect(step).toBeVisible();
  await step.click();
  await expect(page).toHaveURL(/\/(reviser|revision)/);
});

test("sans voix native : le manque est dit une fois, et rien ne mène à un mur", async ({ page }) => {
  test.setTimeout(180_000);
  await mockGuest(page);
  await onboard(page);
  // Quitter la préparation : sans ça, la séance en cours ramène à la leçon à chaque navigation.
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);

  // Le pack livré ne contient aucun enregistrement : un chantier annoncé, en haut, une seule fois.
  await expect(page.getByTestId("hub-no-voices")).toBeVisible();

  // Chợ nổi trie des barques à l'oreille par leur ton : sans voix native, il ne figure pas du tout
  // dans la liste — ni ouvert sur un mur, ni verrouillé à expliquer. Les autres jeux, eux, sont là.
  await page.goto("/jeux");
  await expect(page.getByRole("link", { name: /Xe ôm/ })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Chợ nổi" })).toHaveCount(0);
});
