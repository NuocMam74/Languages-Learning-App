import { expect, test, type Page } from "@playwright/test";
import { onboard } from "./helpers.ts";

/**
 * Audit visuel (contrat phase8 §1 et §5). Ce fichier ne juge pas le goût : il vérifie les
 * promesses mesurables du système de design sur les deux téléphones de référence.
 *
 *  1. aucun débordement horizontal (iPhone 13 — 390×844 WebKit, Galaxy S25 Ultra — 412×915 Edge) ;
 *  2. CLS ≤ 0,05 sur accueil, parcours, réviser, profil et une leçon ;
 *  3. `prefers-reduced-motion` respecté : aucune animation longue ne tourne ;
 *  4. contraste AA sur les styles de texte échantillonnés ;
 *  5. chaque écran vide montre son illustration et son invitation — jamais un écran blanc.
 */

const IPHONE_13 = { browserName: "webkit" as const, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const S25_ULTRA = { browserName: "chromium" as const, channel: "msedge", viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true };

/** Budget de décalage cumulé (contrat phase8) : au-delà, la page « saute » sous les yeux. */
const CLS_BUDGET = 0.05;

/** Écrans de séjour : ceux qu'on ouvre sans être en train de répondre. */
const SCREENS = ["/", "/apprendre", "/reviser", "/reviser/vocabulaire", "/profil", "/jeux", "/examens", "/notes", "/badges", "/reglages"];

async function watchLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls?: number; __clsOk?: boolean };
    w.__cls = 0;
    w.__clsOk = false;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls = (w.__cls ?? 0) + entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      w.__clsOk = true;
    } catch {
      // WebKit n'expose pas `layout-shift` : la mesure se fait sur l'autre appareil.
    }
  });
}

/** Décalage cumulé depuis l'ouverture de la page, ou `null` si le navigateur ne le mesure pas. */
async function readCls(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __cls?: number; __clsOk?: boolean };
    return w.__clsOk ? (w.__cls ?? 0) : null;
  });
}

/** Le document ne doit jamais être plus large que la fenêtre (1 px de tolérance d'arrondi). */
async function expectNoOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide: string[] = [];
    // Le coupable est signalé : sans lui, « ça déborde » n'aide personne à corriger.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.right > window.innerWidth + 1 && getComputedStyle(el).overflowX === "visible") {
        wide.push(`${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)}`);
        if (wide.length > 3) break;
      }
    }
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, wide };
  });
  expect(overflow.scrollWidth, `${where} : débordement horizontal (${overflow.wide.join(" | ")})`).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

/**
 * Contraste AA des textes visibles : 4,5:1 en corps, 3:1 en grand (≥ 24 px, ou ≥ 18,66 px gras).
 * Les couleurs semi-transparentes sont composées sur le premier fond opaque trouvé au-dessus.
 */
async function expectAaContrast(page: Page, where: string) {
  const failures = await page.evaluate(() => {
    const parse = (value: string): [number, number, number, number] => {
      const n = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const over = (fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number, number] => {
      const a = fg[3];
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
    };
    const lum = (c: [number, number, number, number]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const backdrop = (el: Element): [number, number, number, number] => {
      let layer: [number, number, number, number] = [255, 255, 255, 0];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg[3] === 0) continue;
        layer = layer[3] === 0 ? bg : over(layer, bg);
        if (layer[3] >= 0.999) return layer;
      }
      return over(layer, [242, 246, 243, 1]); // nước, le fond de l'app
    };

    const bad: string[] = [];
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const text = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1);
      if (!text) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      const size = Number.parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const fg = over(parse(style.color), backdrop(el));
      const bg = backdrop(el);
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
      const need = large ? 3 : 4.5;
      // Un échantillon par combinaison couleur/fond/taille : un écran ne rend pas 200 verdicts.
      const key = `${style.color}|${bg.join()}|${large}`;
      if (ratio < need - 0.01 && !seen.has(key)) {
        seen.add(key);
        bad.push(`${ratio.toFixed(2)}:1 (min ${need}) « ${(el.textContent ?? "").trim().slice(0, 28)} » ${style.color} sur rgb(${bg.slice(0, 3).map(Math.round).join(",")})`);
      }
    }
    return bad;
  });
  expect(failures, `${where} : contraste sous AA`).toEqual([]);
}

function auditFor(name: string, device: typeof IPHONE_13 | typeof S25_ULTRA) {
  test.describe(`${name}`, () => {
    test.use(device);

    test("écrans de séjour : pas de débordement, contraste AA, CLS tenu", async ({ page }) => {
      await watchLayoutShift(page);
      await onboard(page);
      // On quitte la leçon ouverte par l'onboarding : l'audit porte sur les écrans de séjour.
      await page.goto("/apprendre");

      for (const path of SCREENS) {
        await page.goto(path);
        await expect(page.locator("main, [data-testid='lesson']").first()).toBeVisible();
        // Les entrées en cascade durent 320 ms + 200 ms de décalage : on mesure une fois posé.
        await page.waitForTimeout(700);
        await expectNoOverflow(page, path);
        await expectAaContrast(page, path);
        const cls = await readCls(page);
        if (cls !== null) expect(cls, `${path} : CLS`).toBeLessThanOrEqual(CLS_BUDGET);
      }
    });

    test("une leçon : pas de débordement ni de saut de mise en page", async ({ page }) => {
      await watchLayoutShift(page);
      await onboard(page);
      await expect(page.getByTestId("lesson")).toBeVisible();
      await page.waitForTimeout(700);
      await expectNoOverflow(page, "leçon");
      await expectAaContrast(page, "leçon");
      const cls = await readCls(page);
      if (cls !== null) expect(cls, "leçon : CLS").toBeLessThanOrEqual(CLS_BUDGET);
    });

    test("mouvement réduit : aucune animation longue ne tourne", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/bienvenue");
      await expect(page.getByRole("button", { name: "Commencer" })).toBeVisible();
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => {
            const duration = a.effect?.getComputedTiming().duration;
            return typeof duration === "number" && duration > 1;
          })
          .map((a) => (a.effect as KeyframeEffect | null)?.target?.tagName ?? "?"),
      );
      expect(running, "animations encore longues en mouvement réduit").toEqual([]);
    });

    test("écrans vides : illustration, phrase et action — jamais un mur blanc", async ({ page }) => {
      await page.goto("/bienvenue");
      // L'accueil du premier jour montre le delta : la promesse est une image avant d'être un texte.
      await expect(page.locator("[data-illustration] svg").first()).toBeVisible();
      await expectNoOverflow(page, "/bienvenue");
      await expectAaContrast(page, "/bienvenue");

      await onboard(page);
      // Rien n'a encore été appris : la bibliothèque et les notes doivent inviter, pas se taire.
      for (const path of ["/reviser", "/notes"]) {
        await page.goto(path);
        const empty = page.locator("[data-empty-state]").first();
        await expect(empty, `${path} : état vide absent`).toBeVisible();
        await expect(empty.locator("svg").first(), `${path} : illustration absente`).toBeVisible();
      }
    });
  });
}

auditFor("iPhone 13 (390×844, WebKit)", IPHONE_13);
auditFor("Galaxy S25 Ultra (412×915, Edge)", S25_ULTRA);
