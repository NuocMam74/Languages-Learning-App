/**
 * Écrans de démarrage iOS (apple-touch-startup-image) : fond nước, icône Parlo et nom, rendus par
 * Chromium (Playwright) aux tailles exactes des iPhone et iPad courants, en portrait.
 * Écrit public/splash/*.png et affiche les balises <link> à coller dans index.html.
 * Usage : npx tsx apps/web/scripts/generate-splash.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PUBLIC = join(import.meta.dirname, "..", "public");
const OUT = join(PUBLIC, "splash");

/** Largeur × hauteur CSS (portrait) et densité. */
export const SPLASH_DEVICES: { w: number; h: number; dpr: number; name: string }[] = [
  { w: 440, h: 956, dpr: 3, name: "iPhone 16 Pro Max" },
  { w: 402, h: 874, dpr: 3, name: "iPhone 16 Pro" },
  { w: 430, h: 932, dpr: 3, name: "iPhone 14 Pro Max / 15 Plus / 16 Plus" },
  { w: 393, h: 852, dpr: 3, name: "iPhone 14 Pro / 15 / 16" },
  { w: 428, h: 926, dpr: 3, name: "iPhone 12–13 Pro Max / 14 Plus" },
  { w: 390, h: 844, dpr: 3, name: "iPhone 12–14" },
  { w: 375, h: 812, dpr: 3, name: "iPhone X–11 Pro / 12–13 mini" },
  { w: 414, h: 896, dpr: 3, name: "iPhone XS Max / 11 Pro Max" },
  { w: 414, h: 896, dpr: 2, name: "iPhone XR / 11" },
  { w: 414, h: 736, dpr: 3, name: "iPhone 8 Plus" },
  { w: 375, h: 667, dpr: 2, name: "iPhone SE / 8" },
  { w: 744, h: 1133, dpr: 2, name: "iPad mini" },
  { w: 820, h: 1180, dpr: 2, name: "iPad Air / 10.9" },
  { w: 834, h: 1194, dpr: 2, name: "iPad Pro 11" },
  { w: 810, h: 1080, dpr: 2, name: "iPad 10.2" },
  { w: 1024, h: 1366, dpr: 2, name: "iPad Pro 12.9" },
];

const icon = readFileSync(join(PUBLIC, "icons", "icon.svg"), "utf8");
const fontCss = (weight: number) => {
  const file = join(import.meta.dirname, "..", "..", "..", "node_modules", "@fontsource-variable", "source-serif-4", "files", "source-serif-4-latin-wght-normal.woff2");
  return `@font-face{font-family:"S";font-weight:200 900;src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format("woff2")}` + `.n{font-weight:${weight}}`;
};

const html = (w: number) => `<!doctype html><html><head><style>
${fontCss(600)}
html,body{margin:0;height:100%;background:#F2F6F3}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(w * 0.06)}px;font-family:"S",Georgia,serif;color:#0E5E55}
svg{width:${Math.round(w * 0.28)}px;height:auto}
.n{font-size:${Math.round(w * 0.11)}px;letter-spacing:.01em}
</style></head><body>${icon}<div class="n">Parlo</div></body></html>`;

export const splashFile = (d: { w: number; h: number; dpr: number }) => `splash-${d.w * d.dpr}x${d.h * d.dpr}.png`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  // Edge/Chrome installés localement (PW_CHANNEL) évitent de télécharger Chromium.
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
  const links: string[] = [];
  const seen = new Set<string>();
  for (const d of SPLASH_DEVICES) {
    const file = splashFile(d);
    if (seen.has(file)) continue;
    seen.add(file);
    const page = await browser.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr });
    await page.setContent(html(d.w));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, file) });
    await page.close();
    links.push(
      `    <link rel="apple-touch-startup-image" href="/splash/${file}" media="(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)" />`,
    );
  }
  await browser.close();
  console.log(`Écrans de démarrage écrits dans ${OUT}\n${links.join("\n")}`);
}

await main();
