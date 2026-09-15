import { expect, test, type Page, type Route } from "@playwright/test";
import { onboard } from "./helpers.ts";
import { declareAllMedia } from "./media.ts";

/**
 * Phase 3 — social (spec §5.2, §5.3, §5.6.6) : ligue (classement simulé, garde-fou
 * « désactivable »), défi entre amis (invitation → compte → retour → rejoindre),
 * défi express 60 s en mouvement réduit + page publique de partage, Nhớ mặt.
 * API simulée par page.route (docs/contracts/phase3.md §2–3).
 */
test.use({ reducedMotion: "reduce" });

const ACCOUNT = { email: "lan@parlo.app", displayName: "Lan Nguyễn", locale: "fr", linkedAt: new Date().toISOString() };

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function standings() {
  const names = ["Minh", "Thảo", "Hùng", "Vy", "Khoa", "Ngọc", "Lan Nguyễn", "Phúc", "Trâm", "Bảo"];
  return Array.from({ length: 30 }, (_, i) => ({
    rank: i + 1,
    displayName: i === 6 ? "Lan Nguyễn" : `${names[i % names.length]} ${i + 1}`,
    xp: 900 - i * 25,
    isMe: i === 6,
  }));
}

/** API simulée ; `signedIn` : accepte le rafraîchissement (cookie) dès le départ. */
async function mockApi(page: Page, options: { signedIn: boolean }) {
  const calls: Call[] = [];
  let signedIn = options.signedIn;
  const friends: { id: string; inviteCode: string; endsAt: string; participants: { displayName: string; xp: number; isMe: boolean }[] }[] = [];
  const endsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

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
    calls.push({ method, path, body });
    const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });

    if (path === "/auth/refresh") return signedIn ? reply(200, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 }) : reply(401, { detail: "no" });
    if (path === "/auth/register") {
      signedIn = true;
      return reply(201, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 });
    }
    if (path === "/share/express/sh-42") return reply(200, { displayName: "Lan Nguyễn", game: "cho_noi", score: 137, createdAt: new Date().toISOString() });
    if (request.headers().authorization !== "Bearer e2e-token") return reply(401, { detail: "unauthorized" });

    if (path === "/me/events") {
      const { events } = body as { events: { id: string }[] };
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    if (path === "/me/profile" && method === "PATCH") return reply(200, {});
    if (path === "/leagues/me") {
      return reply(200, {
        enabled: true, division: 2, divisionName: { fr: "Rạch", en: "Rạch" },
        weekStart: new Date(Date.now() - 2 * 86_400_000).toISOString(), weekEnd: new Date(Date.now() + 3 * 86_400_000 + 5 * 3_600_000).toISOString(),
        standings: standings(), promoteTop: 5, relegateBottom: 5,
      });
    }
    if (path === "/challenges/friends" && method === "POST") {
      const created = { id: "fc-new", inviteCode: "NEW7D", inviteUrl: "https://parlo.app/defi/NEW7D", endsAt };
      friends.push({ id: created.id, inviteCode: created.inviteCode, endsAt, participants: [{ displayName: "Lan Nguyễn", xp: 0, isMe: true }] });
      return reply(201, created);
    }
    if (path === "/challenges/friends" && method === "GET") return reply(200, friends);
    if (path === "/challenges/friends/join/MAI2026") {
      const participants = [{ displayName: "Cô Hoa", xp: 120, isMe: false }, { displayName: "Lan Nguyễn", xp: 0, isMe: true }];
      friends.push({ id: "fc-1", inviteCode: "MAI2026", endsAt, participants });
      return reply(200, { id: "fc-1", participants, endsAt });
    }
    if (path === "/challenges/express/scores") return reply(200, { best: 150, rankToday: 3, id: "sh-42" });
    return reply(404, { detail: "not found" });
  });
  return calls;
}

async function idbWrite(page: Page, rows: { key: string; value: unknown }[]) {
  await page.evaluate(async (kv) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(["kv", "snapshot"], "readwrite");
      for (const row of kv) tx.objectStore("kv").put(row);
      // Séance en cours oubliée (clé historique « current », puis clé par pack).
      tx.objectStore("snapshot").delete("current");
      tx.objectStore("snapshot").delete("vi-south");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  }, rows);
}

async function outboxGames(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("outbox", "readonly").objectStore("outbox").getAll();
          req.onsuccess = () => {
            const rows = req.result as { event: { type: string; payload: { game?: string } } }[];
            resolve(rows.filter((r) => r.event.type === "game_played").map((r) => r.event.payload.game ?? ""));
            open.result.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

test("ligue : classement simulé, rang sur le hub, désactivable (famille : désactivée par défaut)", async ({ page }) => {
  test.setTimeout(150_000);
  const calls = await mockApi(page, { signedIn: true });
  await onboard(page); // motivation « famille » (premier choix)
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByTestId("tutor-greeting")).toBeVisible();
  await idbWrite(page, [{ key: "account", value: ACCOUNT }]);
  await page.goto("/");
  await expect(page.getByTestId("tutor-greeting")).toBeVisible();
  // Garde-fou : famille → ligue désactivée, aucun rang, aucun appel.
  await expect(page.getByTestId("league-hub-line")).toHaveCount(0);

  await page.goto("/reglages");
  const toggle = page.getByRole("switch", { name: "Participer à la ligue hebdomadaire" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/Désactivée par défaut si tu apprends pour la famille/)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => calls.find((c) => c.path === "/me/profile" && c.method === "PATCH")?.body).toEqual({ leaguesEnabled: true });

  await page.goto("/");
  const line = page.getByTestId("league-hub-line");
  await expect(line).toHaveText("Tu es 7e en division Rạch");
  await line.click();

  await expect(page).toHaveURL(/\/ligue$/);
  const league = page.getByTestId("league");
  await expect(league).toHaveAttribute("data-state", "league");
  await expect(page.getByRole("heading", { name: "Rạch" })).toBeVisible();
  await expect(page.getByText("Division 2 sur 5")).toBeVisible();
  await expect(page.getByTestId("league-countdown")).toHaveText(/^Nouvelle semaine dans 3 j \d+ h$/);
  const rows = page.getByTestId("league-row");
  await expect(rows).toHaveCount(30);
  await expect(page.locator('[data-testid="league-row"][data-me="true"]')).toContainText("Lan Nguyễn");
  await expect(page.locator('[data-testid="league-row"][aria-current="true"]')).toHaveCount(1);
  await expect(page.locator('[data-zone="promote"]')).toHaveCount(5);
  await expect(page.locator('[data-zone="relegate"]')).toHaveCount(5);
  await expect(rows.first()).toContainText("1er");

  // Désactiver depuis les réglages : la ligne du hub disparaît.
  await page.goto("/reglages");
  await page.getByRole("switch", { name: "Participer à la ligue hebdomadaire" }).click();
  await expect(page.getByRole("switch", { name: "Participer à la ligue hebdomadaire" })).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => calls.filter((c) => c.path === "/me/profile" && c.method === "PATCH").at(-1)?.body).toEqual({ leaguesEnabled: false });
  await page.goto("/");
  await expect(page.getByTestId("tutor-greeting")).toBeVisible();
  await expect(page.getByRole("link", { name: "Défis entre amis · défi express" })).toBeVisible();
  await expect(page.getByTestId("league-hub-line")).toHaveCount(0);
  await page.goto("/ligue");
  await expect(page.getByTestId("league")).toHaveAttribute("data-state", "disabled");
});

test("défi entre amis : invitation en invité → création de compte → retour → rejoint ; puis créer et partager", async ({ page, context }) => {
  test.setTimeout(120_000);
  const calls = await mockApi(page, { signedIn: false });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/defi/MAI2026");
  const join = page.getByTestId("join-challenge");
  await expect(join.getByText(/Crée un compte pour rejoindre le défi/)).toBeVisible();
  await page.getByRole("link", { name: "Créer un compte et rejoindre" }).click();
  await expect(page).toHaveURL(/\/compte\?next=%2Fdefi%2FMAI2026$/);

  await page.getByLabel("Prénom ou pseudo").fill("Lan Nguyễn");
  await page.getByLabel("Email").fill("lan@parlo.app");
  await page.getByLabel("Mot de passe").fill("motdepasse-solide");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(page).toHaveURL(/\/defi\/MAI2026$/);
  await expect(page.getByTestId("join-challenge")).toHaveAttribute("data-state", "joined");
  await expect(page.getByText("C'est parti : tu participes au défi.")).toBeVisible();
  await expect(page.getByText("Cô Hoa")).toBeVisible();
  await expect(page.locator('[data-me="true"]')).toContainText("Lan Nguyễn");
  expect(calls.filter((c) => c.path === "/challenges/friends/join/MAI2026")).toHaveLength(1);

  await page.getByRole("link", { name: "Voir mes défis" }).click();
  await expect(page).toHaveURL(/\/defis$/);
  await expect(page.getByTestId("friend-challenge")).toHaveCount(1);
  await page.getByRole("button", { name: "Lancer un défi de 7 jours" }).click();
  await expect(page.getByTestId("invite-link")).toHaveText("https://parlo.app/defi/NEW7D");
  expect(calls.find((c) => c.path === "/challenges/friends" && c.method === "POST")?.body).toEqual({ kind: "xp_7d" });
  await page.getByRole("button", { name: "Copier le lien" }).click();
  await expect(page.getByText("Lien copié")).toBeVisible();
  await expect(page.getByTestId("friend-challenge")).toHaveCount(2);
});

// Chợ nổi (pack tonal) exige l'audio natif : index des médias complété, service worker bloqué pour l'interception.
test.describe(() => {
  test.use({ serviceWorkers: "block" });
  test("défi express : 60 s de Chợ nổi (mouvement réduit), score envoyé, rang du jour, image et page de partage", async ({ page }) => {
    test.setTimeout(200_000);
    const calls = await mockApi(page, { signedIn: true });
    await declareAllMedia(page);
    await page.addInitScript(() => {
      // Partage natif indisponible : l'image se télécharge (testable).
      Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    });
    await page.goto("/bienvenue");
    await idbWrite(page, [{ key: "account", value: ACCOUNT }]);

    await page.goto("/defis");
    await page.getByRole("link", { name: "Jouer le défi express" }).click();
    await expect(page).toHaveURL(/\/express$/);
    await expect(page.getByText("Score = réponses justes × 10 + bonus de vitesse. Rejouable autant que tu veux.")).toBeVisible();
    await page.getByRole("button", { name: "Jouer", exact: true }).click();

    const timer = page.getByRole("timer");
    await expect(timer).toHaveText(/^[01]:\d\d$/);
    // Quelques barques touchées vite, puis le temps de jeu s'écoule jusqu'à la fermeture du marché.
    for (let i = 0; i < 4; i++) {
      const game = page.locator('[data-testid="cho-noi"][data-round]');
      await expect(game).toHaveAttribute("data-phase", "boats");
      const round = await game.getAttribute("data-round");
      await page.getByRole("button", { name: /^Barque : / }).first().click();
      await expect(game).not.toHaveAttribute("data-round", round ?? "", { timeout: 5_000 });
    }
    await expect(page.getByRole("heading", { name: "Le marché ferme" })).toBeVisible({ timeout: 150_000 });

    await expect(page.getByText("Meilleur score : 150 points")).toBeVisible();
    await expect(page.getByText("3e aujourd'hui")).toBeVisible();
    const post = calls.find((c) => c.path === "/challenges/express/scores");
    const body = post?.body as { game: string; score: number; correct: number; total: number; localDate: string };
    expect(body.game).toBe("cho_noi");
    expect(body.total).toBeGreaterThanOrEqual(4);
    expect(body.score).toBeGreaterThanOrEqual(body.correct * 10);
    expect(body.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect.poll(async () => (await outboxGames(page)).filter((g) => g === "cho_noi").length).toBe(1);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Partager mon score" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("parlo-defi-express.png");

    await page.getByRole("link", { name: "Voir la page de partage" }).click();
    await expect(page).toHaveURL(/\/partage\/sh-42$/);
    await expect(page.getByTestId("share")).toHaveAttribute("data-state", "ok");
    await expect(page.getByText("137 points")).toBeVisible();
    await expect(page.getByText("Lan Nguyễn au Chợ nổi")).toBeVisible();
    await expect(page.getByRole("link", { name: "Essayer Parlo" })).toBeVisible();
  });
});

test("Nhớ mặt : grille 4×4, cartes ≥ 44 px, paires image ↔ son jusqu'au résultat, game_played", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/jeux");
  await page.getByRole("link", { name: /Nhớ mặt/ }).click();
  await expect(page).toHaveURL(/\/jeux\/nho_mat$/);
  await page.getByRole("button", { name: "Jouer", exact: true }).click();

  const game = page.locator('[data-testid="nho-mat"][data-moves]');
  await expect(game).toHaveAttribute("data-mode", "audio");
  const cards = page.locator("[data-card]");
  await expect(cards).toHaveCount(16);
  const box = await cards.first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  const result = page.getByRole("heading", { name: "Tous les visages retrouvés" });
  const known = new Map<number, string>();
  const flip = async (i: number) => {
    const card = page.locator(`[data-card="${i}"]`);
    await card.click();
    await expect(card).toHaveAttribute("data-concept", /.+/);
    const concept = (await card.getAttribute("data-concept"))!;
    known.set(i, concept);
    return concept;
  };
  const hidden = async () =>
    page.evaluate(() => [...document.querySelectorAll('[data-card][data-up="false"]')].map((el) => Number(el.getAttribute("data-card"))));

  let guesses = 0;
  for (let guard = 0; guard < 40 && !(await result.isVisible()); guard++) {
    await expect(game.or(result)).toBeVisible();
    if (await result.isVisible()) break;
    await expect(game).toHaveAttribute("data-open", "0");
    const down = await hidden();
    if (down.length === 0) break;
    const moves = Number(await game.getAttribute("data-moves"));
    // Paire déjà connue parmi les cartes cachées ?
    const pair = down.flatMap((a) => down.filter((b) => b > a && known.get(a) && known.get(a) === known.get(b)).map((b) => [a, b] as const))[0];
    if (pair) {
      await flip(pair[0]);
      await flip(pair[1]);
    } else {
      const first = down.find((i) => !known.has(i)) ?? down[0]!;
      const concept = await flip(first);
      const partner = down.find((i) => i !== first && known.get(i) === concept);
      const second = partner ?? down.find((i) => i !== first && !known.has(i)) ?? down.find((i) => i !== first)!;
      await flip(second);
      if (partner === undefined) guesses++;
    }
    await expect.poll(async () => (await result.isVisible()) || Number(await game.getAttribute("data-moves")) > moves).toBe(true);
  }

  await expect(result).toBeVisible();
  expect(guesses).toBeGreaterThan(0);
  await expect(page.getByText(/^\d sur 8$/)).toBeVisible();
  await expect(page.getByText(/^En \d+ coups$/)).toBeVisible();
  await expect(page.getByText("Nouveau record")).toBeVisible();
  await expect.poll(async () => (await outboxGames(page)).filter((g) => g === "nho_mat").length).toBe(1);
  await page.getByRole("button", { name: "Retour aux jeux" }).click();
  await expect(page.locator('[data-game="nho_mat"]')).toContainText(/Record : \d+ points · \d sur 8/);
});
