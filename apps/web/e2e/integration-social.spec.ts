import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Phase 3 en intégration réelle avec l'API : défi entre amis à deux comptes,
 * ligue, score du défi express et page de partage publique.
 * Nécessite l'API sur :8000 et `vite` en dev sur :5173 (voir integration.spec.ts).
 */
test.skip(!process.env.PARLO_INTEGRATION, "intégration réelle désactivée (PARLO_INTEGRATION)");
test.use({ baseURL: "http://localhost:5173" });

const API = "http://localhost:8000";

async function account(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { email: `${name.toLowerCase()}-${Date.now()}@parlo.app`, password: "mot-de-passe-solide", displayName: name, locale: "fr" },
  });
  expect(res.ok()).toBe(true);
  return { Authorization: `Bearer ${((await res.json()) as { accessToken: string }).accessToken}` };
}

test("défi entre amis, ligue et partage du défi express", async ({ page, request }) => {
  const lan = await account(request, "Lan");
  const minh = await account(request, "Minh");

  const created = await request.post(`${API}/challenges/friends`, { headers: lan, data: { kind: "xp_7d" } });
  expect(created.status()).toBe(201);
  const { inviteCode } = (await created.json()) as { inviteCode: string };

  const joined = await request.post(`${API}/challenges/friends/join/${inviteCode}`, { headers: minh });
  expect(joined.ok()).toBe(true);
  const participants = ((await joined.json()) as { participants: { displayName: string }[] }).participants.map((p) => p.displayName);
  expect(participants.sort()).toEqual(["Lan", "Minh"]);
  expect((await request.post(`${API}/challenges/friends/join/INCONNU0`, { headers: minh })).status()).toBe(404);

  // Ligue : activée explicitement (désactivable, jamais imposée).
  await request.patch(`${API}/me/profile`, { headers: lan, data: { leaguesEnabled: true } });
  const league = (await (await request.get(`${API}/leagues/me`, { headers: lan })).json()) as { enabled: boolean; divisionName?: { fr: string } };
  expect(league.enabled).toBe(true);
  expect(league.divisionName?.fr).toBe("Rạch");

  const today = new Date().toISOString().slice(0, 10);
  const score = await request.post(`${API}/challenges/express/scores`, { headers: lan, data: { game: "cho_noi", score: 120, correct: 10, total: 12, localDate: today } });
  expect(score.ok()).toBe(true);
  const { id } = (await score.json()) as { id: string };

  await page.goto(`/partage/${id}`);
  await expect(page.getByText("Lan")).toBeVisible();
  await expect(page.getByText("120").first()).toBeVisible();
});
