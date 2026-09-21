import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { dismissCelebrations, playOneStep, skipBriefing } from "./helpers.ts";

/**
 * QA mobile (docs/audits/mobile-audit.md). Matrice d'acceptation, définie en projets Playwright :
 *   - iPhone 13 — 390×844, WebKit ;
 *   - Galaxy S25 Ultra — 412×915, Chromium/Edge ;
 *   - grand téléphone 480×1067, Chromium/Edge (contrôle).
 * Les profils vérifiés plus tôt (iPhone SE 375×667, Galaxy 360×740, paysage 844×390, iPad) restent
 * jouables avec PW_WIDE_MATRIX=1 mais ne font plus partie de la matrice d'acceptation.
 *
 * Pour chaque écran clé : pas de défilement horizontal, action principale visible, cibles tactiles
 * ≥ 44 px, texte vietnamien jamais rogné ; feuille de correction qui laisse voir l'option choisie
 * et la bonne réponse ; CLS des Réglages et du hub connecté (Chromium : layout-shift).
 * Le service worker est bloqué : en WebKit, page.route ne voit plus les requêtes sinon.
 */
test.use({ reducedMotion: "reduce", serviceWorkers: "block" });

const ACCOUNT = { email: "lan@parlo.app", displayName: "Lan Nguyễn", locale: "fr", linkedAt: new Date().toISOString(), emailVerified: true };

/**
 * Onboarding sans assertion d'URL : WebKit (iPhone) ne publie pas tout de suite l'URL d'une
 * redirection `replace` du routeur, alors que l'écran est bien affiché.
 */
async function onboardHere(page: Page) {
  await page.goto("/");
  // WebKit émulé : démarrage (contenu + chunks) plus lent que les 5 s par défaut.
  await expect(page.getByRole("button", { name: "Commencer" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(page.getByRole("heading", { name: "Quelle langue veux-tu parler ?" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible({ timeout: 20_000 });
    const choice = i === 3 ? page.getByRole("button", { name: "10 min", exact: true }) : page.locator("main button").first();
    await choice.click();
  }
  // Test de niveau, puis visite guidée (contrat phase23 §3) : on traverse les deux, puis on
  // demande la première leçon — l'application ne l'impose plus.
  const placement = page.getByRole("heading", { name: "Commençons par te situer" });
  const tour = page.getByTestId("discovery-step");
  await expect(placement.or(tour).first()).toBeVisible({ timeout: 30_000 });
  if (await placement.isVisible()) await page.getByRole("button", { name: "Je pars de zéro" }).click();
  await expect(tour).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("discovery-skip").click();
  await page.goto("/lecon/vi-south.u01.l01");
  await skipBriefing(page);
  await expect(page.locator('[data-testid="lesson"]')).toBeVisible({ timeout: 30_000 });
}

function note(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description });
  console.log(`[${testInfo.project.name}] ${type}: ${description}`);
}

async function expectNoHorizontalOverflow(page: Page, where: string) {
  const width = page.viewportSize()!.width;
  const result = await page.evaluate((vw) => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    if (doc.scrollWidth > vw + 1) {
      for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1) continue;
        // Tableaux et zones à défilement propre (overflow-x: auto) : autorisés.
        let scrolled = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") scrolled = true;
        }
        if (!scrolled) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(r.right)}`);
      }
    }
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, offenders: offenders.slice(0, 5) };
  }, width);
  expect(result.scrollWidth, `${where}: scrollWidth ${result.scrollWidth} > ${width} (${result.offenders.join(" | ")})`).toBeLessThanOrEqual(width + 1);
  expect(result.innerWidth, `${where}: layout viewport élargi`).toBeLessThanOrEqual(width + 1);
}

async function expectInViewport(page: Page, locator: ReturnType<Page["locator"]>, where: string) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, `${where}: action absente`).not.toBeNull();
  expect(box!.y, `${where}: action au-dessus de l'écran`).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height, `${where}: action sous la ligne de flottaison`).toBeLessThanOrEqual(vp.height + 1);
}

/** Cibles tactiles < 44×44 dans le contenu (mots glosés en ligne : 44 de haut, 24 de large, WCAG 2.5.8). */
async function expectTouchTargets(page: Page, where: string) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const selector = 'a[href], button, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], input:not([type="hidden"]), select, textarea, summary';
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.position === "absolute" && cs.clip !== "auto") continue;
      if (el.closest(".sr-only") || (cs.width === "1px" && cs.height === "1px")) continue;
      let w = r.width;
      let h = r.height;
      const before = getComputedStyle(el, "::before");
      const inset = parseFloat(before.top);
      if (before.content !== "none" && before.position === "absolute" && inset < 0) {
        w -= 2 * inset;
        h -= 2 * inset;
      }
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        const label = el.closest("label");
        if (label) {
          const lr = label.getBoundingClientRect();
          w = lr.width;
          h = lr.height;
        }
      }
      const minW = el.hasAttribute("data-gloss-word") ? 24 : 44;
      if (w + 0.5 < minW || h + 0.5 < 44) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}" ${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  });
  expect(small, `${where}: cibles tactiles < 44 px`).toEqual([]);
}

/** Texte vietnamien rogné par un ancêtre overflow:hidden, ou interligne trop serré pour les diacritiques. */
async function expectVietnameseNotClipped(page: Page, where: string) {
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[lang="vi"], [data-target-text]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const lh = cs.lineHeight === "normal" ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
      if (lh < parseFloat(cs.fontSize) * 1.14) out.push(`${el.textContent?.slice(0, 20)} interligne ${lh}`);
      if (el.scrollWidth > el.clientWidth + 1 && (cs.overflowX === "hidden" || cs.textOverflow === "ellipsis")) out.push(`${el.textContent?.slice(0, 20)} coupé`);
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflow === "visible") continue;
        if (ps.overflowX === "auto" || ps.overflowY === "auto" || ps.overflowY === "scroll") break;
        const pr = p.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) out.push(`${el.textContent?.slice(0, 20)} rogné par ${p.tagName}`);
        break;
      }
    }
    return out;
  });
  expect(clipped, `${where}: vietnamien rogné`).toEqual([]);
}

/** Navigation tolérante : l'app peut relancer une navigation (restauration de compte) juste après. */
async function goTo(page: Page, path: string) {
  try {
    await page.goto(path);
  } catch {
    await page.waitForTimeout(500);
    await page.goto(path);
  }
}

async function checkScreen(page: Page, where: string, primary?: ReturnType<Page["locator"]>) {
  await page.waitForTimeout(300);
  await expectNoHorizontalOverflow(page, where);
  await expectTouchTargets(page, where);
  await expectVietnameseNotClipped(page, where);
  if (primary) await expectInViewport(page, primary, where);
}

/** Bonne réponse de l'exercice affiché, lue dans les props React (fibre de ChoiceView). */
async function answerId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const radio = document.querySelector('[role="radio"]');
    if (!radio) return null;
    const key = Object.keys(radio).find((k) => k.startsWith("__reactFiber$"));
    let fiber = key ? (radio as unknown as Record<string, { return: unknown; memoizedProps: unknown }>)[key] : undefined;
    while (fiber) {
      const props = fiber.memoizedProps as { exercise?: { answerId?: string } } | null;
      if (props?.exercise?.answerId) return props.exercise.answerId;
      fiber = fiber.return as typeof fiber;
    }
    return null;
  });
}

async function mockApi(page: Page) {
  const now = Date.now();
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    if (path === "/auth/refresh") return reply(200, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 });
    if (path === "/me/events") {
      const { events } = request.postDataJSON() as { events: { id: string }[] };
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    if (path === "/me") {
      return reply(200, {
        user: { id: "u1", email: ACCOUNT.email, displayName: ACCOUNT.displayName, locale: "fr", createdAt: new Date(now).toISOString(), isGuest: false, emailVerified: true },
        profile: { motivation: "travel", dailyGoalMin: 5, reminderHour: null, levelEstimate: null, pathVariant: null, leaguesEnabled: true },
        enrollment: { courseCode: "vi-south", xpTotal: 100, level: 1, currentLessonId: null },
        streak: { current: 1, longest: 1, lastActiveDate: null, freezesAvailable: 0, frozenUntil: null },
        roles: ["learner"],
      });
    }
    if (path === "/me/profile") return reply(200, {});
    if (path === "/tutor/greeting") return reply(200, { text: "Chào em! Hôm nay mình học tiếp nhé, cô chờ em ở bến sông.", cached: true, source: "fallback" });
    if (path === "/tutor/status") return reply(200, { available: true });
    if (path === "/leagues/me") {
      const standings = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, displayName: i === 6 ? ACCOUNT.displayName : `Thảo Nguyễn ${i + 1}`, xp: 900 - i * 25, isMe: i === 6 }));
      return reply(200, {
        enabled: true, division: 2, divisionName: { fr: "Rạch", en: "Rạch" },
        weekStart: new Date(now - 2 * 86_400_000).toISOString(), weekEnd: new Date(now + 3 * 86_400_000).toISOString(),
        standings, promoteTop: 5, relegateBottom: 5,
      });
    }
    if (path === "/challenges/current") {
      return reply(200, [{
        id: "ch1", kind: "lessons", title: { fr: "5 leçons cette semaine" }, target: 5, unit: null, progress: 2,
        completedAt: null, claimedAt: null, periodStart: new Date(now - 86_400_000).toISOString(), periodEnd: new Date(now + 6 * 86_400_000).toISOString(), badgeCode: "challenge_lessons",
      }]);
    }
    if (path === "/challenges/friends") return reply(200, []);
    if (path === "/tutor/conversations" && request.method() === "POST") {
      const mode = (request.postDataJSON() as { mode?: string }).mode;
      return reply(201, { conversationId: mode === "doi_dap" ? "dd1" : "c1", opening: { text: "Chào em! Hôm nay em khỏe không? Em tên gì?", glosses: [{ key: "khỏe", gloss: { fr: "en forme", en: "well" } }] } });
    }
    if (path === "/tutor/conversations/c1" || path === "/tutor/conversations/dd1") {
      return reply(200, { conversationId: path.endsWith("dd1") ? "dd1" : "c1", turns: [{ role: "tutor", text: "Chào em! Hôm nay em khỏe không? Em tên gì?", glosses: [] }], endedAt: null });
    }
    if (path === "/me/classes") return reply(200, []);
    if (path === "/exams") return reply(200, []);
    return reply(404, { detail: "not found" });
  });
}

async function signIn(page: Page) {
  await page.evaluate(async (account) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(["kv", "snapshot"], "readwrite");
      tx.objectStore("kv").put({ key: "account", value: account });
      tx.objectStore("snapshot").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  }, ACCOUNT);
}

/** CLS cumulé (Chromium) sur une navigation, CPU ralenti 4×. null en WebKit (pas de layout-shift). */
async function measureCls(page: Page, path: string, waitMs = 3500): Promise<number | null> {
  if (test.info().project.use.defaultBrowserType === "webkit" || page.context().browser()?.browserType().name() !== "chromium") return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await goTo(page, path);
  const layout = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((el) => el.children.length === 0 || el.hasAttribute("data-slot"))
        .map((el) => `${Math.round(el.getBoundingClientRect().height)}:${(el.textContent ?? "").slice(0, 24)}`)
        .filter((s) => !s.startsWith("0:")),
    );
  await page.waitForTimeout(700);
  const early = await layout().catch(() => [] as string[]);
  await page.waitForTimeout(waitMs - 700);
  if (process.env.PW_DEBUG_LAYOUT) {
    const late = await layout();
    console.log(`layout diff ${path}: -${early.filter((x) => !late.includes(x)).join(" / ")} +${late.filter((x) => !early.includes(x)).join(" / ")}`);
  }
  const { cls, shifts } = await page.evaluate(() => ({ cls: (window as unknown as { __cls: number }).__cls, shifts: (window as unknown as { __shifts: string[] }).__shifts }));
  if (shifts.length) console.log(`[${test.info().project.name}] shifts ${path}: ${shifts.join(" | ")}`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  return cls;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    (w as unknown as { __shifts: string[] }).__shifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] })[]) {
          if (entry.hadRecentInput) continue;
          w.__cls += entry.value;
          const sources = (entry.sources ?? []).map((src) => {
            const el = src.node as HTMLElement | undefined;
            const name = el ? `${el.nodeName.toLowerCase()}${el.dataset?.testid ? `#${el.dataset.testid}` : ""}.${String(el.className ?? "").slice(0, 40)}` : "?";
            return `${name} ${Math.round(src.previousRect.y)}→${Math.round(src.currentRect.y)}`;
          });
          (w as unknown as { __shifts: string[] }).__shifts.push(`${entry.value.toFixed(3)} @${Math.round(entry.startTime)} ${sources.join(" ; ")}`);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // WebKit : pas de layout-shift.
    }
  });
});

test("invité : accueil, onboarding, feuille de correction, bilan, hub et écrans publics", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Commencer" })).toBeVisible({ timeout: 30_000 });
  await checkScreen(page, "accueil", page.getByRole("button", { name: "Commencer" }));

  await onboardHere(page);

  // Feuille de correction : on répond faux à un exercice à choix (la bonne réponse lue dans React).
  let sheetChecked = false;
  for (let step = 0; step < 30 && !sheetChecked; step++) {
    const lesson = page.locator('[data-testid="lesson"]');
    // La séance peut être sur sa fiche de préparation entre deux blocs : ce n'est pas la fin, et
    // `playOneStep` sait la traverser. On ne sort que si plus rien de la séance n'est à l'écran.
    if (!(await lesson.isVisible()) && !(await page.getByTestId("intro-start").isVisible())) break;
    const radio = page.getByRole("radio").first();
    if ((await lesson.getAttribute("data-status")) === "answering" && (await radio.isVisible())) {
      await checkScreen(page, `exercice ${step}`, page.getByRole("button", { name: "Valider" }));
      const expected = await answerId(page);
      const options = await page.getByRole("radio").evaluateAll((els) => els.map((e) => e.getAttribute("data-option-id")));
      const wrong = expected ? options.filter((id) => id !== expected).at(options.indexOf(expected) < options.length / 2 ? -1 : 0) : null;
      if (expected && wrong) {
        await page.locator(`[data-option-id="${wrong}"]`).click();
        await expect(page.locator(`[data-option-id="${wrong}"]`)).toHaveAttribute("aria-checked", "true");
        const cursorBefore = await lesson.getAttribute("data-cursor");
        await page.getByRole("button", { name: "Valider" }).click();
        await expect(page.locator(`[data-testid="lesson"][data-status="feedback"], [data-testid="lesson"]:not([data-cursor="${cursorBefore}"])`).first()).toBeVisible();
        const sheet = page.getByTestId("feedback-sheet");
        if ((await lesson.getAttribute("data-correct")) !== "false" || !(await sheet.isVisible())) {
          note(testInfo, "feedback-sheet", `étape ${step} : réponse jugée juste (${wrong} vs ${expected}), exercice suivant`);
          continue;
        }
        const why = page.getByRole("button", { name: /pourquoi/i });
        if (await why.isVisible()) await why.click();
        await page.waitForTimeout(900);
        const geometry = await page.evaluate(({ expected, wrong }) => {
          const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
          const s = box('[data-testid="feedback-sheet"]');
          const c = box(`[data-option-id="${wrong}"]`);
          const e = box(`[data-option-id="${expected}"]`);
          const label = document.querySelector('[data-testid="feedback-expected"]')?.textContent ?? null;
          return { sheetTop: s.top, sheetHeight: s.height, vh: window.innerHeight, chosen: [c.top, c.bottom], expected: [e.top, e.bottom], label };
        }, { expected, wrong });
        note(testInfo, "feedback-sheet", JSON.stringify(geometry));
        expect(geometry.sheetHeight, "feuille ≤ 70 % de la hauteur").toBeLessThanOrEqual(geometry.vh * 0.7 + 2);
        const visible = (r: number[]) => r[0]! >= -1 && r[1]! <= geometry.sheetTop + 1;
        expect(visible(geometry.expected), "bonne réponse cachée par la feuille").toBe(true);
        const span = Math.max(geometry.chosen[1]!, geometry.expected[1]!) - Math.min(geometry.chosen[0]!, geometry.expected[0]!);
        if (span < geometry.sheetTop - 24) expect(visible(geometry.chosen), "option choisie cachée par la feuille").toBe(true);
        if (geometry.label) expect(geometry.label, "libellé de ton lisible").not.toMatch(/^(ngang|sac|huyen|hoi|nga|nang)$/);
        await expectInViewport(page, page.getByRole("button", { name: "Continuer" }), "feuille : Continuer");
        await expectNoHorizontalOverflow(page, "feuille de correction");
        sheetChecked = true;
        break;
      }
    }
    if ((await playOneStep(page, /Leçon terminée/)) === "done") break;
  }
  if (!sheetChecked) note(testInfo, "feedback-sheet", "aucun exercice à choix atteint");

  // Fin de la leçon : bilan, ou retour au hub si la séance s'est terminée autrement.
  const recapTitle = page.getByRole("heading", { name: /Leçon terminée/ });
  const daily = page.getByRole("button", { name: /Séance du jour/ });
  for (let i = 0; i < 60; i++) {
    if ((await recapTitle.isVisible()) || (await daily.isVisible())) break;
    // `playOneStep` couvre les trois états possibles — fiche de préparation, exercice, bilan.
    // Attendre 500 ms « au cas où » faisait tourner la boucle trente secondes pour rien quand
    // l'écran affiché était la fiche.
    if ((await playOneStep(page, /Leçon terminée/).catch(() => "step")) === "done") break;
  }
  if (await recapTitle.isVisible()) {
    // Les récompenses se posent par-dessus le bilan et interceptent les clics : on les referme.
    await dismissCelebrations(page);
    await checkScreen(page, "bilan", page.getByRole("button", { name: /Continuer|Retour/ }).first());
    await page.getByRole("button", { name: /Continuer|Retour/ }).first().click();
  } else {
    note(testInfo, "bilan", "séance terminée sans écran de bilan (retour au parcours)");
  }
  await goTo(page, "/apprendre");
  await expect(daily.or(page.getByTestId("tutor-greeting")).first()).toBeVisible({ timeout: 20_000 });
  await checkScreen(page, "parcours invité avec progression", (await daily.isVisible()) ? daily : undefined);
  // Accueil et profil : les deux nouveaux écrans « de séjour » (contrat phase7).
  await goTo(page, "/");
  await expect(page.getByTestId("dashboard-header")).toBeVisible({ timeout: 20_000 });
  await checkScreen(page, "accueil invité avec progression", page.getByTestId("dashboard-resume-cta"));
  await goTo(page, "/profil");
  await expect(page.getByTestId("profile-identity")).toBeVisible({ timeout: 20_000 });
  await checkScreen(page, "profil invité");
  // L'aide à l'installation vit sur l'accueil (contrat phase7 §2.6).
  await goTo(page, "/");
  const install = page.getByTestId("install-hint");
  if (await install.isVisible()) {
    const box = (await install.boundingBox())!;
    note(testInfo, "install-hint", `${await install.getAttribute("data-variant")} y=${Math.round(box.y)}`);
    expect(box.y, "aide à l'installation vue sans défiler loin").toBeLessThan(page.viewportSize()!.height * 1.5);
  }

  for (const [path, name, primary] of [
    ["/reglages", "réglages", null],
    ["/jeux", "jeux", null],
    ["/examens", "examens", null],
    ["/badges", "badges", null],
    ["/compte", "création de compte", /Créer mon compte/],
    ["/connexion", "connexion", /^Se connecter$/],
    ["/compte/mot-de-passe-oublie", "mot de passe oublié", /lien|Envoyer/],
  ] as const) {
    await goTo(page, path);
    await page.waitForLoadState("domcontentloaded");
    await checkScreen(page, name, primary ? page.getByRole("button", { name: primary }).last() : undefined);
  }
  const settingsCls = await measureCls(page, "/reglages");
  if (settingsCls !== null) {
    note(testInfo, "cls-settings-guest", settingsCls.toFixed(3));
    expect(settingsCls).toBeLessThan(0.05);
  }
});

test("connecté (API simulée) : hub, ligue, défis, réglages et CLS", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  await mockApi(page);
  await onboardHere(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible({ timeout: 20_000 });
  await signIn(page);

  const first = await measureCls(page, "/apprendre");
  await expect(page.getByTestId("tutor-greeting")).toBeVisible();
  await checkScreen(page, "parcours connecté", page.getByRole("button", { name: /Séance du jour/ }));
  const second = await measureCls(page, "/apprendre");
  if (first !== null && second !== null) {
    note(testInfo, "cls-hub-signed", `1re visite ${first.toFixed(3)}, visite suivante ${second.toFixed(3)}`);
    expect(second).toBeLessThan(0.05);
    expect(first).toBeLessThan(0.1);
  }

  for (const [path, name] of [["/ligue", "ligue"], ["/defis", "défis"], ["/examens", "examens connecté"]] as const) {
    await goTo(page, path);
    await page.waitForLoadState("domcontentloaded");
    await checkScreen(page, name);
  }
  const settingsCls = await measureCls(page, "/reglages");
  await checkScreen(page, "réglages connecté");
  if (settingsCls !== null) {
    note(testInfo, "cls-settings-signed", settingsCls.toFixed(3));
    expect(settingsCls).toBeLessThan(0.05);
  }

  // Cô Mai : barre de saisie vietnamienne (clavier), placeholder non coupé, mots glosés cliquables.
  await goTo(page, "/co-mai");
  const start = page.getByRole("button", { name: /Commencer|Parler|Discuter/ }).first();
  if (await start.isVisible()) {
    await start.click();
    const input = page.locator("#tutor-input");
    await expect(input).toBeVisible();
    await checkScreen(page, "conversation Cô Mai");
    const attrs = await input.evaluate((el: HTMLTextAreaElement) => ({
      lang: el.lang,
      autoCorrect: el.getAttribute("autocorrect"),
      autoCapitalize: el.getAttribute("autocapitalize"),
      spellCheck: el.spellcheck,
      enterKeyHint: el.getAttribute("enterkeyhint"),
      wrapped: el.scrollHeight > el.clientHeight + 2,
      fontSize: parseFloat(getComputedStyle(el).fontSize),
    }));
    note(testInfo, "chat-input", JSON.stringify(attrs));
    expect(attrs).toMatchObject({ lang: "vi", autoCorrect: "off", autoCapitalize: "off", spellCheck: false, enterKeyHint: "send", wrapped: false });
    expect(attrs.fontSize, "16 px minimum : pas de zoom iOS").toBeGreaterThanOrEqual(16);
  }
});

test("jeux et paysage : action visible, Đối đáp garde la question de Cô Mai au clavier", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  await mockApi(page);
  await onboardHere(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible({ timeout: 20_000 });
  await signIn(page);
  // Rechargement explicite : la restauration du compte peut relancer une navigation juste après.
  await page.reload();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible({ timeout: 20_000 });

  await goTo(page, "/jeux");
  await checkScreen(page, "liste des jeux");
  for (const game of ["cho_noi", "bua_com", "xe_om"]) {
    const card = page.locator(`[data-game="${game}"]`);
    if (!(await card.isVisible())) continue;
    await card.click();
    await page.waitForTimeout(500);
    const play = page.getByRole("button", { name: "Jouer" });
    await checkScreen(page, `jeu ${game}`, (await play.isVisible()) ? play : undefined);
    if (await play.isVisible()) {
      await play.click();
      await page.waitForTimeout(700);
      await checkScreen(page, `jeu ${game} en cours`);
    }
    await goTo(page, "/jeux");
  }

  // Đối đáp, clavier ouvert : la question reste lisible (hauteur visible réduite).
  await goTo(page, "/jeux/doi_dap");
  const play = page.getByRole("button", { name: "Jouer" });
  if (await play.isVisible()) {
    await play.click();
    const message = page.getByTestId("tutor-message").last();
    await expect(message).toBeVisible();
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width, height: Math.max(215, Math.round(viewport.height * 0.45)) });
    await page.locator("#tutor-input").focus();
    await page.waitForTimeout(700);
    const geometry = await page.evaluate(() => {
      const list = document.querySelectorAll('[data-testid="tutor-message"]');
      const last = list[list.length - 1]!.getBoundingClientRect();
      const composer = document.querySelector('[data-testid="composer"]')!.getBoundingClientRect();
      return { top: last.top, bottom: last.bottom, composerTop: composer.top, vh: window.innerHeight };
    });
    note(testInfo, "doi-dap-keyboard", JSON.stringify(geometry));
    expect(geometry.top, "question de Cô Mai au-dessus de l'écran").toBeGreaterThanOrEqual(-1);
    expect(Math.min(geometry.bottom, geometry.top + 40), "question cachée par la barre de saisie").toBeLessThanOrEqual(geometry.composerTop + 1);
    await page.setViewportSize(viewport);
  }
});
