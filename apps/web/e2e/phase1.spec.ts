import { expect, test, type Page, type Route } from "@playwright/test";
import { onboard, playOneStep, playUntil } from "./helpers.ts";

/**
 * Phase 1 (spec §15) : séance du jour complète avec révisions dues, et création
 * de compte après la première leçon avec migration de l'invité (API simulée).
 */

/** Cartes SRS dues (révisées il y a longtemps) écrites directement dans IndexedDB ; la leçon ouverte est oubliée. */
async function seedDueCards(page: Page, conceptIds: string[]) {
  await page.evaluate(async (ids) => {
    const past = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(["srsCards", "snapshot"], "readwrite");
      for (const conceptId of ids) {
        tx.objectStore("srsCards").put({
          conceptId, due: past, stability: 3, difficulty: 5, scheduledDays: 3, learningSteps: 0, reps: 1, lapses: 0, state: "review", lastReview: past,
        });
      }
      tx.objectStore("snapshot").delete("current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  }, conceptIds);
}

test("séance du jour : révisions dues, nouvelle leçon, mise en pratique, bilan", async ({ page }) => {
  test.setTimeout(180_000);
  await onboard(page, "10 min");
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible();

  await seedDueCards(page, ["c_ba", "c_anh", "c_chao"]);
  await page.reload();
  await expect(page.getByRole("link", { name: "3 mots à revoir" })).toBeVisible();
  await expect(page.getByTestId("tutor-greeting")).toContainText("Cô Mai");
  await page.getByRole("button", { name: /Séance du jour · \d+ min/ }).click();

  await expect(page).toHaveURL(/\/seance$/);
  await expect(page.getByTestId("lesson")).toHaveAttribute("data-phase", "review");
  await expect(page.getByText("Rappel espacé")).toBeVisible();

  // Reprise exacte au milieu des révisions.
  await playOneStep(page, /Séance terminée/);
  const cursor = await page.getByTestId("lesson").getAttribute("data-cursor");
  await page.goto("/");
  await expect(page).toHaveURL(/\/seance$/);
  await expect(page.getByTestId("lesson")).toHaveAttribute("data-cursor", cursor ?? "");

  await playUntil(page, /Séance terminée/);
  await expect(page.getByText(/^\+\d+ XP$/)).toBeVisible();
  await expect(page.getByText(/^Révisé aujourd'hui \(\d\)/)).toBeVisible();
  await expect(page.getByText("Ce que tu sais dire de plus qu'hier :")).toBeVisible();
  await expect(page.getByText("Premier embarcadère")).toBeVisible();

  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page.getByText("1 jour de suite")).toBeVisible();
  await expect(page.getByRole("link", { name: /mots? à revoir/ })).toHaveCount(0);
});

test("création de compte après la première leçon : migration de l'invité vers l'API", async ({ page }) => {
  test.setTimeout(180_000);
  const posted: { type: string }[] = [];
  let registerBody: Record<string, unknown> | null = null;

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const reply = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/register") {
      registerBody = route.request().postDataJSON() as Record<string, unknown>;
      return reply(201, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 });
    }
    if (path === "/auth/refresh") return reply(401, { detail: "no session" });
    if (route.request().headers().authorization !== "Bearer e2e-token") return reply(401, { detail: "unauthorized" });
    if (path === "/me/events") {
      const { events } = route.request().postDataJSON() as { events: { id: string; type: string }[] };
      posted.push(...events);
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    if (path === "/me") {
      return reply(200, {
        user: { id: "u1", email: "lan@parlo.app", displayName: "Lan", locale: "fr", createdAt: new Date().toISOString(), isGuest: false },
        profile: { motivation: "family", dailyGoalMin: 5, reminderHour: null, levelEstimate: null, pathVariant: null },
        enrollment: { courseCode: "vi-south", xpTotal: 1234, level: 1, currentLessonId: null },
        streak: { current: 1, longest: 1, lastActiveDate: url.searchParams.get("localDate"), freezesAvailable: 0, frozenUntil: null },
        levelEstimate: null,
        badges: [{ code: "first_lesson", earnedAt: new Date().toISOString() }],
        dailyGoal: { targetMin: 5, doneTodayMin: 2, localDate: url.searchParams.get("localDate") },
      });
    }
    if (path === "/tutor/greeting") return reply(200, { text: "Te revoilà ! On garde le rythme, tranquillement.", cached: false, source: "model" });
    return reply(404, { detail: "not found" });
  });

  await onboard(page);
  await playUntil(page, /Leçon terminée/);
  await expect(page.getByText("Garde ta progression")).toBeVisible();
  await page.getByRole("link", { name: "Créer un compte" }).click();

  await expect(page.getByRole("heading", { name: "Créer ton compte" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuer avec Google/ })).toBeDisabled();
  await page.getByLabel("Prénom ou pseudo").fill("Lan");
  await page.getByLabel("Email").fill("lan@parlo.app");
  await page.getByLabel("Mot de passe").fill("mot-de-passe-solide");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("alert")).toHaveText("Coche la case d'âge pour créer un compte.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(page.getByRole("heading", { name: "Compte créé" })).toBeVisible();
  expect(registerBody).toMatchObject({ email: "lan@parlo.app", displayName: "Lan", locale: "fr" });
  const types = posted.map((e) => e.type);
  expect(types).toContain("session_started");
  expect(types).toContain("answer_submitted");
  expect(types).toContain("lesson_completed");
  expect(types).toContain("badge_earned");

  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page.getByText("Ta progression est sauvegardée sur ton compte.")).toBeVisible();
  // Le serveur fait foi pour les totaux une fois l'outbox vidée.
  await expect(page.getByText("1234 XP")).toBeVisible();
  await expect(page.getByTestId("tutor-greeting")).toContainText("Te revoilà !");
});
