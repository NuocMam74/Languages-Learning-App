import { dismissCelebrations } from "./helpers.ts";
import { expect, test, type Page } from "@playwright/test";
import { declareAllMedia } from "./media.ts";

/**
 * Onglet « Jeux » : Chợ nổi jouable seul (spec §5.6). Mouvement réduit émulé :
 * les barques ne dérivent pas, les choix sont statiques → test déterministe.
 */
test.use({ reducedMotion: "reduce", serviceWorkers: "block" });

// Chợ nổi (pack tonal) exige l'audio natif : le build n'en a pas encore, l'index des médias est complété (voir media.ts).
test.beforeEach(async ({ page }) => {
  await declareAllMedia(page);
  // Đối đáp dépend de Cô Mai : sans modèle configuré l'API la dit indisponible et le jeu s'affiche « bientôt ».
  await page.route("**/api/tutor/status**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, reason: null, personaName: "Cô Mai" }) }));
});

test("Chợ nổi se joue jusqu'au résultat et garde le record", async ({ page }) => {
  await page.goto("/jeux");
  await expect(page.getByRole("heading", { name: "Jeux" })).toBeVisible();
  await expect(page.locator('[data-game="cho_noi"]')).toContainText("Pas encore joué");
  await expect(page.getByText("bientôt")).toHaveCount(0); // les 3 jeux de la phase 2 + karaoké sont jouables
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

  // Terminer un jeu peut rapporter des xu : la carte de récompense se pose par-dessus l'écran de
  // fin et intercepte les clics. On la referme comme le ferait un joueur.
  await dismissCelebrations(page);
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

/** Événements game_played écrits dans l'outbox locale (IndexedDB « parlo »). */
async function gamePlayedEvents(page: Page): Promise<{ game: string; correct: number; total: number; localDate: string }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("outbox", "readonly").objectStore("outbox").getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const rows = req.result as { event: { type: string; payload: { game: string; correct: number; total: number; localDate: string } } }[];
            resolve(rows.filter((r) => r.event.type === "game_played").map((r) => r.event.payload));
            open.result.close();
          };
        };
      }),
  );
}

const XE_OM_BUTTONS = ["Gauche", "Tout droit", "Droite", "Stop"];

test("Xe ôm : suit les consignes carrefour par carrefour jusqu'au terminus", async ({ page }) => {
  await page.goto("/jeux");
  await page.getByRole("link", { name: /Xe ôm/ }).click();
  await expect(page).toHaveURL(/\/jeux\/xe_om$/);
  await page.getByRole("button", { name: "Jouer", exact: true }).click();

  const game = page.locator('[data-testid="xe-om"][data-moves]');
  const result = page.getByRole("heading", { name: "Terminus" });
  await expect(game).toHaveAttribute("data-route", "0");
  await expect(page.getByText(/^Course 1 sur 3 · Consigne 1 sur \d+$/)).toBeVisible();
  const controls = page.getByRole("group", { name: "Directions" });
  await expect(controls.getByRole("button")).toHaveCount(4);
  // Pas de transcription d'emblée (compréhension orale) ; la carte est tactile aussi.
  await expect(page.getByTestId("xe-om-transcript")).toHaveCount(0);
  await page.locator("[data-map-action]").first().click();
  await expect(game).toHaveAttribute("data-moves", "1");

  const snap = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="xe-om"][data-moves]');
      return el
        ? { route: el.getAttribute("data-route"), step: el.getAttribute("data-step"), misses: Number(el.getAttribute("data-misses")), moves: Number(el.getAttribute("data-moves")), phase: el.getAttribute("data-phase") }
        : null;
    });

  let transcriptSeen = false;
  let arrivals = 0;
  for (let guard = 0; guard < 200 && !(await result.isVisible()); guard++) {
    const s = await snap();
    if (!s || s.phase !== "driving") {
      if (s?.phase === "arrived") await expect(page.getByText(/^Arrivé : .+$/)).toBeVisible();
      await expect.poll(async () => (await result.isVisible()) || (await snap())?.phase === "driving", { timeout: 5_000 }).toBe(true);
      continue;
    }
    if (s.misses >= 2) {
      await expect(page.getByTestId("xe-om-transcript")).toBeVisible();
      transcriptSeen = true;
    }
    // Essais dans l'ordre : chaque raté fait passer au bouton suivant, sans jamais bloquer.
    await controls.getByRole("button", { name: XE_OM_BUTTONS[s.misses % 4], exact: true }).click();
    await expect.poll(async () => {
      const n = await snap();
      return n === null || n.moves > s.moves;
    }).toBe(true);
    const n = await snap();
    if (n?.phase === "arrived") arrivals++;
  }

  await expect(result).toBeVisible();
  expect(arrivals).toBe(3);
  expect(transcriptSeen).toBe(true);
  await expect(page.getByText(/^\d+ sur \d+$/)).toBeVisible();
  await expect(page.getByText("Nouveau record")).toBeVisible();
  await expect.poll(async () => (await gamePlayedEvents(page)).filter((e) => e.game === "xe_om").length).toBe(1);
  const [event] = (await gamePlayedEvents(page)).filter((e) => e.game === "xe_om");
  expect(event!.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(event!.total).toBeGreaterThan(event!.correct);

  // Terminer un jeu peut rapporter des xu : la carte de récompense se pose par-dessus l'écran de
  // fin et intercepte les clics. On la referme comme le ferait un joueur.
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour aux jeux" }).click();
  await expect(page.locator('[data-game="xe_om"]')).toContainText(/Record : \d+ points · \d+ sur \d+/);
  await expect(page.locator('[data-game="bua_com"]')).toContainText("Pas encore joué");
});

test("Bữa cơm : assemble les phrases, chrono doux, jusqu'au repas", async ({ page }) => {
  await page.goto("/jeux");
  await page.getByRole("link", { name: /Bữa cơm/ }).click();
  await expect(page).toHaveURL(/\/jeux\/bua_com$/);
  await expect(page.getByText("Phrases des premières leçons")).toBeVisible();
  await page.getByRole("button", { name: "Jouer", exact: true }).click();

  const game = page.locator('[data-testid="bua-com"][data-round]');
  const result = page.getByRole("heading", { name: "Bon appétit" });
  // Mouvement réduit : vapeur figée, barre de chaleur statique.
  await expect(page.locator('[title="Chaleur du plat"]')).toBeVisible();

  for (let i = 0; i < 5; i++) {
    await expect(game).toHaveAttribute("data-round", String(i));
    await expect(game).toHaveAttribute("data-phase", "building");
    await expect(page.getByText(`Plat ${i + 1} sur 5`)).toBeVisible();
    const serve = page.getByRole("button", { name: "Servir" });
    await expect(serve).toBeDisabled();
    const tokens = page.getByRole("group", { name: "Mots disponibles" }).getByRole("button");
    expect(await tokens.count()).toBeGreaterThanOrEqual(3);
    await tokens.first().click();
    await page.getByRole("group", { name: "Mots disponibles" }).getByRole("button", { disabled: false }).first().click();
    // Retirer un mot le rend à la réserve.
    const answer = page.getByRole("group", { name: "Ta phrase" }).getByRole("button");
    await expect(answer).toHaveCount(2);
    await answer.last().click();
    await expect(answer).toHaveCount(1);
    await serve.click();
    await expect(game.and(page.locator('[data-phase="feedback"]')).or(result)).toBeVisible();
    const verdict = await page.evaluate(() => document.querySelector('[data-testid="bua-com"][data-round]')?.getAttribute("data-verdict") ?? "correct");
    if (verdict !== "correct") {
      await expect(page.getByRole("status").filter({ hasText: /C'était « .+ »|Presque/ })).toBeVisible();
      await page.getByRole("button", { name: i < 4 ? "Plat suivant" : "Voir le résultat" }).click();
    }
  }

  await expect(result).toBeVisible();
  await expect(page.getByText(/^\d sur 5$/)).toBeVisible();
  await expect(page.getByText("Nouveau record")).toBeVisible();
  await expect.poll(async () => (await gamePlayedEvents(page)).filter((e) => e.game === "bua_com").length).toBe(1);

  // Terminer un jeu peut rapporter des xu : la carte de récompense se pose par-dessus l'écran de
  // fin et intercepte les clics. On la referme comme le ferait un joueur.
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour aux jeux" }).click();
  await expect(page.locator('[data-game="bua_com"]')).toContainText(/Record : \d+ points · \d sur 5/);
});
