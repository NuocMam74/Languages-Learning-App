import { expect, test, type Page } from "@playwright/test";
import { dismissCelebrations, onboard, playUntil } from "./helpers.ts";

/**
 * Déploiement sans API (README § Déploiement, scénario A — celui qui est en ligne aujourd'hui).
 *
 * Une seule garantie, et elle tient en une phrase : **l'app ne demande jamais de créer un compte
 * quand aucun serveur ne peut en créer un.** Elle montre à la place la porte qui s'ouvre —
 * « Changer d'appareil », qui emporte la progression dans un fichier, hors ligne.
 *
 * Ce parcours balaie tous les écrans qu'un apprenant peut atteindre et vérifie qu'aucun ne
 * réclame de compte. Sans lui, la règle se reperdrait au premier écran ajouté.
 */

/** Ce que répond le déploiement réel (apps/web/worker.js) quand il n'y a pas d'API. */
const noApi = (page: Page) =>
  page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "api_unavailable" }) }),
  );

/** Les formulations qui promettent un compte. Aucune ne doit paraître. */
const ASKS_FOR_AN_ACCOUNT = /Créer un compte|Crée un compte|Créer mon compte|J'ai déjà un compte|Garde ta progression/;

const ROUTES = [
  "/",
  "/apprendre",
  "/profil",
  "/reglages",
  "/reviser",
  "/jeux",
  "/mondes",
  "/badges",
  "/missions",
  "/recompenses",
  "/examens",
  "/examens/a0",
  "/defis",
  "/defi/7K3Q9B",
  "/co-mai",
  "/ligue",
  "/certificats",
];

test("aucun écran ne réclame un compte quand il n'y a pas de serveur", async ({ page }) => {
  test.setTimeout(180_000);
  await noApi(page);
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);

  for (const route of ROUTES) {
    await page.goto(route);
    // L'écran a eu le temps de s'afficher : on attend son corps, pas un délai arbitraire.
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("main, [data-testid]").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(ASKS_FOR_AN_ACCOUNT), `écran ${route}`).toHaveCount(0);
  }
});

test("le bilan de la première leçon propose d'emporter sa progression, pas de créer un compte", async ({ page }) => {
  test.setTimeout(180_000);
  await noApi(page);
  await onboard(page);

  // C'est ici que l'app proposait « Garde ta progression — Créer un compte » : le moment exact où
  // l'apprenant vient de gagner quelque chose et où on lui offrait un formulaire mort.
  await playUntil(page, /^Leçon terminée$/);
  await expect(page.getByText(ASKS_FOR_AN_ACCOUNT)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Changer d'appareil/ })).toBeVisible();
  await dismissCelebrations(page);
});

test("la progression s'emporte : les écrans invités renvoient vers « Changer d'appareil »", async ({ page }) => {
  test.setTimeout(180_000);
  await noApi(page);
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();

  // Réglages : la porte du compte est remplacée par celle du transfert.
  await page.goto("/reglages");
  await expect(page.getByRole("link", { name: /Changer d'appareil/ }).first()).toBeVisible();

  // Profil : même bascule, sur le même appel à l'action.
  await page.goto("/profil");
  await expect(page.getByTestId("profile-account-cta")).toContainText("Changer d'appareil");

  // Et la page de transfert existe bel et bien au bout du lien.
  await page.goto("/reglages/appareil");
  await expect(page.getByRole("button", { name: "Enregistrer le fichier" })).toBeVisible();
});
