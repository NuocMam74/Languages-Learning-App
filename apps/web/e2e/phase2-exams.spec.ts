import { expect, test, type Page, type Route } from "@playwright/test";
import { onboard } from "./helpers.ts";

/**
 * Phase 2 (spec §15) : examen blanc hors ligne, examen certifiant (API simulée)
 * jusqu'au certificat et à la page publique de vérification, défi de la semaine,
 * réglage des rappels avec un abonnement push simulé.
 */

const CODE = "7K3M9Q2XAB";
const EXAM_ID = "vi-south.exam.a0";
const SECTIONS = { listening: 8, reading: 6, vocabulary: 6, speaking: 5 } as const;

/** Quitte la première leçon et oublie la séance en cours (sinon le lancement la reprend). */
async function toHub(page: Page) {
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible();
}

async function idbWrite(page: Page, kv: { key: string; value: unknown }[]) {
  await page.evaluate(async (rows) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(["kv", "snapshot"], "readwrite");
      for (const row of rows) tx.objectStore("kv").put(row);
      // Séance en cours : une ligne par pack depuis le schéma multi-pack (ADR 0006) — on les efface toutes.
      tx.objectStore("snapshot").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  }, kv);
}

/** Répond à toutes les questions de l'examen affiché, juste ou non, jusqu'aux résultats. */
async function answerExam(page: Page) {
  const results = page.getByTestId("exam-results");
  const exam = page.getByTestId("exam");
  for (let i = 0; i < 40; i++) {
    await expect(exam.or(results)).toBeVisible({ timeout: 15_000 });
    if (await results.isVisible()) return;
    const index = await exam.getAttribute("data-index");
    const check = page.getByRole("button", { name: "Valider" });
    const radio = page.getByRole("radio").first();
    const done = page.getByRole("button", { name: "C'est fait" });
    await expect(check.or(done).or(radio).first()).toBeVisible();

    if (await radio.isVisible()) {
      await radio.click();
      await check.click();
    } else if (await check.isVisible()) {
      await page.locator("main .flex-wrap").last().locator("button:not([disabled])").first().click();
      await check.click();
    } else {
      await done.click();
    }

    await expect(async () => {
      const snap = await page.evaluate(() => document.querySelector('[data-testid="exam"]')?.getAttribute("data-index") ?? null);
      if (snap === null) return; // résultats ou envoi en cours
      expect(snap).not.toBe(index);
    }).toPass({ timeout: 10_000 });
  }
  throw new Error("L'examen ne se termine pas");
}

test("examen blanc complet hors ligne : résultats par compétence et leçons à revoir", async ({ page, context }) => {
  test.setTimeout(180_000);
  await onboard(page);
  await toHub(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await idbWrite(page, []);
  await page.reload();
  await expect(page.getByRole("link", { name: "Examens et certificats" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("link", { name: "Examens et certificats" }).click();
  await expect(page.getByRole("heading", { name: "Examens" })).toBeVisible();
  // Rien de terminé : l'examen certifiant est verrouillé, l'examen blanc reste ouvert.
  await expect(page.getByTestId("exam-a0").getByText(/Termine d'abord les unités/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Examen certifiant" })).toHaveCount(0);

  await page.getByRole("link", { name: /Examen blanc/ }).first().click();
  await page.getByRole("button", { name: "Commencer l'examen blanc" }).click();
  await expect(page.getByRole("timer")).toHaveText(/^1[45]:\d\d$/);
  await answerExam(page);

  const results = page.getByTestId("exam-results");
  await expect(results.getByText("Écoute")).toBeVisible();
  await expect(results.getByText("Production orale")).toBeVisible();
  await expect(results.getByRole("heading", { name: "À revoir" })).toBeVisible();
  await expect(results.getByRole("link").first().or(results.getByText("Aucune lacune : tu es prêt·e."))).toBeVisible();
  await page.getByRole("button", { name: "Retour aux examens" }).click();
  await expect(page.getByRole("heading", { name: "Examens" })).toBeVisible();
});

test("compte connecté : défi réclamé, examen certifiant réussi, certificat PDF, page de vérification, rappels", async ({ page, context }) => {
  test.setTimeout(240_000);
  const calls: { method: string; path: string; body: unknown }[] = [];
  const now = Date.now();
  const monday = new Date(now - 86_400_000).toISOString();
  const sunday = new Date(now + 6 * 86_400_000).toISOString();

  await context.grantPermissions(["notifications"]);
  // Pas de service de push en test : abonnement simulé.
  await page.addInitScript(() => {
    const fake = {
      endpoint: "https://push.example/sub/e2e",
      toJSON: () => ({ endpoint: "https://push.example/sub/e2e", keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
      unsubscribe: async () => true,
    };
    // Partage natif indisponible : l'image de partage se télécharge (testable).
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    // Un navigateur sans interface déclare les notifications « denied », quoi qu'on accorde au
    // contexte : l'app désactive alors l'interrupteur à juste titre (« bloquées dans les réglages
    // du navigateur »). Ce test porte sur l'abonnement et sur ce qu'il envoie à l'API, pas sur la
    // gestion des permissions par Chromium — on lui donne donc un navigateur qui les accorde.
    if ("Notification" in window) {
      Object.defineProperty(Notification, "permission", { value: "granted", configurable: true });
      Notification.requestPermission = async () => "granted";
    }
    if ("PushManager" in window) {
      PushManager.prototype.subscribe = async () => fake as unknown as PushSubscription;
      PushManager.prototype.getSubscription = async () => null;
    }
  });

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    calls.push({ method, path, body });
    const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });

    if (path === "/auth/refresh") return reply(200, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 });
    if (path === "/verify/" + CODE) {
      return reply(200, {
        valid: true, displayName: "Lan Nguyễn", level: "A0", certificate: { fr: "A0 Bén rễ", en: "A0 Bén rễ" }, issuedAt: new Date(now).toISOString(),
        scores: { listening: 0.875, reading: 1, vocabulary: 0.83, speaking: 0.8 },
      });
    }
    if (path === "/push/vapid-public-key") return reply(200, { key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" });
    if (request.headers().authorization !== "Bearer e2e-token") return reply(401, { detail: "unauthorized" });

    if (path === "/me/events") {
      const { events } = body as { events: { id: string }[] };
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    if (path === "/me") {
      return reply(200, {
        user: { id: "u1", email: "lan@parlo.app", displayName: "Lan Nguyễn", locale: "fr", createdAt: new Date(now).toISOString(), isGuest: false },
        profile: { motivation: "family", dailyGoalMin: 5, reminderHour: null, levelEstimate: null, pathVariant: null },
        enrollment: { courseCode: "vi-south", xpTotal: 100, level: 1, currentLessonId: null },
        streak: { current: 0, longest: 0, lastActiveDate: null, freezesAvailable: 0, frozenUntil: null },
      });
    }
    if (path === "/me/profile" && method === "PATCH") return reply(200, {});
    if (path === "/challenges/current") {
      const claimed = calls.some((c) => c.path === "/challenges/ch1/claim");
      return reply(200, [{
        id: "ch1", kind: "lessons", title: { fr: "5 leçons cette semaine" }, target: 5, unit: null, progress: 5,
        completedAt: new Date(now).toISOString(), claimedAt: claimed ? new Date(now).toISOString() : null, periodStart: monday, periodEnd: sunday, badgeCode: "challenge_lessons",
      }]);
    }
    if (path === "/challenges/ch1/claim") return reply(200, { claimedAt: new Date(now).toISOString(), xp: 50 });
    if (path === "/exams") {
      return reply(200, [{ id: EXAM_ID, level: "A0", certificate: { fr: "A0 Bén rễ" }, requiresUnits: [], durationMinutes: 15, unlocked: true, lastAttempt: null, nextAttemptAt: null }]);
    }
    if (path === `/exams/${EXAM_ID}/start`) {
      const items = Object.entries(SECTIONS).flatMap(([section, n]) => Array.from({ length: n }, (_, index) => ({ section, index })));
      return reply(201, { attemptId: "att-1", seed: "att-1", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), items });
    }
    if (path === "/exams/attempts/att-1/submit") {
      return reply(200, {
        passed: true, global: 0.92, scores: { listening: 0.875, reading: 1, vocabulary: 0.83, speaking: 0.8 },
        gaps: [{ skill: "vocabulary", conceptIds: ["c_vo"] }], certificate: { id: "cert1", verificationCode: CODE },
      });
    }
    if (path === "/certificates") {
      return reply(200, [{ id: "cert1", level: "A0", issuedAt: new Date(now).toISOString(), verificationCode: CODE, pdfUrl: "/certificates/cert1.pdf", shareImageUrl: "" }]);
    }
    if (path === "/certificates/cert1.pdf") return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
    if (path === "/push/subscribe") return route.fulfill({ status: 204 });
    return reply(404, { detail: "not found" });
  });

  await onboard(page);
  await toHub(page);
  await idbWrite(page, [{ key: "account", value: { email: "lan@parlo.app", displayName: "Lan Nguyễn", locale: "fr", linkedAt: new Date(now).toISOString() } }]);
  await page.goto("/");

  // Défi de la semaine
  const challenge = page.getByTestId("challenge");
  await expect(challenge.getByText("5 leçons cette semaine")).toBeVisible();
  await expect(challenge.getByText("5 sur 5")).toBeVisible();
  await challenge.getByRole("button", { name: "Récupérer le badge" }).click();
  await expect(challenge.getByText("Badge récupéré · +50 XP")).toBeVisible();

  // Examen certifiant : l'entrée vit sur le parcours de la langue (contrat phase7 §1).
  await page.goto("/apprendre");
  await page.getByRole("link", { name: "Examens et certificats" }).click();
  await page.getByRole("link", { name: "Examen certifiant" }).click();
  await expect(page.getByText("Une seule tentative toutes les 48 heures.")).toBeVisible();
  await expect(page.getByText(/micro/)).toBeVisible();
  await page.getByRole("button", { name: "Commencer l'examen" }).click();
  await answerExam(page);

  const submit = calls.find((c) => c.path === "/exams/attempts/att-1/submit");
  const answers = (submit?.body as { answers: { section: string; index: number; response: { kind: string }; responseMs: number }[] }).answers;
  expect(answers).toHaveLength(25);
  expect(answers.filter((a) => a.section === "speaking")).toHaveLength(5);

  const results = page.getByTestId("exam-results");
  await expect(results).toHaveAttribute("data-passed", "true");
  await expect(results.getByRole("heading", { name: "Réussi" })).toBeVisible();
  await expect(results.getByText("92 %")).toBeVisible();
  await page.getByRole("button", { name: "Voir mon certificat" }).click();

  await expect(page.getByTestId("certificate-ready")).toBeVisible();
  await expect(page.getByText(`Code de vérification : ${CODE}`)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le PDF" }).click();
  expect((await download).suggestedFilename()).toBe(`parlo-certificat-A0-${CODE}.pdf`);
  const image = page.waitForEvent("download");
  await page.getByRole("button", { name: "Partager l'image" }).click();
  expect((await image).suggestedFilename()).toBe("parlo-A0.png");

  await page.getByRole("link", { name: "Mes certificats" }).click();
  await expect(page.getByTestId("certificate")).toHaveCount(1);

  // Page publique de vérification
  await page.goto(`/verifier/${CODE}`);
  await expect(page.getByText("Certificat authentique")).toBeVisible();
  await expect(page.getByText("Lan Nguyễn")).toBeVisible();

  // Rappels : abonnement push + fuseau horaire dans le profil
  await page.goto("/reglages");
  const reminders = page.getByTestId("reminder-settings");
  await reminders.getByLabel("Heure du rappel").selectOption("8");
  await reminders.getByRole("switch", { name: "Un rappel par jour" }).click();
  await expect(reminders.getByRole("switch", { name: "Un rappel par jour" })).toHaveAttribute("aria-checked", "true");
  const subscribe = calls.find((c) => c.path === "/push/subscribe" && c.method === "POST");
  expect(subscribe?.body).toMatchObject({ endpoint: "https://push.example/sub/e2e", keys: { p256dh: "p256dh-key", auth: "auth-key" }, reminderHour: 8 });
  expect(typeof (subscribe?.body as { timezone?: unknown }).timezone).toBe("string");
  expect(calls.find((c) => c.path === "/me/profile" && c.method === "PATCH")?.body).toMatchObject({ notificationsEnabled: true, reminderHour: 8 });
});
