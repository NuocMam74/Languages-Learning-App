import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { dismissCelebrations, onboard, playUntil, skipBriefing } from "./helpers.ts";

/**
 * Contrat phase7-accueil : l'app n'est plus « une langue », c'est un compte qui apprend des langues.
 *
 * Couvre : l'accueil de première ouverture (une invitation, pas un tableau vide), la carte
 * « Reprendre » avec la bonne prochaine leçon et les bons compteurs, le changement de langue depuis
 * l'accueil qui atterrit sur `/apprendre` avec les données de cette langue, le profil (niveau,
 * compétences, badges, acquis) qui se met à jour après une leçon, la navigation basse masquée
 * pendant une séance, et l'invité face au compte connecté (`/me`, `/me/state` simulés).
 */

const CONTENT = join(import.meta.dirname, "..", "..", "..", "content");
const readJson = <T>(...parts: string[]) => JSON.parse(readFileSync(join(CONTENT, ...parts), "utf8")) as T;
const viName = readJson<{ name: { fr: string } }>("vi-south", "pack.json").name.fr;
const esName = readJson<{ name: { fr: string } }>("es", "pack.json").name.fr;
const firstLesson = readJson<{ title: { fr: string } }>("vi-south", "lessons", "u01", "l01.json").title.fr;

const TOKEN = "e2e-token";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** API simulée : `/me` et `/me/state` d'un compte inscrit ; tout le reste répond 404. */
async function mockSignedIn(page: Page, extra: (path: string, method: string, route: Route) => Promise<void> | "next" = () => "next") {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    const custom = extra(path, method, route);
    if (custom !== "next") return custom;
    if (path === "/auth/refresh") return reply(200, { accessToken: TOKEN, tokenType: "bearer", expiresIn: 900 });
    if (route.request().headers().authorization !== `Bearer ${TOKEN}`) return reply(401, { detail: "unauthorized" });
    if (path === "/me") {
      return reply(200, {
        user: { id: "u1", email: "lan@parlo.app", displayName: "Lan", locale: "fr", createdAt: new Date().toISOString(), isGuest: false, emailVerified: true },
        profile: { motivation: "family", dailyGoalMin: 10, reminderHour: null, levelEstimate: null, pathVariant: null },
        enrollment: { courseCode: "vi-south", xpTotal: 350, level: 3, currentLessonId: null },
        enrollments: [{ courseCode: "vi-south", xpTotal: 350, level: 3, currentLessonId: null }],
        streak: { current: 3, longest: 5, lastActiveDate: today(), freezesAvailable: 1, frozenUntil: null },
        badges: [{ code: "first_lesson", earnedAt: new Date().toISOString() }],
        roles: ["learner"],
        level: { value: 3, name: null, xpIntoLevel: 100, xpForNext: 200 },
      });
    }
    if (path === "/me/state") {
      const at = new Date().toISOString();
      return reply(200, {
        profile: { motivation: "family", dailyGoalMin: 10, reminderHour: null, onboardedAt: at },
        placement: null,
        lessonProgress: ["l01", "l02", "l03"].map((l) => ({ lessonId: `vi-south.u01.${l}`, bestScore: 1, attempts: 1, completedAt: at })),
        srsCards: [],
        badges: [{ code: "first_lesson", earnedAt: at }],
        streak: { current: 3, longest: 5, lastActiveDate: today(), freezesAvailable: 1, frozenUntil: null },
        xpTotal: 350,
        level: { value: 3, name: null, xpIntoLevel: 100, xpForNext: 200 },
        enrolled: true,
      });
    }
    if (path === "/me/events") {
      const { events } = (route.request().postDataJSON() ?? { events: [] }) as { events: { id: string }[] };
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    return reply(404, { detail: "not found" });
  });
}

/** Aucune API : mode invité franc (le hors-ligne de l'accueil doit marcher sans serveur). */
const mockGuest = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "unauthorized" }) }));

/** CLS cumulé (Chromium seulement ; WebKit n'a pas de `layout-shift`). */
async function clsOf(page: Page, path: string, waitMs = 3500): Promise<number | null> {
  if (page.context().browser()?.browserType().name() !== "chromium") return null;
  await page.goto(path);
  await page.waitForTimeout(waitMs);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (entry.hadRecentInput) continue;
          w.__cls += entry.value;
          const sources = ((entry as unknown as { sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }).sources ?? []).map((src) => {
            const el = src.node as HTMLElement | undefined;
            const name = el ? `${el.nodeName.toLowerCase()}${el.dataset?.testid ? `#${el.dataset.testid}` : ""}.${String(el.className ?? "").slice(0, 40)}` : "?";
            return `${name} ${Math.round(src.previousRect.y)}→${Math.round(src.currentRect.y)}`;
          });
          w.__shifts.push(`${entry.value.toFixed(3)} @${Math.round(entry.startTime)} ${sources.join(" ; ")}`);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // WebKit : pas de layout-shift.
    }
  });
});

test("première ouverture : l'accueil invite à commencer, il ne montre pas un tableau vide", async ({ page }) => {
  test.setTimeout(240_000);
  await mockGuest(page);
  await onboard(page);
  // On quitte la première leçon sans la faire : rien n'a encore été appris.
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);

  await page.goto("/");
  await expect(page.getByTestId("dashboard-first")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ton compte, tes langues" })).toBeVisible();
  // Un seul bouton plein : l'appel à commencer (contrat §5).
  await expect(page.getByTestId("dashboard-first-cta")).toBeVisible();
  await expect(page.getByTestId("dashboard-resume")).toHaveCount(0);
  // Invité : la promesse « rien n'est perdu », pas un mur d'inscription.
  await expect(page.getByText("Crée un compte quand tu veux : rien n'est perdu d'ici là.")).toBeVisible();
  // Une seule langue installée : la carte est là, pas un vide.
  await expect(page.getByTestId("dashboard-language")).toHaveCount(1);
  await expect(page.getByTestId("dashboard-language")).toContainText(viName);
  await expect(page.getByTestId("dashboard-language")).toContainText("Pas encore commencée");
  await expect(page.getByTestId("dashboard-add-language")).toBeVisible();

  // La navigation basse est là et désigne l'accueil.
  const nav = page.getByTestId("bottom-nav");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
  // Cinq entrées : les quatre du contrat phase8 §4 — les jeux restent dans « Apprendre » — plus
  // les chiffres (contrat phase23 §1). La contrainte de 44 px vaut pour toutes, c'est elle qui
  // justifiait de s'en tenir à quatre : on vérifie donc qu'une cinquième ne l'a pas cassée.
  for (const name of ["Accueil", "Apprendre", "Réviser", "Chiffres", "Profil"]) {
    const box = await nav.getByRole("link", { name }).boundingBox();
    expect(box?.height ?? 0, `cible « ${name} » ≥ 44 px`).toBeGreaterThanOrEqual(44);
  }
  await expect(nav.getByRole("link")).toHaveCount(5);
});

test("progression : reprise, compteurs, profil mis à jour, navigation basse masquée en séance", async ({ page }) => {
  test.setTimeout(420_000);
  await mockGuest(page);
  await onboard(page);

  // Navigation basse masquée pendant la séance (contrat §1). La leçon s'ouvre d'abord sur sa
  // préparation (contrat phase10 §1) : on la traverse pour atteindre l'écran d'exercice.
  await skipBriefing(page);
  await expect(page.locator('[data-testid="lesson"]')).toBeVisible();
  await expect(page.getByTestId("bottom-nav")).toHaveCount(0);

  await playUntil(page, /^Leçon terminée$/);
  await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
  // Une leçon terminée déclenche ses récompenses : leurs cartes couvrent l'écran et
  // interceptent tout clic tant qu'on ne les a pas refermées.
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);
  await expect(page.getByTestId("bottom-nav")).toBeVisible();

  // 2. Reprendre : la langue travaillée en dernier, sa prochaine leçon, son unité.
  await page.goto("/");
  const resume = page.getByTestId("dashboard-resume");
  await expect(resume).toBeVisible();
  await expect(resume).toHaveAttribute("data-pack", "vi-south");
  await expect(page.getByTestId("dashboard-resume-pack")).toHaveText(viName);
  const next = page.getByTestId("dashboard-next-lesson");
  await expect(next).toBeVisible();
  await expect(next).not.toContainText(firstLesson); // la première leçon est faite : on propose la suivante
  await expect(page.getByTestId("dashboard-resume-cta")).toContainText("Séance du jour");
  // La carte de la langue porte les vrais compteurs.
  const card = page.getByTestId("dashboard-language").first();
  await expect(card).toContainText(/\d+ \/ \d+ leçons/);
  await expect(card).toContainText(/[1-9]\d* XP/);
  await expect(page.getByTestId("dashboard-totals")).toContainText(/[1-9]\d* XP/);

  // 4. Profil : niveau, compétences, acquis, badges — tous alimentés par la leçon jouée.
  await page.getByTestId("dashboard-avatar").click();
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByRole("heading", { name: "Profil" })).toBeVisible();
  await expect(page.getByTestId("profile-level")).toBeVisible();
  const skills = page.getByTestId("profile-skill");
  await expect(skills).toHaveCount(4);
  // Au moins une compétence a été travaillée (la leçon 1 est de l'écoute et du vocabulaire).
  expect(await skills.filter({ hasNot: page.locator('[data-level="none"]') }).count()).toBeGreaterThan(0);
  await expect(page.getByTestId("acquired-lessons")).toContainText("1");
  // Badges : obtenus et à obtenir, avec leur condition.
  const badges = page.getByTestId("profile-badges").locator("li");
  expect(await badges.count()).toBeGreaterThan(1);
  await expect(page.getByTestId("profile-badges").locator('li[data-code="first_lesson"]')).toHaveAttribute("data-earned", "true");
  await expect(page.getByTestId("profile-badges").locator('li[data-earned="false"]').first()).toBeVisible();
  // Invité : tout marche, avec la ligne discrète « crée un compte ».
  await expect(page.getByTestId("profile-account-cta")).toBeVisible();
  await expect(page.getByText("Invité · progression sur cet appareil")).toBeVisible();

  // Nom affiché modifiable hors ligne.
  await page.getByTestId("profile-name-edit").click();
  await page.getByLabel("Nom affiché").fill("Mai Anh");
  await page.getByTestId("profile-name-save").click();
  await expect(page.getByTestId("profile-name")).toHaveText("Mai Anh");
  await expect(page.getByTestId("profile-avatar")).toHaveText("MA");
  await page.goto("/");
  await expect(page.getByTestId("dashboard-header")).toContainText("Mai Anh");
  // Sur l'accueil, le personnage remplace les initiales dès qu'il porte quelque chose (contrat
  // phase9 §4) — et il porte la tenue par défaut d'emblée. On vérifie donc le médaillon lui-même :
  // présent, nommé, et menant au profil. Le nom, lui, est vérifié juste au-dessus.
  const medallion = page.getByTestId("dashboard-avatar");
  await expect(medallion).toBeVisible();
  await expect(medallion.locator("svg").first()).toBeVisible();
  await expect(medallion).toHaveAttribute("href", "/profil");
});

test("changer de langue depuis l'accueil : /apprendre avec les données de cette langue", async ({ page }) => {
  test.setTimeout(300_000);
  await mockGuest(page);
  await onboard(page);
  await playUntil(page, /^Leçon terminée$/);
  // Une leçon terminée déclenche ses récompenses : leurs cartes couvrent l'écran et
  // interceptent tout clic tant qu'on ne les a pas refermées.
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page.getByTestId("hub-pack")).toHaveText(viName);
  const viXp = (await page.getByText(/^\d+ XP$/).textContent()) ?? "";
  expect(viXp).not.toBe("0 XP");

  // Le pack `es` est en préparation : visible seulement en aperçu explicite (contrat phase5 §5).
  await page.goto("/?packs=preview");
  const es = page.getByTestId("dashboard-language").filter({ hasText: esName });
  await expect(es).toBeVisible();
  await expect(es).toContainText("Pas encore commencée");
  await es.click();

  // `pack_switched` puis le parcours de la nouvelle langue : sa progression, pas celle du vietnamien.
  // Une langue jamais commencée passe d'abord par son propre onboarding.
  await expect(page).toHaveURL(/\/(apprendre|onboarding)$/);
  if (new URL(page.url()).pathname === "/onboarding") {
    for (let i = 0; i < 5; i++) await page.locator("main button").first().click();
    // Depuis le contrat phase23 §3, l'onboarding ne débouche plus sur une leçon : le pack `es`
    // n'a pas de test de niveau, donc on arrive sur la visite guidée, qu'on passe.
    await expect(page).toHaveURL(/\/decouverte$/);
    await page.getByTestId("discovery-skip").click();
  }
  await expect(page).toHaveURL(/\/apprendre$/);
  await expect(page.getByTestId("hub-pack")).toHaveText(esName);
  await expect(page.getByText("0 XP", { exact: true })).toBeVisible();

  // Lien profond vers une leçon de l'autre langue : confirmation, bascule, puis la leçon (contrat §1).
  // On vise la leçon **déjà terminée** : depuis le contrat phase10 §3, la suivante ne s'ouvre qu'une
  // fois celle-ci réussie, et ce test répond au hasard — le lien y serait ouvert une fois sur deux.
  // Ce qu'on vérifie ici est la bascule de langue, pas le déverrouillage.
  await page.goto("/lecon/vi-south.u01.l01");
  const prompt = page.getByTestId("deeplink-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute("data-pack", "vi-south");
  await expect(prompt).toContainText(viName);
  await page.getByTestId("deeplink-confirm").click();
  await skipBriefing(page);
  await expect(page.locator('[data-testid="lesson"]')).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByTestId("hub-pack")).toHaveText(viName);

  // Retour à l'accueil : chaque langue garde ses chiffres.
  await page.goto("/?packs=preview");
  const cards = page.getByTestId("dashboard-language");
  await expect(cards.filter({ hasText: viName })).toContainText(viXp);
  await expect(cards.filter({ hasText: esName })).not.toContainText(viXp);
});

test("compte connecté : l'accueil et le profil montrent la progression restaurée du serveur", async ({ page }) => {
  test.setTimeout(240_000);
  await mockSignedIn(page, (path, method, route) => {
    if (path === "/auth/login" && method === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accessToken: TOKEN, tokenType: "bearer", expiresIn: 900 }) });
    }
    return "next";
  });

  await page.goto("/connexion");
  await page.getByLabel("Email").fill("lan@parlo.app");
  await page.getByLabel("Mot de passe").fill("mot-de-passe-solide");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Te revoilà" })).toBeVisible();
  // Une leçon terminée déclenche ses récompenses : leurs cartes couvrent l'écran et
  // interceptent tout clic tant qu'on ne les a pas refermées.
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour au parcours" }).click();
  await expect(page).toHaveURL(/\/apprendre$/);

  await page.goto("/");
  // En-tête : niveau global, XP totale, série — et le nom du compte, pas « invité ».
  const totals = page.getByTestId("dashboard-totals");
  await expect(totals).toHaveAttribute("data-level", "3");
  await expect(totals).toContainText("350 XP");
  await expect(totals).toContainText("3 jours de suite");
  await expect(page.getByTestId("dashboard-header")).toContainText("Lan");
  await expect(page.getByTestId("dashboard-avatar").locator("svg").first()).toBeVisible();
  // Trois leçons restaurées : la carte « Reprendre » propose la suite, pas la première leçon.
  await expect(page.getByTestId("dashboard-language").first()).toContainText("3 / ");

  await page.goto("/profil");
  await expect(page.getByTestId("profile-level")).toHaveAttribute("data-level", "3");
  await expect(page.getByText("Connecté · lan@parlo.app")).toBeVisible();
  await expect(page.getByTestId("profile-account-cta")).toHaveCount(0);
  await expect(page.getByTestId("profile-streak")).toContainText("Record : 5 jours");
  await expect(page.getByTestId("profile-streak")).toContainText("1 protection en réserve");
  await expect(page.getByTestId("acquired-lessons")).toContainText("3");
});

test("accueil et profil : pas de saut de mise en page (CLS)", async ({ page }) => {
  test.setTimeout(300_000);
  await mockGuest(page);
  await onboard(page);
  await playUntil(page, /^Leçon terminée$/);
  // Une leçon terminée déclenche ses récompenses : leurs cartes couvrent l'écran et
  // interceptent tout clic tant qu'on ne les a pas refermées.
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour au parcours" }).click();

  for (const path of ["/", "/profil"]) {
    const cls = await clsOf(page, path);
    if (cls === null) continue;
    const shifts = await page.evaluate(() => (window as unknown as { __shifts: string[] }).__shifts);
    console.log(`CLS ${path} = ${cls.toFixed(4)}${shifts.length ? ` (${shifts.join(" | ")})` : ""}`);
    expect(cls, `CLS de ${path}`).toBeLessThan(0.05);
  }
});
