import { expect, test, type Page, type Route } from "@playwright/test";
import { onboard } from "./helpers.ts";

/**
 * Contrat phase5-parcours côté PWA (API simulée) : restauration sur un second appareil, test d'unité
 * échoué puis réussi, révision vide et garde de lien profond, examen sans double envoi (409 déjà soumis)
 * et notation sans médias, mot de passe oublié / réinitialisation / vérification d'email,
 * suppression du compte, déconnexion qui efface l'appareil.
 */

const TOKEN = "e2e-token";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Renvoie "next" pour laisser la suite de la simulation répondre. */
type Handler = (path: string, method: string, body: unknown, route: Route) => Promise<void> | "next";

/** API simulée : refresh selon `signedIn`, jeton exigé, puis `handler` ; 404 sinon. */
async function mockApi(page: Page, options: { signedIn: boolean; handler?: Handler }) {
  const calls: Call[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    calls.push({ method, path, body });
    const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    if (options.handler) {
      const result = options.handler(path, method, body, route);
      if (result !== "next") {
        await result;
        return;
      }
    }
    if (path === "/auth/refresh") return options.signedIn ? reply(200, { accessToken: TOKEN, tokenType: "bearer", expiresIn: 900 }) : reply(401, { detail: "no" });
    if (request.headers().authorization !== `Bearer ${TOKEN}`) return reply(401, { detail: "unauthorized" });
    if (path === "/me/events") {
      const { events } = body as { events: { id: string }[] };
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    return reply(404, { detail: "not found" });
  });
  return calls;
}

const ME = (extra: Record<string, unknown> = {}) => ({
  user: { id: "u1", email: "lan@parlo.app", displayName: "Lan", locale: "fr", createdAt: new Date().toISOString(), isGuest: false, emailVerified: true },
  profile: { motivation: "family", dailyGoalMin: 10, reminderHour: null, levelEstimate: null, pathVariant: null },
  enrollment: { courseCode: "vi-south", xpTotal: 350, level: 3, currentLessonId: null },
  enrollments: [{ courseCode: "vi-south", xpTotal: 350, level: 3, currentLessonId: null }],
  streak: { current: 3, longest: 3, lastActiveDate: today(), freezesAvailable: 0, frozenUntil: null },
  badges: [{ code: "first_lesson", earnedAt: new Date().toISOString() }],
  roles: ["learner"],
  ...extra,
});

const countStore = (page: Page, store: string) =>
  page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(name).objectStore(name).count();
          req.onsuccess = () => {
            resolve(req.result);
            open.result.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
    store,
  );

test("second appareil : la connexion restaure progression, XP et série ; ni onboarding ni placement", async ({ page }) => {
  const calls = await mockApi(page, {
    signedIn: false,
    handler: (path, method, _body, route) => {
      const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
      if (path === "/auth/login" && method === "POST") return reply(200, { accessToken: TOKEN, tokenType: "bearer", expiresIn: 900 });
      if (route.request().headers().authorization !== `Bearer ${TOKEN}`) return "next";
      if (path === "/me") return reply(200, ME());
      if (path === "/me/state") {
        const at = new Date().toISOString();
        return reply(200, {
          profile: { motivation: "family", dailyGoalMin: 10, reminderHour: 19 },
          placement: null,
          lessonProgress: ["l01", "l02", "l03"].map((l) => ({ lessonId: `vi-south.u01.${l}`, bestScore: 1, attempts: 1, completedAt: at })),
          srsCards: [],
          badges: [{ code: "first_lesson", earnedAt: at }, { code: "challenge_lessons", earnedAt: at }],
          streak: { current: 3, longest: 3, lastActiveDate: today(), freezesAvailable: 0, frozenUntil: null },
          xpTotal: 350,
          level: { value: 3, name: null, xpIntoLevel: 100, xpForNext: 200 },
          enrolled: true,
        });
      }
      return "next";
    },
  });

  await page.goto("/connexion");
  await page.getByLabel("Email").fill("lan@parlo.app");
  await page.getByLabel("Mot de passe").fill("mot-de-passe-solide");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Te revoilà" })).toBeVisible();
  expect(calls.some((c) => c.path === "/me/state")).toBe(true);
  await page.getByRole("button", { name: "Retour au parcours" }).click();

  // Hub directement (compte inscrit) : progression du serveur.
  await expect(page.getByTestId("hub-pack")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("350 XP", { exact: true })).toBeVisible();
  await expect(page.getByText("3 jours de suite")).toBeVisible();
  await expect(page.getByTestId("level")).toHaveAttribute("data-level", "3");
  expect(await countStore(page, "lessonProgress")).toBe(3);
  // Badge de défi du serveur visible sur la page Badges.
  await page.getByRole("link", { name: "Badges" }).click();
  await expect(page.getByTestId("challenge-badges")).toBeVisible();
});

test.describe(() => {
// Bundle intercepté : service worker bloqué.
test.use({ serviceWorkers: "block" });
test("test d'unité : échoué → « Presque ! Refais le test », puis réussi → l'unité suivante s'ouvre", async ({ page }) => {
  test.setTimeout(150_000);
  // Test d'unité réduit à 3 écoutes au texte connu (réponses juste / fausse déterministes).
  await page.route("**/content/vi-south/v*/bundle.json", async (route) => {
    const response = await route.fetch();
    const bundle = (await response.json()) as { lessons: { id: string; steps: unknown[]; concepts: string[]; review: { srsIntroduce: string[] } }[] };
    const test = bundle.lessons.find((l) => l.id === "vi-south.u01.l09")!;
    test.steps = [
      { type: "listen_pick_text", concept: "c_ba", distractors: ["chào", "anh"] },
      { type: "listen_pick_text", concept: "c_chao", distractors: ["ba", "anh"] },
      { type: "listen_pick_text", concept: "c_anh", distractors: ["ba", "chào"] },
    ];
    test.concepts = ["c_ba", "c_chao", "c_anh"];
    test.review = { srsIntroduce: [] };
    await route.fulfill({ response, json: bundle });
  });

  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByTestId("hub-pack")).toBeVisible();
  // Unité 1 terminée sauf son test.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["lessonProgress", "snapshot"], "readwrite");
      for (let i = 1; i <= 8; i++) {
        tx.objectStore("lessonProgress").put({ lessonId: `vi-south.u01.l0${i}`, packCode: "vi-south", status: "completed", bestScore: 1, attempts: 1, completedAt: new Date().toISOString() });
      }
      tx.objectStore("snapshot").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.goto("/lecon/vi-south.u01.l09");
  await playTest(page, false);
  await expect(page.getByTestId("unit-test-failed")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Presque ! Refais le test" })).toBeVisible();
  await expect(page.getByText(/Il faut 70 %/)).toBeVisible();
  await page.getByRole("button", { name: "Refaire le test" }).click();

  await playTest(page, true);
  await expect(page.getByTestId("unit-test-passed")).toBeVisible();
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page.getByRole("link", { name: "Douze voyelles" })).toBeVisible();
});
});

/** Joue le test réduit : la bonne option est le mot du concept de l'étape (ordre c_ba, c_chao, c_anh ; relances à la fin). */
async function playTest(page: Page, right: boolean) {
  const recap = page.getByTestId("unit-test-failed").or(page.getByTestId("unit-test-passed"));
  // Mot attendu par étape, lu dans le snapshot IndexedDB (file de la leçon) pour rester déterministe.
  const words = ["ba", "chào", "anh"];
  for (let i = 0; i < 20; i++) {
    const lesson = page.locator('[data-testid="lesson"][data-status="answering"]');
    const cont = page.getByRole("button", { name: "Continuer" });
    // Une bonne réponse enchaîne seule ; une erreur attend « Continuer ».
    await expect(recap.or(lesson).or(cont)).toBeVisible({ timeout: 15_000 });
    if (await recap.isVisible()) return;
    if (await cont.isVisible()) {
      await cont.click();
      continue;
    }
    const stepIndex = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("parlo");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const req = open.result.transaction("snapshot").objectStore("snapshot").get("vi-south");
            req.onsuccess = () => {
              const run = (req.result as { session: { lesson: { queue: { stepIndex: number }[]; cursor: number } } }).session.lesson;
              resolve(run.queue[run.cursor]!.stepIndex);
              open.result.close();
            };
            req.onerror = () => reject(req.error);
          };
        }),
    );
    const word = words[stepIndex]!;
    const radios = page.getByRole("radio");
    await expect(radios).toHaveCount(3);
    const texts = (await radios.allInnerTexts()).map((s) => s.trim());
    const choice = right ? texts.indexOf(word) : texts.findIndex((s) => s !== word);
    const cursor = await lesson.getAttribute("data-cursor");
    await radios.nth(choice).click();
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(async () => {
      if (await recap.isVisible()) return;
      const snap = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="lesson"]');
        return el ? { status: el.getAttribute("data-status"), cursor: el.getAttribute("data-cursor") } : null;
      });
      expect(snap !== null && (snap.status === "feedback" || snap.cursor !== cursor)).toBe(true);
    }).toPass({ timeout: 10_000 });
  }
  throw new Error("Le test d'unité ne se termine pas");
}

test("révision vide : « Rien à réviser », aucun XP ; lien profond vers une leçon fermée → hub avec message", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByText("0 XP", { exact: true })).toBeVisible();

  for (let i = 0; i < 3; i++) {
    await page.goto("/revision");
    await expect(page.getByRole("heading", { name: "Rien à réviser pour l'instant" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page.getByText("0 XP", { exact: true })).toBeVisible();
  const completed = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("outbox").objectStore("outbox").getAll();
          req.onsuccess = () => {
            resolve((req.result as { event: { type: string } }[]).filter((r) => r.event.type === "session_completed").length);
            open.result.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
  expect(completed).toBe(0);

  await page.goto("/lecon/vi-south.u24.l08");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("hub-notice")).toHaveText(/pas encore débloquée/);
});

test("examen certifiant : une seule soumission ; 409 déjà soumis → résultat ; oraux sans courbe non notés", async ({ page }) => {
  test.setTimeout(200_000);
  const EXAM_ID = "vi-south.exam.a0";
  const SECTIONS = { listening: 8, reading: 6, vocabulary: 6, speaking: 5 } as const;
  const calls = await mockApi(page, {
    signedIn: true,
    handler: (path, _method, _body, route) => {
      const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
      if (route.request().headers().authorization !== `Bearer ${TOKEN}`) return "next";
      if (path === "/me") return reply(200, ME());
      if (path === "/exams") {
        return reply(200, [{ id: EXAM_ID, level: "A0", certificate: { fr: "A0 Bén rễ" }, requiresUnits: [], durationMinutes: 15, unlocked: true, lastAttempt: null, nextAttemptAt: null, unavailableReason: null }]);
      }
      if (path === `/exams/${EXAM_ID}/start`) {
        const items = Object.entries(SECTIONS).flatMap(([section, n]) => Array.from({ length: n }, (_, index) => ({ section, index })));
        return reply(201, { attemptId: "att-9", seed: "att-9", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), items });
      }
      // Une soumission précédente (autre onglet) a déjà été enregistrée.
      if (path === "/exams/attempts/att-9/submit") return reply(409, { detail: "already_submitted" });
      if (path === "/exams/attempts/att-9") {
        return reply(200, { passed: false, global: 0.62, scores: { listening: 0.5, reading: 0.83, vocabulary: 0.5, speaking: null }, gaps: [], certificate: null });
      }
      return "next";
    },
  });

  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["kv", "snapshot"], "readwrite");
      tx.objectStore("kv").put({ key: "account", value: { email: "lan@parlo.app", displayName: "Lan", locale: "fr", linkedAt: new Date().toISOString() } });
      tx.objectStore("snapshot").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto("/examens/a0");
  await page.getByRole("button", { name: "Commencer l'examen" }).click();

  const results = page.getByTestId("exam-results");
  const exam = page.getByTestId("exam");
  for (let i = 0; i < 40; i++) {
    await expect(exam.or(results)).toBeVisible({ timeout: 15_000 });
    if (await results.isVisible()) break;
    const index = await exam.getAttribute("data-index");
    // Aucune transcription pendant l'examen, même en mode silencieux.
    await expect(page.getByTestId("transcript")).toHaveCount(0);
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
      if (snap === null) return;
      expect(snap).not.toBe(index);
    }).toPass({ timeout: 10_000 });
  }

  await expect(results).toHaveAttribute("data-passed", "false");
  await expect(results.getByText("62 %")).toBeVisible();
  await expect(results.getByText("non noté")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(calls.filter((c) => c.path === "/exams/attempts/att-9/submit")).toHaveLength(1);
});

test("examen blanc sans médias : oraux et écoutes tonales non notés, Production orale « non noté », pas de transcription", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem("parlo.prefs", JSON.stringify({ locale: null, silent: true, dictation: false })));
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await page.goto("/examens/a0/blanc");
  await page.getByRole("button", { name: "Commencer l'examen blanc" }).click();
  const results = page.getByTestId("exam-results");
  const exam = page.getByTestId("exam");
  for (let i = 0; i < 40; i++) {
    await expect(exam.or(results)).toBeVisible({ timeout: 15_000 });
    if (await results.isVisible()) break;
    await expect(page.getByTestId("transcript")).toHaveCount(0);
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
      if (snap === null) return;
      expect(snap).not.toBe(index);
    }).toPass({ timeout: 10_000 });
  }
  const speaking = results.locator("li").filter({ hasText: "Production orale" });
  await expect(speaking.getByText("non noté")).toBeVisible();
});

test("mot de passe oublié, réinitialisation et vérification d'email", async ({ page }) => {
  const calls = await mockApi(page, {
    signedIn: false,
    handler: (path, method, body, route) => {
      if (path === "/auth/password/forgot" && method === "POST") return route.fulfill({ status: 204 });
      if (path === "/auth/password/reset" && method === "POST") {
        const token = (body as { token?: string }).token;
        return token === "good-token" ? route.fulfill({ status: 204 }) : route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: "invalid_token" }) });
      }
      if (path === "/auth/email/verify" && method === "POST") return route.fulfill({ status: 204 });
      return "next";
    },
  });

  await page.goto("/connexion");
  await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
  await expect(page).toHaveURL(/\/compte\/mot-de-passe-oublie$/);
  await page.getByLabel("Email").fill("lan@parlo.app");
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByTestId("forgot-sent")).toBeVisible();
  expect(calls.find((c) => c.path === "/auth/password/forgot")?.body).toEqual({ email: "lan@parlo.app" });

  await page.goto("/compte/reinitialiser?token=old-token");
  await page.getByLabel("Nouveau mot de passe").fill("un-nouveau-mot-de-passe");
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByRole("alert")).toHaveText(/n'est plus valable/);

  await page.goto("/compte/reinitialiser?token=good-token");
  await page.getByLabel("Nouveau mot de passe").fill("un-nouveau-mot-de-passe");
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByTestId("reset-done")).toBeVisible();
  expect(calls.filter((c) => c.path === "/auth/password/reset").at(-1)?.body).toEqual({ token: "good-token", password: "un-nouveau-mot-de-passe" });

  await page.goto("/compte/verifier?token=verify-me");
  await expect(page.getByTestId("verify-email")).toHaveAttribute("data-state", "done");
  expect(calls.find((c) => c.path === "/auth/email/verify")?.body).toEqual({ token: "verify-me" });
});

async function signedInWithProgress(page: Page, calls: Call[]) {
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["kv", "lessonProgress", "snapshot"], "readwrite");
      tx.objectStore("kv").put({ key: "account", value: { email: "lan@parlo.app", displayName: "Lan", locale: "fr", linkedAt: new Date().toISOString(), emailVerified: true } });
      tx.objectStore("lessonProgress").put({ lessonId: "vi-south.u01.l01", packCode: "vi-south", status: "completed", bestScore: 1, attempts: 1, completedAt: new Date().toISOString() });
      tx.objectStore("snapshot").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto("/reglages");
  await expect(page.getByText(/Connecté·e : Lan/)).toBeVisible();
  void calls;
}

test("suppression du compte : mot de passe envoyé, serveur puis appareil effacés", async ({ page }) => {
  const calls = await mockApi(page, {
    signedIn: true,
    handler: (path, method, body, route) => {
      if (route.request().headers().authorization !== `Bearer ${TOKEN}`) return "next";
      if (path === "/me" && method === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME()) });
      if (path === "/me" && method === "DELETE") {
        return (body as { password?: string }).password === "mot-de-passe-solide"
          ? route.fulfill({ status: 204 })
          : route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "invalid_password" }) });
      }
      return "next";
    },
  });
  await signedInWithProgress(page, calls);

  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  const form = page.getByTestId("delete-account");
  await form.getByLabel("Mot de passe").fill("faux");
  await form.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(form.getByRole("alert")).toHaveText("Mot de passe incorrect.");
  await form.getByLabel("Mot de passe").fill("mot-de-passe-solide");
  await form.getByRole("button", { name: "Supprimer définitivement" }).click();

  await expect(page).toHaveURL(/\/bienvenue$/);
  expect(calls.filter((c) => c.method === "DELETE" && c.path === "/me").at(-1)?.body).toEqual({ password: "mot-de-passe-solide" });
  expect(await countStore(page, "lessonProgress")).toBe(0);
});

test("déconnexion : avertissement, envoi de l'outbox, progression effacée de l'appareil", async ({ page }) => {
  const calls = await mockApi(page, {
    signedIn: true,
    handler: (path, method, _body, route) => {
      if (path === "/auth/logout" && method === "POST") return route.fulfill({ status: 204 });
      if (route.request().headers().authorization !== `Bearer ${TOKEN}`) return "next";
      if (path === "/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME()) });
      return "next";
    },
  });
  await signedInWithProgress(page, calls);

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByTestId("logout-confirm")).toBeVisible();
  await page.getByRole("button", { name: "Me déconnecter" }).click();
  await expect(page).toHaveURL(/\/bienvenue$/);
  expect(calls.some((c) => c.path === "/auth/logout")).toBe(true);
  expect(await countStore(page, "lessonProgress")).toBe(0);
  expect(await countStore(page, "outbox")).toBe(0);
  const account = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("kv").objectStore("kv").get("account");
          req.onsuccess = () => {
            resolve(req.result ?? null);
            open.result.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
  expect(account).toBeNull();
});
