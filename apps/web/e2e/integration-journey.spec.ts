import { expect, test } from "@playwright/test";
import { dismissCelebrations, onboard, playUntil } from "./helpers.ts";

/**
 * Parcours complet (contrat phase5) en intégration réelle avec l'API :
 * invité → compte, reprise sur un second appareil, séance vide sans XP, mot de passe oublié,
 * export puis suppression du compte. Mêmes serveurs que integration.spec.ts.
 */
test.skip(!process.env.PARLO_INTEGRATION, "intégration réelle désactivée (PARLO_INTEGRATION)");
test.use({ baseURL: "http://localhost:5173" });
test.setTimeout(180_000);

const API = "http://localhost:8000";

test("second appareil, séance vide, mot de passe oublié, export et suppression", async ({ browser, request }) => {
  const email = `parcours-${Date.now()}@parlo.app`;
  const password = "mot-de-passe-solide";

  // Appareil A : première leçon en invité, puis création du compte.
  const a = await browser.newContext();
  const pageA = await a.newPage();
  await onboard(pageA);
  await playUntil(pageA, /Leçon terminée|Séance terminée/);
  // Les cartes de félicitations se posent **après** le bilan et interceptent les clics : on les
  // referme d'abord, comme le ferait un apprenant. Elles sont arrivées après ce parcours, qui est
  // ignoré hors intégration réelle — il ne les avait jamais rencontrées.
  await dismissCelebrations(pageA);
  await pageA.getByRole("link", { name: "Créer un compte" }).click();
  await pageA.getByLabel("Prénom ou pseudo").fill("Lan");
  await pageA.getByLabel("Email").fill(email);
  await pageA.getByLabel("Mot de passe").fill(password);
  await pageA.getByRole("checkbox").check();
  await pageA.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(pageA.getByRole("heading", { name: "Compte créé" })).toBeVisible();

  const login = await request.post(`${API}/auth/login`, { data: { email, password } });
  const headers = { Authorization: `Bearer ${((await login.json()) as { accessToken: string }).accessToken}` };
  await expect(async () => {
    const state = (await (await request.get(`${API}/me/state?pack=vi-south`, { headers })).json()) as { enrolled: boolean; lessonProgress: unknown[]; srsCards: unknown[] };
    expect(state.enrolled).toBe(true);
    expect(state.lessonProgress.length).toBe(1);
    expect(state.srsCards.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });

  // Onboarding envoyé au serveur (motivation « famille » = première réponse) : ligue désactivée par défaut.
  const me = (await (await request.get(`${API}/me`, { headers })).json()) as { profile: { motivation: string | null; leaguesEnabled: boolean }; level: { value: number } };
  expect(me.profile.motivation).not.toBeNull();
  expect(me.level.value).toBeGreaterThanOrEqual(1);

  // Appareil B : connexion → progression restaurée, pas d'onboarding.
  const b = await browser.newContext();
  const pageB = await b.newPage();
  await pageB.goto("/connexion");
  await pageB.getByLabel("Email").fill(email);
  await pageB.getByLabel("Mot de passe").fill(password);
  await pageB.getByRole("button", { name: "Se connecter" }).click();
  await expect(pageB.getByRole("status")).toBeVisible({ timeout: 20_000 });
  await pageB.goto("/apprendre");
  await expect(pageB).not.toHaveURL(/bienvenue|onboarding/);
  await expect(pageB.getByRole("link", { name: "Cinq tons à entendre" })).toBeVisible({ timeout: 20_000 });

  // Séance de révision sans rien à réviser : aucun XP.
  const xpBefore = ((await (await request.get(`${API}/me`, { headers })).json()) as { enrollment: { xpTotal: number } }).enrollment.xpTotal;
  await pageB.goto("/revision");
  await expect(pageB.getByText(/Rien à réviser/)).toBeVisible();
  await pageB.waitForTimeout(1500);
  const xpAfter = ((await (await request.get(`${API}/me`, { headers })).json()) as { enrollment: { xpTotal: number } }).enrollment.xpTotal;
  expect(xpAfter).toBe(xpBefore);

  // Mot de passe oublié : réponse neutre, jeton invalide refusé.
  expect((await request.post(`${API}/auth/password/forgot`, { data: { email } })).status()).toBe(204);
  expect((await request.post(`${API}/auth/password/forgot`, { data: { email: "inconnu@parlo.app" } })).status()).toBe(204);
  expect((await request.post(`${API}/auth/password/reset`, { data: { token: "faux", password: "nouveau-mot-de-passe" } })).status()).toBeGreaterThanOrEqual(400);

  // RGPD : export complet puis suppression effective.
  const exported = (await (await request.get(`${API}/me/export`, { headers })).json()) as Record<string, unknown>;
  expect(JSON.stringify(exported)).toContain("vi-south.u01.l01");
  expect((await request.delete(`${API}/me`, { headers, data: { password: "mauvais" } })).status()).toBe(403);
  expect((await request.delete(`${API}/me`, { headers, data: { password } })).status()).toBe(204);
  expect((await request.post(`${API}/auth/login`, { data: { email, password } })).status()).toBe(401);

  await a.close();
  await b.close();
});
