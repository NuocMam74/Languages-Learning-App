import { expect, test } from "@playwright/test";
import { onboard, playUntil } from "./helpers.ts";

/**
 * Intégration réelle PWA + API (sans simulation). Nécessite l'API sur :8000
 * (ROOT_PATH=/api) et `vite` en dev sur :5173 (proxy /api).
 * Lancer : PARLO_INTEGRATION=1 npx playwright test e2e/integration.spec.ts
 */
test.skip(!process.env.PARLO_INTEGRATION, "intégration réelle désactivée (PARLO_INTEGRATION)");
test.use({ baseURL: "http://localhost:5173" });

test("un invité crée son compte et sa progression arrive sur le serveur", async ({ page, request }) => {
  const email = `int-${Date.now()}@parlo.app`;
  const password = "mot-de-passe-solide";

  await onboard(page);
  await playUntil(page, /Leçon terminée|Séance terminée/);
  await page.getByRole("link", { name: "Créer un compte" }).click();
  await page.getByLabel("Prénom ou pseudo").fill("Lan");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("heading", { name: "Compte créé" })).toBeVisible();

  // Le serveur doit refléter la leçon, l'XP et la série envoyées par l'outbox de l'invité.
  const login = await request.post("http://localhost:8000/auth/login", { data: { email, password } });
  expect(login.ok()).toBe(true);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  await expect(async () => {
    const me = await (await request.get("http://localhost:8000/me", { headers })).json();
    expect(me.enrollment.xpTotal).toBeGreaterThan(0);
    expect(me.streak.current).toBe(1);
    expect(me.badges.map((b: { code: string }) => b.code)).toContain("first_lesson");
    expect(me.enrollment.currentLessonId).toBe("vi-south.u01.l02");
  }).toPass({ timeout: 15_000 });

  const greeting = await (await request.get("http://localhost:8000/tutor/greeting?locale=fr", { headers })).json();
  expect(greeting.source).toBe("fallback"); // pas de clé Anthropic en local
  const plan = await (await request.get("http://localhost:8000/me/session/next", { headers })).json();
  expect(JSON.stringify(plan)).toContain("vi-south.u01.l02");
});
