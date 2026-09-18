import { expect, test, type Page } from "@playwright/test";
import { onboard, playUntil } from "./helpers.ts";

/**
 * Contrat phase14 §2 — les deux index d'étude autonome : **par catégorie grammaticale** et
 * **par thème**.
 *
 * Ce qu'on vérifie, et pourquoi : un index n'a de valeur que s'il dit la taille réelle du domaine
 * (« 9 sur 195 »), qu'il n'ouvre que des rayons non vides, et qu'il ne divulgâche pas le cursus —
 * un rayon jamais entamé montre son nombre, jamais ses mots.
 */

const mockGuest = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "unauthorized" }) }));

/** Une leçon terminée : sans elle, les index sont (à juste titre) entièrement fermés. */
async function firstLesson(page: Page) {
  await mockGuest(page);
  await onboard(page);
  await playUntil(page, /^Leçon terminée$/);
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);
}

test("les index par catégorie et par thème mènent au vocabulaire déjà filtré", async ({ page }) => {
  test.setTimeout(420_000);
  await firstLesson(page);

  await page.goto("/reviser");
  await expect(page.getByTestId("review-categories")).toContainText(/[1-9]\d* catégories?/);
  await expect(page.getByTestId("review-themes")).toContainText(/[1-9]\d* thèmes?/);

  // --- Catégories.
  await page.getByTestId("review-categories").click();
  await expect(page).toHaveURL(/\/reviser\/categories$/);
  // `count()` ne réessaie pas : on attend que la liste soit rendue avant de compter, sinon le test
  // mesure l'écran d'avant l'hydratation.
  const shelves = page.getByTestId("index-shelf");
  await expect(page.getByTestId("categories")).toBeVisible();
  await expect(shelves.first()).toBeVisible();
  expect(await shelves.count()).toBeGreaterThan(5);

  // Chaque rayon annonce « vus sur total », et le total est celui du pack entier, pas des unités
  // téléchargées : c'est ce qui en fait un index (les résumés de concepts portent la catégorie).
  await expect(shelves.first()).toContainText(/\d+ sur \d+ vus/);

  // Un rayon jamais entamé n'est pas cliquable et ne montre aucun mot.
  const locked = page.locator('[data-testid="index-shelf"][data-open="false"]');
  if ((await locked.count()) > 0) {
    await expect(locked.first()).toContainText(/\d+ à découvrir/);
    await expect(locked.first().locator("a")).toHaveCount(0);
  }

  // Un rayon ouvert mène au vocabulaire filtré sur sa catégorie.
  const open = page.locator('[data-testid="index-shelf"][data-open="true"]').first();
  const key = await open.getAttribute("data-key");
  await open.locator("a").click();
  await expect(page).toHaveURL(`/reviser/vocabulaire?categorie=${key}`);
  await expect(page.getByTestId("vocab-pos")).toHaveValue(key!);
  const words = page.getByTestId("word");
  await expect(words.first()).toBeVisible();
  expect(await words.count()).toBeGreaterThan(0);

  // Le filtre se relâche sans quitter l'écran, et la liste s'élargit.
  const narrowed = await words.count();
  await page.getByTestId("vocab-pos").selectOption("");
  await expect(page).toHaveURL(/\/reviser\/vocabulaire$/);
  expect(await words.count()).toBeGreaterThanOrEqual(narrowed);

  // --- Thèmes : toutes les unités du cursus, y compris celles qui restent à ouvrir.
  await page.goto("/reviser/themes");
  const themes = page.getByTestId("index-shelf");
  await expect(page.getByTestId("themes")).toBeVisible();
  await expect(themes.first()).toBeVisible();
  expect(await themes.count()).toBeGreaterThan(1);
  await expect(themes.first()).toHaveAttribute("data-open", "true");
  await expect(page.locator('[data-testid="index-shelf"][data-open="false"]').first()).toContainText(/\d+ à découvrir/);

  await themes.first().locator("a").click();
  await expect(page).toHaveURL(/\/reviser\/vocabulaire\?unite=/);
  await expect(page.getByTestId("word").first()).toBeVisible();
});
