/**
 * Captures d'écran de la revue esthétique (contrat phase8 §1).
 *
 *   npx tsx scripts/design-shots.ts --base http://localhost:4901 --out docs/audits/shots/after
 *
 * Deux téléphones de référence : iPhone 13 (390×844, WebKit) et Galaxy S25 Ultra (412×915, Edge).
 * Le script joue un vrai parcours (bienvenue → onboarding → leçon → bilan) puis passe sur les
 * écrans de séjour : ce sont des écrans réels avec de vraies données, pas des maquettes.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const BASE = argOf("base", "http://localhost:4901");
const OUT = argOf("out", "docs/audits/shots/after");

interface Device {
  key: string;
  launch: () => Promise<Browser>;
  context: { viewport: { width: number; height: number }; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean; locale: string };
}

const DEVICES: Device[] = [
  {
    key: "iphone-13",
    launch: () => webkit.launch(),
    context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "fr-FR" },
  },
  {
    key: "galaxy-s25-ultra",
    launch: () => chromium.launch({ channel: "msedge" }),
    context: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "fr-FR" },
  },
];

async function shot(page: Page, dir: string, name: string) {
  // Les entrées en cascade durent 320 ms + 200 ms de décalage : on capture une page posée.
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
  process.stdout.write(`  ${name}.png\n`);
}

/**
 * Premier lancement : bienvenue → langue → 5 questions → test de niveau → visite guidée → parcours
 * (contrat phase23 §3), puis la première leçon, demandée explicitement — l'application ne l'impose
 * plus.
 */
async function onboard(page: Page, dir: string) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // Premier chargement à froid (WebKit, précache du service worker) : plus lent que le reste.
  await page.getByRole("button", { name: "Commencer" }).waitFor({ timeout: 45_000 });
  await shot(page, dir, "01-bienvenue");

  await page.getByRole("button", { name: "Commencer" }).click();
  await page.getByRole("button", { name: "Continuer" }).waitFor();
  await shot(page, dir, "02-choix-langue");
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await page.getByText(`Question ${i + 1} sur 5`).waitFor();
    if (i === 0) await shot(page, dir, "03-onboarding");
    await page.locator("main button").first().click();
  }
  const placement = page.getByRole("heading", { name: "Commençons par te situer" });
  const tour = page.getByTestId("discovery-step");
  await placement.or(tour).first().waitFor();
  if (await placement.isVisible()) {
    await shot(page, dir, "03b-test-de-niveau");
    await page.getByRole("button", { name: "Je pars de zéro" }).click();
  }
  await tour.waitFor();
  await shot(page, dir, "03c-decouverte");
  await page.getByTestId("discovery-skip").click();
  await page.goto(`${BASE}/lecon/vi-south.u01.l01`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="lesson"], [data-testid="lesson-intro"]').first().waitFor();
}

/** Répond à l'item affiché comme le ferait quelqu'un de pressé ; renvoie `done` au bilan. */
async function step(page: Page): Promise<"done" | "step"> {
  const session = page.locator('[data-testid="lesson"]');
  if ((await session.count()) === 0) return "done";
  const cont = page.getByRole("button", { name: "Continuer" });
  const check = page.getByRole("button", { name: "Valider" });
  const done = page.getByRole("button", { name: "C'est fait" });
  const radio = page.getByRole("radio").first();
  const input = page.getByTestId("answer-input");

  const status = await session.getAttribute("data-status").catch(() => null);
  if (status === "feedback") {
    if (await cont.isVisible()) await cont.click();
    else await page.waitForTimeout(800);
    return "step";
  }
  const shown = async (l: ReturnType<Page["getByRole"]>) => l.isVisible({ timeout: 500 }).catch(() => false);
  if (await shown(input)) {
    await input.fill("?");
    await check.click({ timeout: 3000 });
  } else if (await shown(done)) {
    await done.click({ timeout: 3000 });
  } else if (await shown(radio)) {
    await radio.click({ timeout: 3000 });
    if (await shown(check)) await check.click({ timeout: 3000 });
  } else if (await shown(cont)) {
    await cont.click({ timeout: 3000 });
  } else if (await shown(check)) {
    await check.click({ timeout: 3000 });
  } else {
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(350);
  return "step";
}

async function run(device: Device) {
  const dir = join(OUT, device.key);
  mkdirSync(dir, { recursive: true });
  process.stdout.write(`${device.key} → ${dir}\n`);
  const browser = await device.launch();
  const context = await browser.newContext(device.context);
  // Budget court : une capture ne doit jamais attendre 30 s qu'un bouton apparaisse.
  context.setDefaultTimeout(6000);
  const page = await context.newPage();

  await onboard(page, dir);
  await shot(page, dir, "04-lecon-question");

  // L'accueil du premier jour : rien de commencé, donc l'invitation et le delta.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="dashboard-header"]').waitFor();
  await shot(page, dir, "05-accueil-premier-jour");

  // Retour en séance : on cherche une correction d'erreur (la feuille laque).
  await page.goto(`${BASE}/seance`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="lesson"]').waitFor();
  let captured = false;
  for (let i = 0; i < 40 && !captured; i++) {
    const session = page.locator('[data-testid="lesson"]');
    if ((await session.count()) === 0) break;
    if ((await session.getAttribute("data-correct").catch(() => null)) === "false") {
      await shot(page, dir, "06-correction-erreur");
      captured = true;
      break;
    }
    if ((await step(page).catch(() => "done" as const)) === "done") break;
  }
  if (!captured) process.stdout.write("  (aucune erreur rencontrée : pas de capture de correction)\n");

  // Jusqu'au bilan (budget de temps : mieux vaut une capture imparfaite qu'un script figé).
  const deadline = Date.now() + 180_000;
  for (let i = 0; i < 200 && Date.now() < deadline; i++) {
    if ((await page.locator('[data-testid="lesson"]').count()) === 0) break;
    await step(page).catch(() => undefined);
  }
  await shot(page, dir, "07-bilan");

  for (const [name, path] of [
    ["08-accueil-avec-progression", "/"],
    ["09-parcours", "/apprendre"],
    ["10-reviser", "/reviser"],
    ["11-reviser-vocabulaire", "/reviser/vocabulaire"],
    ["12-profil", "/profil"],
    ["13-jeux", "/jeux"],
    ["14-examens", "/examens"],
    ["15-notes", "/notes"],
    ["16-statistiques", "/statistiques"],
    ["17-statistiques-competences", "/statistiques/skills"],
    ["18-statistiques-parcours", "/statistiques/journey"],
    ["19-fiches", "/fiches"],
    ["20-fiche", "/fiches/vi-south.u01.l01"],
  ] as const) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.locator("main").first().waitFor({ timeout: 6000 }).catch(() => undefined);
    await shot(page, dir, name);
  }

  await context.close();
  await browser.close();
}

const only = argOf("only", "");
for (const device of DEVICES.filter((d) => !only || d.key === only)) {
  await run(device).catch((error: unknown) => process.stdout.write(`  échec ${device.key} : ${String(error)}\n`));
}
