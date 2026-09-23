import { expect, test } from "@playwright/test";

/**
 * Contrat phase26 — les bases avant le parcours.
 *
 * Un seul parcours, celui d'un apprenant qui ne sait rien et le dit :
 *   1. le test de niveau lui est proposé même sans voix natives, à l'écrit (§6) ;
 *   2. « Je pars de zéro » le pose sur le parcours, où la visite en bulles s'ouvre (§8) ;
 *   3. sa première étape est la première leçon des bases, pas celle des tons (§2) ;
 *   4. cette leçon commence par la fiche de l'alphabet, lue avant les mots qu'elle présente (§3) ;
 *   5. u01 reste fermée tant que les bases ne sont pas faites (§2) ;
 *   6. la carte des chiffres n'est pas sur le parcours tant qu'il n'y a rien à compter (§7).
 */

test("un débutant commence par les bases, et le thème suivant l'attend", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await page.getByRole("button", { name: "Commencer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    await page.locator("main button").first().click();
  }

  // 1. Le test de niveau, à l'écrit : le pack du Sud n'a pas encore ses voix, et un test d'écoute
  //    muet se répondrait au hasard (contrat phase26 §6). L'écran le dit.
  await expect(page).toHaveURL(/\/placement$/);
  await expect(page.getByRole("heading", { name: "Commençons par te situer" })).toBeVisible();
  await expect(page.getByTestId("placement-mode")).toHaveAttribute("data-mode", "reading");
  await page.getByRole("button", { name: "Je pars de zéro" }).click();

  // 2. Le parcours, visite ouverte d'elle-même. On la passe.
  await expect(page).toHaveURL(/\/apprendre$/);
  const tour = page.getByTestId("discovery-step");
  await expect(tour).toBeVisible();
  await page.getByTestId("discovery-skip").click();
  await expect(tour).toHaveCount(0);

  // 6. Rien de fait : pas de carte de chiffres, quatre zéros ne diraient rien (§7).
  await expect(page.getByTestId("hub-goal-ring")).toBeVisible();
  await expect(page.getByTestId("hub-kpis")).toHaveCount(0);

  // 3. Une seule étape ouverte sur le fleuve : la première des bases. u01.l01, qui ouvrait le
  //    parcours avant ce contrat, n'est plus un lien.
  const open = page.locator('a[href^="/lecon/"][data-state="open"]');
  await expect(open).toHaveCount(1);
  await expect(open).toHaveAttribute("href", "/lecon/vi-south.u00.l01");
  await expect(page.locator('a[href="/lecon/vi-south.u01.l01"]')).toHaveCount(0);

  // 5. Le lien direct vers u01 ne contourne pas le verrou : retour au parcours, avec l'avis.
  await page.goto("/lecon/vi-south.u01.l01");
  await expect(page).toHaveURL(/\/apprendre$/);
  await expect(page.getByTestId("hub-notice")).toBeVisible();

  // 4. La première leçon des bases s'ouvre sur sa préparation, et la fiche de l'alphabet y passe
  //    en tête : c'est la leçon elle-même, on la lit avant les lettres qu'elle présente (§3).
  await page.goto("/lecon/vi-south.u00.l01");
  await expect(page.getByTestId("lesson-intro")).toBeVisible();
  const panels = page.locator('[data-testid^="brief-panel-"]');
  await expect(panels.first()).toHaveAttribute("data-testid", "brief-panel-guide:g_alphabet");
});
