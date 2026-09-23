import { expect, test, type Page } from "@playwright/test";
import { dismissCelebrations, onboard, playUntil } from "./helpers.ts";

/**
 * Déploiement sans API (README § Déploiement, scénario A — celui qui est en ligne aujourd'hui).
 *
 * Une seule garantie, et elle tient en une phrase : **l'app ne demande jamais de créer un compte
 * quand aucun serveur ne peut en créer un.**
 *
 * Depuis le contrat phase23 §2, elle ne propose plus rien à la place : « Changer d'appareil » a
 * quitté le bilan, le profil et l'écran de compte pour ne vivre que dans Réglages → Données.
 * Emporter sa progression dans un fichier est un geste d'administration ; l'offrir en lot de
 * consolation au bilan d'une première leçon ne répondait à aucune question qu'on se pose là.
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
  "/statistiques",
  "/statistiques/skills",
  "/statistiques/journey",
  "/fiches",
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

test("le bilan de la première leçon ne réclame rien : il donne la fiche du niveau", async ({ page }) => {
  test.setTimeout(180_000);
  await noApi(page);
  await onboard(page);

  // C'est ici que l'app proposait « Garde ta progression — Créer un compte », puis, une fois ce
  // mur constaté, « Changer d'appareil » — un geste d'administration servi au moment exact où
  // l'apprenant vient de gagner quelque chose. Les deux ont disparu (contrat phase23 §2).
  await playUntil(page, /^Leçon terminée$/);
  await expect(page.getByText(ASKS_FOR_AN_ACCOUNT)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Changer d'appareil/ })).toHaveCount(0);
  // Ce qu'on y trouve à la place, et qui répond à une vraie question : ce qu'il faut retenir.
  await expect(page.getByTestId("memo-card")).toBeVisible();
  await dismissCelebrations(page);
});

test("« Changer d'appareil » ne vit que dans les réglages", async ({ page }) => {
  test.setTimeout(180_000);
  await noApi(page);
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();

  // Réglages → Données : la seule porte, et elle est entière.
  await page.goto("/reglages");
  // Rangée dans un menu dépliant fermé (contrat phase26 §1) : invisible tant qu'on ne l'ouvre pas.
  await expect(page.getByTestId("settings-transfer")).toBeHidden();
  await page.getByTestId("settings-more").getByText("Autres options").click();
  await expect(page.getByTestId("settings-transfer")).toBeVisible();

  // Profil : plus de carte invité du tout — sans serveur, elle n'avait rien à proposer.
  await page.goto("/profil");
  await expect(page.getByTestId("profile-account-cta")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Changer d'appareil/ })).toHaveCount(0);

  // Écran de compte : le mur est annoncé, mais on n'y renvoie plus ailleurs.
  await page.goto("/compte");
  await expect(page.getByTestId("account-unavailable")).toBeVisible();
  await expect(page.getByRole("link", { name: /Changer d'appareil/ })).toHaveCount(0);

  // Et la page de transfert existe bel et bien au bout du lien des réglages.
  await page.goto("/reglages/appareil");
  await expect(page.getByRole("button", { name: "Enregistrer le fichier" })).toBeVisible();
});
