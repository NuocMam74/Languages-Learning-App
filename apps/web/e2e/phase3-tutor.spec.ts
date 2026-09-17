import { expect, test, type Page, type Route } from "@playwright/test";
import { onboard } from "./helpers.ts";

/**
 * Phase 3 — Cô Mai (contrat docs/contracts/phase3.md §1) : conversation en flux
 * SSE simulé (page.route), gloses, correction douce, quota, repli « se repose »,
 * dictée (Web Speech API simulée), Đối đáp 6 tours, bilan de la semaine.
 */

type Call = { method: string; path: string; body: unknown; auth: string | undefined };

const sse = (events: [string, unknown][]) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

async function toHub(page: Page) {
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible();
}

async function signIn(page: Page) {
  await page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(["kv", "snapshot"], "readwrite");
      tx.objectStore("kv").put({ key: "account", value: { email: "lan@parlo.app", displayName: "Lan", locale: "fr", linkedAt: new Date().toISOString() } });
      // Oublie la séance en cours (quelle que soit sa clé), sinon le lancement la reprend.
      tx.objectStore("snapshot").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  });
}

/** API simulée : auth, /me, événements, conversations Cô Mai en flux SSE. */
async function mockApi(page: Page, calls: Call[]) {
  let messageCalls = 0;
  let doiDapTurns = 0;
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const auth = request.headers().authorization;
    calls.push({ method, path, body, auth });
    const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    const stream = (events: [string, unknown][]) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }, body: sse(events) });

    if (path === "/auth/refresh") return reply(200, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 });
    if (auth !== "Bearer e2e-token") return reply(401, { detail: "unauthorized" });
    if (path === "/me/events") {
      const { events } = body as { events: { id: string }[] };
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    if (path === "/me") {
      return reply(200, {
        user: { id: "u1", email: "lan@parlo.app", displayName: "Lan", locale: "fr", createdAt: new Date().toISOString(), isGuest: false },
        profile: { motivation: "family", dailyGoalMin: 5, reminderHour: null, levelEstimate: null, pathVariant: null },
        enrollment: { courseCode: "vi-south", xpTotal: 0, level: 1, currentLessonId: null },
        streak: { current: 0, longest: 0, lastActiveDate: null, freezesAvailable: 0, frozenUntil: null },
      });
    }
    if (path === "/tutor/greeting") return reply(200, { text: "Chào em!", cached: true, source: "fallback" });
    if (path === "/tutor/conversations" && method === "POST") {
      const mode = (body as { mode: string }).mode;
      if (mode === "doi_dap") return reply(201, { conversationId: "dd1", opening: { text: "Chào em! Em tên gì?", glosses: [] } });
      return reply(201, { conversationId: "conv1", opening: { text: "Chào em! Hôm nay em khỏe không?", glosses: [{ vi: "hôm nay", gloss: { fr: "aujourd'hui", en: "today" } }] } });
    }
    if (path === "/tutor/conversations/conv1/messages") {
      messageCalls++;
      // Jeton expiré au premier envoi : rafraîchi puis rejoué une fois, avant le flux.
      if (messageCalls === 1) return reply(401, { detail: "token_expired" });
      if (messageCalls === 2) {
        return stream([
          ["sentence", { text: "Dạ, em khỏe há." }],
          ["gloss", { vi: "há", gloss: { fr: "hein (particule du Sud)", en: "right? (Southern particle)" } }],
          ["sentence", { text: "Em ăn cơm chưa?" }],
          ["correction", { original: "em khoe", corrected: "Em khỏe.", explanation: "« khỏe » porte le ton hỏi." }],
          ["done", { turn: 1, remainingToday: 4 }],
        ]);
      }
      return stream([["fallback", { text: "", reason: "quota" }]]);
    }
    if (path === "/tutor/conversations/dd1/messages") {
      doiDapTurns++;
      return stream([
        ["sentence", { text: `Dạ, câu ${doiDapTurns} nghen.` }],
        ["done", { turn: doiDapTurns, remainingToday: 20 - doiDapTurns }],
      ]);
    }
    if (path === "/tutor/conversations/dd1/end") return reply(200, { fluency: 72, summary: { fr: "Tu réponds vite, bravo.", en: "Quick answers, well done." } });
    if (path.startsWith("/tutor/debrief/weekly")) {
      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      return reply(200, {
        weekStart: monday.toISOString().slice(0, 10),
        progress: "Tu reconnais bien les salutations.",
        struggles: "Les tons hỏi et ngã se confondent encore.",
        goal: "Deux petites conversations avec moi.",
        source: "model",
        cached: false,
      });
    }
    return reply(404, { detail: "not found" });
  });
}

/** Web Speech API simulée : la dictée renvoie une phrase fixe. */
async function fakeSpeech(page: Page) {
  // La dictée est désactivée par défaut (§14) : on l'active comme le ferait l'utilisateur dans les réglages.
  await page.addInitScript(() => {
    const raw = localStorage.getItem("parlo.prefs");
    const prefs = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem("parlo.prefs", JSON.stringify({ ...prefs, dictation: true }));
  });
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { __recognitionLang: string }).__recognitionLang = this.lang;
        setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "Dạ em ăn rồi" }], { isFinal: true })] });
          this.onend?.();
        }, 150);
      }
      stop() {}
      abort() {}
    }
    // Préfixée ou non selon le navigateur : on remplace les deux.
    Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeRecognition, configurable: true, writable: true });
    Object.defineProperty(window, "SpeechRecognition", { value: FakeRecognition, configurable: true, writable: true });
  });
}

test("invité : Cô Mai demande un compte, Đối đáp aussi", async ({ page }) => {
  // Cô Mai disponible côté serveur : ce qui bloque ici est l'absence de compte, pas l'absence de modèle.
  await page.route("**/api/tutor/status**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, reason: null, personaName: "Cô Mai" }) }));
  await onboard(page);
  await toHub(page);
  // Les entrées Cô Mai vivent sur l'accueil (contrat phase7 §2.5).
  await page.goto("/");
  await page.getByRole("link", { name: "Parler avec Cô Mai" }).click();
  await expect(page.getByTestId("tutor-gate")).toHaveAttribute("data-reason", "guest");
  await expect(page.getByText("Pour discuter avec Cô Mai, il faut un compte.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Créer un compte" })).toHaveAttribute("href", "/compte");

  await page.goto("/jeux");
  await page.locator('[data-game="doi_dap"]').click();
  await expect(page.getByTestId("doi-dap")).toHaveAttribute("data-phase", "unavailable");
  await expect(page.getByRole("button", { name: "Jouer" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Créer un compte" })).toBeVisible();
});

test("compte connecté : conversation en flux, glose, correction, dictée, quota puis repos, événement sans contenu", async ({ page }) => {
  test.setTimeout(120_000);
  const calls: Call[] = [];
  await fakeSpeech(page);
  await mockApi(page, calls);
  await onboard(page);
  await toHub(page);
  await signIn(page);
  await page.goto("/");

  await page.getByRole("link", { name: "Parler avec Cô Mai" }).click();
  await page.getByRole("button", { name: "Commencer la conversation" }).click();
  await expect(page).toHaveURL(/\/co-mai\/conv1$/);
  const chat = page.getByTestId("chat");
  await expect(chat.getByText("Hôm nay em khỏe không?")).toBeVisible();
  // Glose de l'ouverture (fournie par le serveur).
  await chat.getByRole("button", { name: "Hôm nay" }).click();
  await expect(chat.getByTestId("gloss")).toContainText("aujourd'hui");

  // 1er message : 401 → rafraîchissement → rejeu, puis flux phrase par phrase.
  await page.getByLabel("Ton message").fill("em khoe");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(chat.getByText("Dạ, em khỏe há.")).toBeVisible();
  await expect(chat.getByText("Em ăn cơm chưa?")).toBeVisible();
  await expect(page.getByTestId("typing")).toHaveCount(0);
  const correction = page.getByTestId("user-message").first().getByTestId("correction");
  await expect(correction).toContainText("Em khỏe.");
  await expect(correction).toContainText("porte le ton hỏi");
  await expect(page.getByTestId("quota")).toHaveText("Encore 4 messages aujourd'hui");
  const messageCalls = calls.filter((c) => c.path === "/tutor/conversations/conv1/messages");
  expect(messageCalls).toHaveLength(2);
  expect(messageCalls[1]!.body).toEqual({ text: "em khoe", inputMode: "text" });

  // Glose d'un mot nouveau (événement gloss).
  await page.getByTestId("tutor-message").nth(1).getByRole("button", { name: "há" }).click();
  await expect(page.getByTestId("tutor-message").nth(1).getByTestId("gloss")).toContainText("hein (particule du Sud)");
  // Lecture en synthèse, à la demande, signalée.
  await expect(page.getByTestId("tutor-message").nth(1).getByText("voix de synthèse")).toBeVisible();

  // Dictée : explication avant la permission, transcription modifiable, inputMode voice.
  await page.getByRole("button", { name: "Dicter en vietnamien" }).click();
  await expect(page.getByTestId("mic-permission")).toContainText("Parlo n'enregistre pas ton audio");
  await page.getByRole("button", { name: "Autoriser le micro" }).click();
  const input = page.getByLabel("Ton message");
  await expect(input).toHaveValue("Dạ em ăn rồi");
  expect(await page.evaluate(() => (window as unknown as { __recognitionLang: string }).__recognitionLang)).toBe("vi-VN");
  await input.fill("Dạ, em ăn rồi.");
  await page.getByRole("button", { name: "Envoyer" }).click();

  // Quota épuisé : « Cô Mai se repose », saisie remplacée par une révision.
  await expect(page.getByText("Cô Mai se repose, reviens demain.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Réviser en attendant" })).toBeVisible();
  await expect(page.getByLabel("Ton message")).toHaveCount(0);
  expect(calls.filter((c) => c.path === "/tutor/conversations/conv1/messages")[2]!.body).toEqual({ text: "Dạ, em ăn rồi.", inputMode: "voice" });

  // conversation_turn envoyé à la synchro suivante, sans le texte du message.
  await page.goto("/");
  await expect
    .poll(() => calls.filter((c) => c.path === "/me/events").flatMap((c) => (c.body as { events: { type: string; payload: Record<string, unknown> }[] }).events).filter((e) => e.type === "conversation_turn"), { timeout: 15_000 })
    .toHaveLength(1);
  const turn = calls.filter((c) => c.path === "/me/events").flatMap((c) => (c.body as { events: { type: string; payload: Record<string, unknown> }[] }).events).find((e) => e.type === "conversation_turn")!;
  expect(Object.keys(turn.payload).sort()).toEqual(["conversationId", "localDate", "mode", "responseMs", "words"]);
  expect(turn.payload).toMatchObject({ conversationId: "conv1", mode: "free", words: 2 });
});

test("Đối đáp : 6 tours chronométrés, score de fluidité ; bilan de la semaine et carte du hub", async ({ page }) => {
  test.setTimeout(120_000);
  const calls: Call[] = [];
  await mockApi(page, calls);
  await onboard(page);
  await toHub(page);
  await signIn(page);
  await page.goto("/jeux");

  await page.locator('[data-game="doi_dap"]').click();
  await page.getByRole("button", { name: "Jouer" }).click();
  const game = page.getByTestId("doi-dap");
  await expect(game).toHaveAttribute("data-phase", "playing");
  await expect(page.getByText("Em tên gì?")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/^(20|19|18) s$/);
  expect(calls.find((c) => c.path === "/tutor/conversations")!.body).toMatchObject({ mode: "doi_dap", locale: "fr" });

  for (let i = 1; i <= 6; i++) {
    await expect(page.getByText(`Tour ${i} sur 6`)).toBeVisible();
    await page.getByLabel("Ton message").fill(`Dạ, em trả lời ${i}`);
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByText(`Dạ, câu ${i} nghen.`)).toBeVisible();
    await expect(game).toHaveAttribute("data-turn", String(i));
  }
  await expect(page.getByLabel("Ton message")).toHaveCount(0);
  const sent = calls.filter((c) => c.path === "/tutor/conversations/dd1/messages").map((c) => c.body as { responseMs: number; inputMode: string });
  expect(sent).toHaveLength(6);
  for (const b of sent) {
    expect(b.inputMode).toBe("text");
    expect(b.responseMs).toBeGreaterThanOrEqual(0);
    expect(b.responseMs).toBeLessThan(60_000);
  }

  await page.getByRole("button", { name: "Voir mon score" }).click();
  await expect(page.getByTestId("doi-dap-fluency")).toHaveText("72 / 100");
  await expect(page.getByText("Score de fluidité", { exact: true })).toBeVisible();
  await expect(page.getByText("Tu réponds vite, bravo.")).toBeVisible();
  await page.getByRole("button", { name: "Retour aux jeux" }).click();
  await expect(page.getByRole("heading", { name: "Jeux" })).toBeVisible();

  // Bilan de la semaine, puis la carte du hub (bilan disponible).
  await page.goto("/bilan-semaine");
  const debrief = page.getByTestId("weekly-debrief");
  await expect(debrief.getByRole("heading", { name: "Ce qui progresse" })).toBeVisible();
  await expect(debrief.getByText("Les tons hỏi et ngã se confondent encore.")).toBeVisible();
  await expect(debrief.getByText("Deux petites conversations avec moi.")).toBeVisible();
  await page.goto("/");
  await page.getByTestId("hub-debrief").click();
  await expect(page).toHaveURL(/\/bilan-semaine$/);
});
