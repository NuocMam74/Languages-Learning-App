import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractContour, serializePitchReference, toPitchReference } from "../../../packages/core/src/pitch/index.ts";
import { declareAllMedia } from "./media.ts";

/**
 * Karaoké tonal en navigateur réel (SPEC §8.3, critère Phase 2 §15).
 *
 * Micro simulé par Chromium/Edge : `--use-file-for-fake-audio-capture` rejoue en boucle un wav de synthèse
 * (« chào anh » lié : glissando descendant 170 → 120 Hz puis tenue à 120 Hz), généré par ffmpeg dans un dossier
 * temporaire. Deux prises successives démarrent à des instants différents de la boucle : deux « enregistrements »
 * du même locuteur.
 *
 * Courbe de référence : le build de production ne contient encore aucune courbe (pas d'enregistrements natifs).
 * Choix : on intercepte la requête `pitch/s_chao_anh.json` avec `page.route` et on sert la courbe extraite du même
 * wav par le module pitch de @parlo/core. Aucun code ni fichier de test dans le build de production, aucun flag
 * de build (le webServer Playwright partagé construit l'app telle qu'elle est livrée), et le chemin testé est
 * exactement celui de l'app : fetch → parsePitchReference → micro → AudioWorklet → score. Service worker bloqué
 * pour que l'interception voie la requête.
 */

const dir = mkdtempSync(join(tmpdir(), "parlo-karaoke-"));
const wav = join(dir, "chao-anh.wav");
const refWav = join(dir, "chao-anh-ref.wav");
const voice = (p: string) => `(sin(${p})+0.5*sin(2*${p})+0.33*sin(3*${p})+0.25*sin(4*${p}))`;

/**
 * « chào anh » lié, sans silence interne (une prise qui démarre au milieu de la phrase attend la boucle suivante,
 * règle d'armement, jamais une demi-phrase) : glissando linéaire `from` → `to` Hz sur 0,34 s puis tenue à `to`
 * sur 0,3 s, phase continue ; 3,2 s au total.
 */
function synth(out: string, from: number, to: number) {
  const p1 = `2*PI*(${from}*(t-0.4)+${(to - from) / 2}*(t-0.4)*(t-0.4)/0.34)`;
  const cycles = from * 0.34 + ((to - from) / 2) * 0.34;
  const p2 = `2*PI*(${cycles}+${to}*(t-0.74))`;
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
    "-i", `aevalsrc='0.2*(between(t,0.4,0.74)*${voice(p1)}+between(t,0.7401,1.04)*${voice(p2)})':s=48000:d=3.2`,
    "-ac", "1", "-c:a", "pcm_s16le", out,
  ]);
}
// Micro : chute de 170 à 120 Hz (6 st). Référence « native » : chute plus profonde, 190 → 115 Hz (8,7 st),
// pour que le score ne sature pas à 100 et que l'écart entre prises soit significatif.
synth(wav, 170, 120);
synth(refWav, 190, 115);

function referenceJson(): string {
  const buf = readFileSync(refWav);
  // En-tête RIFF : on cherche le bloc « data ».
  let offset = 12;
  while (buf.toString("ascii", offset, offset + 4) !== "data") offset += 8 + buf.readUInt32LE(offset + 4);
  const length = buf.readUInt32LE(offset + 4) / 2;
  const pcm = new Float32Array(length);
  for (let i = 0; i < length; i++) pcm[i] = buf.readInt16LE(offset + 8 + 2 * i) / 32768;
  return serializePitchReference(toPitchReference(extractContour(pcm, 48_000), ["huyen", "ngang"]));
}
test.use({
  serviceWorkers: "block",
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  },
});

test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function openKaraoke(page: Page) {
  const json = referenceJson();
  // Entrée karaoké masquée sans courbe présente (contrat phase5 §1) : les courbes déclarées sont ajoutées à l'index des médias.
  await declareAllMedia(page, { audio: false });
  await page.route("**/content/vi-south/v*/pitch/s_chao_anh.json", (route) => route.fulfill({ contentType: "application/json", body: json }));
  await page.goto("/jeux");
  await page.getByRole("link", { name: /Karaoké tonal|Karaoke/ }).click();
  await expect(page).toHaveURL(/\/jeux\/karaoke_tonal$/);
  await page.getByTestId("karaoke-list").getByRole("button", { name: /chào anh/i }).click();
  await expect(page.getByTestId("karaoke")).toBeVisible();
}

/** L'écran d'explication n'apparaît que si la permission n'est pas déjà accordée. */
async function allowIfAsked(page: Page, next: ReturnType<Page["locator"]>) {
  const allow = page.getByRole("button", { name: "Autoriser le micro" });
  await expect(allow.or(next)).toBeVisible({ timeout: 10_000 });
  if (await allow.isVisible()) await allow.click();
  await expect(next).toBeVisible({ timeout: 10_000 });
}

async function takeOnce(page: Page): Promise<number> {
  const karaoke = page.getByTestId("karaoke");
  const before = Number(await karaoke.getAttribute("data-takes"));
  const started = karaoke.and(page.locator(`[data-takes="${before + 1}"]`));
  const allow = page.getByRole("button", { name: "Autoriser le micro" });
  // Un clic pendant l'animation de la note peut être perdu : on relance tant que la prise n'a pas démarré.
  await expect(async () => {
    if (await allow.isVisible()) await allow.click();
    else if (!(await started.isVisible())) await page.getByRole("button", { name: /^(Parler|Réessayer)$/ }).click({ timeout: 2_000 });
    await expect(started).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(started.and(page.locator('[data-state="done"]'))).toBeVisible({ timeout: 20_000 });
  // Une prise notée, jamais une prise partielle ou vide : la capture attend une vraie attaque.
  await expect(karaoke).toHaveAttribute("data-take", "scored");
  const score = page.getByTestId("karaoke-score");
  await expect(score).toBeVisible();
  console.log(`[karaoke] take: score ${await score.getAttribute("data-score")}, coverage ${await score.getAttribute("data-coverage")}`);
  return Number(await score.getAttribute("data-score"));
}
test("karaoké tonal : micro simulé, deux prises notées, écart < 10 points ; image p95 sous CPU ×4", async ({ page }) => {
  await openKaraoke(page);

  // Mesure du temps entre images pendant le tracé en direct, processeur ralenti ×4.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__frames = [];
    w.__stop = false;
    let last = performance.now();
    const loop = (now: number) => {
      if (document.querySelector('[data-testid="karaoke"]')?.getAttribute("data-state") === "recording") w.__frames.push(now - last);
      last = now;
      if (!w.__stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const idle = await page.evaluate(() => new Promise<number[]>((resolve) => { const out: number[] = []; let last = performance.now(); const loop = (now: number) => { out.push(Math.round(now - last)); last = now; if (out.length < 60) requestAnimationFrame(loop); else resolve(out); }; requestAnimationFrame(loop); }));
  const idleP95 = [...idle].sort((a, b) => a - b)[Math.floor(idle.length * 0.95)];
  console.log(`[karaoke] p95 frame time idle (CPU x4, baseline): ${idleP95} ms`);
  const first = await takeOnce(page);
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__stop = true;
    return w.__frames;
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Number.NaN;
  test.info().annotations.push({ type: "frame-time-p95-ms (CPU x4)", description: `${p95.toFixed(1)} ms over ${frames.length} frames` });
  console.log(`[karaoke] p95 frame time during live drawing (CPU x4): ${p95.toFixed(1)} ms over ${frames.length} frames`);
  // Mesure informative (annotation) : sous charge parallèle, le navigateur peut suspendre les images de la page ;
  // ce n'est pas un critère de réussite de la prise.

  // Deuxième prise du même « locuteur ».
  const second = await takeOnce(page);
  console.log(`[karaoke] scores: ${first} / ${second} (Δ ${Math.abs(first - second)})`);
  test.info().annotations.push({ type: "scores", description: `${first} / ${second}` });
  expect(first).toBeGreaterThan(0);
  expect(Math.abs(first - second)).toBeLessThan(10);
  await expect(page.getByText(/^Meilleur : \d+ · 2 essais$/)).toBeVisible();

  // « Autre phrase » : retour à la liste avec le record.
  await page.getByRole("button", { name: "Autre phrase" }).click();
  await expect(page.getByTestId("karaoke-list").getByText(`Record : ${Math.max(first, second)}`)).toBeVisible();
});

test("karaoké tonal : micro refusé → l'exercice devient de l'écoute, sans note", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("refusé", "NotAllowedError"));
  });
  await openKaraoke(page);
  await page.getByRole("button", { name: "Parler", exact: true }).click();
  const denied = page.getByText(/Le micro n'est pas autorisé/);
  await allowIfAsked(page, denied);
  await expect(page.getByText("Réactiver le micro")).toBeVisible();
  await page.getByRole("button", { name: "C'est fait" }).click();
  await expect(page.getByTestId("karaoke-list")).toBeVisible();
});
