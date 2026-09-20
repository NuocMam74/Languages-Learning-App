import { expect, test, type Page } from "@playwright/test";
import { onboard } from "./helpers.ts";

/**
 * Contrat phase15 §2 — les conseils pratiques.
 *
 * Ce qui compte ici : la fiche se lit **sans rien avoir fait**. Pas de leçon terminée, pas d'unité
 * téléchargée, pas de réseau. C'est le rayon qu'on ouvre quand on a une question et pas le temps
 * d'une séance — s'il demandait une progression, il manquerait son but.
 */

const mockGuest = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "unauthorized" }) }));

test("les conseils s'ouvrent dès le premier jour, se cherchent, et se lisent hors ligne", async ({ page, context }) => {
  test.setTimeout(180_000);
  await mockGuest(page);
  await onboard(page);

  // Aucune leçon terminée : la bibliothèque est vide de mots, mais les conseils sont là.
  await page.goto("/reviser");
  const shelf = page.getByTestId("review-tips");
  await expect(shelf).toBeVisible();
  await expect(shelf).toContainText(/[1-9]\d* fiches?/);

  await shelf.click();
  await expect(page).toHaveURL(/\/reviser\/conseils$/);
  const tips = page.getByTestId("tip");
  await expect(tips.first()).toBeVisible();
  const total = await tips.count();
  expect(total).toBeGreaterThan(5);

  // Les fiches sont rangées par nature, dans l'ordre du contrat : construire, puis situations.
  const kinds = await page.$$eval('[data-testid="tips-group"]', (els) => els.map((el) => el.dataset.kind));
  expect(kinds[0]).toBe("grammar");
  expect(kinds).toContain("situation");

  // Dans un rayon, l'ordre vient du contenu, pas de l'alphabet des fichiers : on construit une
  // phrase avant d'apprendre les classificateurs.
  await expect(page.locator('[data-testid="tips-group"][data-kind="grammar"] [data-testid="tip"]').first()).toHaveAttribute(
    "data-guide",
    "g_construire_phrase",
  );

  // La recherche porte sur le corps des fiches, pas seulement sur leur titre.
  await page.getByTestId("tips-search").fill("taxi");
  await expect(tips.first()).toBeVisible();
  expect(await tips.count()).toBeLessThan(total);
  await page.getByTestId("tips-search").fill("zzzzzz");
  await expect(page.getByTestId("tips-no-match")).toBeVisible();
  await page.getByRole("button", { name: "Enlever les filtres" }).click();
  await expect(tips).toHaveCount(total);

  // --- Une fiche : sections, exemples vietnamiens traduits, pièges.
  const first = page.locator('[data-testid="tip"][data-guide="g_construire_phrase"]');
  await first.locator("a").click();
  await expect(page).toHaveURL(/\/reviser\/conseils\/g_construire_phrase$/);
  await expect(page.getByRole("heading", { name: "Construire une phrase" })).toBeVisible();

  const sections = page.getByTestId("tip-section");
  expect(await sections.count()).toBeGreaterThan(1);
  const examples = page.getByTestId("tip-example");
  await expect(examples.first()).toBeVisible();
  // Chaque exemple montre le vietnamien **et** sa traduction : une phrase seule n'apprend rien.
  await expect(examples.first().locator("[data-target-text]")).toContainText(/\p{L}/u);
  await expect(page.getByTestId("tip-pitfalls")).toBeVisible();

  // Le retour ramène à la liste, pas à l'accueil.
  await page.getByRole("link", { name: "Conseils pratiques" }).click();
  await expect(page).toHaveURL(/\/reviser\/conseils$/);

  // --- Hors ligne : les fiches voyagent dans core.json, donc elles restent lisibles.
  // On attend que le service worker soit prêt : c'est lui qui sert la navigation hors ligne, et
  // couper le réseau avant son activation ne teste rien d'autre que la course.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.goto("/reviser/conseils/g_au_marche");
  await expect(page.getByRole("heading", { name: "Au marché" })).toBeVisible();
  await expect(page.getByTestId("tip-example").first()).toBeVisible();
  await context.setOffline(false);
});

test("une fiche inconnue renvoie à la liste plutôt qu'à un écran vide", async ({ page }) => {
  test.setTimeout(120_000);
  await mockGuest(page);
  await onboard(page);

  await page.goto("/reviser/conseils/g_nexiste_pas");
  await expect(page).toHaveURL(/\/reviser\/conseils$/);
  await expect(page.getByTestId("tip").first()).toBeVisible();
});
