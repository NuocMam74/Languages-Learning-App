/**
 * Captures du manifeste (fiche d'installation enrichie Android) à partir de l'app réelle :
 * narrow 1080×1920 (360×640 @3) et wide 1920×1080 (1280×720 @1,5), écrites dans public/screenshots/.
 * Nécessite un build servi (ex. `npx vite preview --port 4501`).
 * Usage : BASE_URL=http://localhost:4501 npx tsx apps/web/scripts/generate-screenshots.ts
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:4501";
const OUT = join(import.meta.dirname, "..", "public", "screenshots");

async function onboardToLesson(page: Page) {
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Commencer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await page.getByText(`Question ${i + 1} sur 5`).waitFor();
    await page.locator("main button").first().click();
  }
  const skip = page.getByRole("button", { name: /^Passer/ });
  await skip.or(page.locator('[data-testid="lesson"]')).first().waitFor();
  if (await skip.isVisible()) await skip.click();
  await page.locator('[data-testid="lesson"]').waitFor();
}

async function capture(size: { width: number; height: number; scale: number }, prefix: "narrow" | "wide", withLesson: boolean) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    locale: "fr-FR",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await onboardToLesson(page);
  await page.waitForTimeout(800);
  if (withLesson) await page.screenshot({ path: join(OUT, `${prefix}-lesson.png`) });
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await page.getByRole("button", { name: /Séance du jour/ }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${prefix}-hub.png`) });
  await browser.close();
}

mkdirSync(OUT, { recursive: true });
await capture({ width: 360, height: 640, scale: 3 }, "narrow", true);
await capture({ width: 1280, height: 720, scale: 1.5 }, "wide", false);
console.log(`Captures écrites dans ${OUT}`);
