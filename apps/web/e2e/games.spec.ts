import { expect, test } from "@playwright/test";

/**
 * Onglet « Jeux » : Chợ nổi jouable seul (spec §5.6). Mouvement réduit émulé :
 * les barques ne dérivent pas, les choix sont statiques → test déterministe.
 */
test.use({ reducedMotion: "reduce" });

test("Chợ nổi se joue jusqu'au résultat et garde le record", async ({ page }) => {
  await page.goto("/jeux");
  await expect(page.getByRole("heading", { name: "Jeux" })).toBeVisible();
  await expect(page.getByText("Pas encore joué")).toBeVisible();
  await page.getByRole("link", { name: /Chợ nổi/ }).click();
  await expect(page).toHaveURL(/\/jeux\/cho_noi$/);

  await page.getByRole("button", { name: "Jouer", exact: true }).click();
  const game = page.getByTestId("cho-noi");

  for (let i = 0; i < 10; i++) {
    await expect(game).toHaveAttribute("data-round", String(i));
    await expect(game).toHaveAttribute("data-phase", "boats");
    await expect(page.getByText(`Barque ${i + 1} sur 10`)).toBeVisible();
    const boats = page.getByRole("button", { name: /^Barque : / });
    await expect(boats).toHaveCount(3);
    // Accessible : chaque barque porte son mot dans son nom.
    await boats.nth(i % 3).click();
    if (i < 9) await expect(game).not.toHaveAttribute("data-round", String(i));
  }

  await expect(page.getByRole("heading", { name: "Le marché ferme" })).toBeVisible();
  await expect(page.getByText(/^\d+ sur 10$/)).toBeVisible();
  await expect(page.getByText("Nouveau record")).toBeVisible();

  await page.getByRole("button", { name: "Retour aux jeux" }).click();
  await expect(page.getByText(/^Record : \d+ points · \d+ sur 10$/)).toBeVisible();
});

test("Chợ nổi : le temps écoulé compte un raté sans bloquer", async ({ page }) => {
  await page.goto("/jeux/cho_noi");
  await page.getByRole("button", { name: "Jouer", exact: true }).click();
  const game = page.getByTestId("cho-noi");
  await expect(game).toHaveAttribute("data-round", "0");
  // Aucune touche : la minuterie douce (≈ 1,5 × traversée) passe à la barque suivante.
  await expect(page.getByText(/^C'était « .+ »\.$/)).toBeVisible({ timeout: 15_000 });
  await expect(game).toHaveAttribute("data-round", "1", { timeout: 5_000 });
});
