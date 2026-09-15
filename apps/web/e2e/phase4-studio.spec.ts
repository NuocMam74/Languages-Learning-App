import { expect, test, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPackFiles } from "../../../scripts/lib/load-pack.ts";

/**
 * Phase 4 — studio de contenu (docs/contracts/phase4.md §0–§1), API simulée par page.route :
 * garde des rôles, édition d'un mot avec erreur puis correction, aperçu d'un exercice, brouillon enregistré,
 * conflit 409, relecture (approuver au clavier), publication, enregistrement audio (micro simulé par un wav ffmpeg).
 */

const dir = mkdtempSync(join(tmpdir(), "parlo-studio-"));
const wav = join(dir, "ba.wav");
// « ba » : voyelle voisée à 180 Hz (harmoniques), 0,5 s de voix entre deux silences, en boucle.
execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
  "-i", "aevalsrc='0.25*between(t,0.5,1.0)*(sin(2*PI*180*t)+0.5*sin(4*PI*180*t)+0.3*sin(6*PI*180*t))':s=48000:d=2",
  "-ac", "1", "-c:a", "pcm_s16le", wav,
]);

test.use({
  serviceWorkers: "block",
  permissions: ["microphone"],
  viewport: { width: 1280, height: 900 },
  isMobile: false,
  hasTouch: false,
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  },
});

test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

const files = readPackFiles("vi-south");
const byId = (list: { data: unknown }[], id: string) => list.find((f) => (f.data as { id?: string }).id === id)?.data ?? null;
const doubts = JSON.parse(readFileSync(join(files.root, "_review", "doubts.json"), "utf8")) as Record<string, string[]>;

interface Call {
  method: string;
  path: string;
  body: unknown;
  raw: string;
}

interface Options {
  roles: string[];
  /** Documents dont le premier PUT répond 409. */
  conflictOn?: string[];
}

async function mockApi(page: Page, { roles, conflictOn = [] }: Options) {
  const calls: Call[] = [];
  const drafts = new Map<string, { data: unknown; updatedAt: string; updatedBy: string }>();
  const conflicted = new Set<string>();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 8, 15, 10, 0, clock++)).toISOString();

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/api/, ""));
    const method = request.method();
    const raw = request.postData() ?? "";
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    calls.push({ method, path, body, raw });
    const reply = (status: number, json?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: json === undefined ? "" : JSON.stringify(json) });

    if (path === "/auth/refresh") return reply(200, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 });
    if (path === "/me") {
      return reply(200, {
        user: { id: "u1", email: "mai@parlo.app", displayName: "Mai", locale: "fr", createdAt: new Date().toISOString(), isGuest: false },
        profile: { motivation: null, dailyGoalMin: 5, reminderHour: null, levelEstimate: null, pathVariant: null },
        enrollment: null,
        streak: { current: 0, longest: 0, lastActiveDate: null, freezesAvailable: 0, frozenUntil: null },
        roles,
      });
    }
    if (path === "/me/events") return reply(200, { accepted: [], rejected: [] });
    if (path === "/studio/packs") return reply(200, [{ code: "vi-south", name: "Vietnamien du Sud", version: 1 }]);

    const base = "/studio/packs/vi-south";
    if (path === `${base}/tree`) {
      const curriculum = files.curriculum?.data as { units: { id: string; title: { fr: string }; status: string; lessons: string[] }[] };
      const draft = (kind: string, id: string) => drafts.has(`${kind}:${id}`);
      return reply(200, {
        units: curriculum.units.map((u) => ({
          id: u.id,
          title: u.title,
          status: u.status,
          lessons: u.lessons.map((id) => {
            const l = byId(files.lessons, id) as { title: { fr: string }; kind?: string; reviewed: boolean } | null;
            return { id, title: l?.title ?? { fr: id }, kind: l?.kind ?? "lesson", reviewed: l?.reviewed ?? false, draft: draft("lesson", id) };
          }),
        })),
        concepts: files.concepts.map((f) => {
          const c = f.data as { id: string; vi: string; reviewed: boolean };
          return { id: c.id, vi: c.vi, reviewed: c.reviewed, draft: draft("concept", c.id) };
        }),
        culture: files.culture.map((f) => {
          const c = f.data as { id: string; reviewed: boolean };
          return { id: c.id, reviewed: c.reviewed, draft: draft("culture", c.id) };
        }),
      });
    }

    const doc = /^\/studio\/packs\/vi-south\/documents\/([a-z-]+)\/([^/]+)(\/draft|\/review)?$/.exec(path);
    if (doc) {
      const [, kind = "", id = "", suffix] = doc;
      const key = `${kind}:${id}`;
      if (suffix === "/review") return reply(200, { reviewedBy: "Mai", reviewedAt: new Date().toISOString() });
      if (suffix === "/draft") {
        drafts.delete(key);
        return reply(204);
      }
      if (method === "GET") {
        const list = kind === "lesson" ? files.lessons : kind === "concept" ? files.concepts : kind === "culture" ? files.culture : [];
        return reply(200, { kind, id, published: byId(list, id), draft: drafts.get(key) ?? null });
      }
      if (method === "PUT") {
        const { data, baseUpdatedAt } = body as { data: unknown; baseUpdatedAt: string | null };
        if (conflictOn.includes(key) && !conflicted.has(key)) {
          conflicted.add(key);
          const published = byId(files.culture, id) as { title: { fr: string } };
          drafts.set(key, { data: { ...published, title: { ...published.title, fr: "Version de Lan" } }, updatedAt: stamp(), updatedBy: "Lan" });
          return reply(409, { detail: "conflict" });
        }
        const current = drafts.get(key);
        if (current && current.updatedAt !== baseUpdatedAt) return reply(409, { detail: "conflict" });
        const updatedAt = stamp();
        drafts.set(key, { data, updatedAt, updatedBy: "Mai" });
        return reply(200, { updatedAt });
      }
    }

    if (path === `${base}/validate`) return reply(200, { errors: [], warnings: [] });
    if (path === `${base}/publish`) {
      const { documents } = body as { documents: { kind: string; id: string }[] };
      return reply(200, { written: documents.map((d) => `content/vi-south/${d.kind === "concept" ? "concepts" : d.kind}/${d.id}.json`), packVersion: 2 });
    }
    if (path.startsWith(`${base}/review-queue`)) {
      return reply(200, [
        { kind: "concept", id: "c_ba", title: "papa", vi: ["ba", "Đây là ba tôi."], doubts: doubts.c_ba ?? ["Forme familière ?"] },
        { kind: "lesson", id: "vi-south.u04.l01", title: "Leçon u04", vi: ["cậu", "dì"], doubts: [] },
      ]);
    }
    if (path === `${base}/audio` && method === "POST") {
      return reply(200, {
        files: [
          { path: "audio/c_ba_mai_hcm_f.opus", durationMs: 640 },
          { path: "audio/c_ba_mai_hcm_f_slow.opus", durationMs: 960 },
        ],
        pitch: { path: "pitch/c_ba.json" },
      });
    }
    if (path.startsWith(`${base}/audio/`)) return route.fulfill({ status: 200, contentType: "audio/wav", body: readFileSync(wav) });
    return reply(404, { detail: "not found" });
  });
  return calls;
}

test("garde des rôles : un apprenant n'entre pas dans le studio", async ({ page }) => {
  await mockApi(page, { roles: ["learner"] });
  await page.goto("/studio");
  await expect(page.getByTestId("studio-forbidden")).toBeVisible();
  await expect(page.getByTestId("studio-tree")).toHaveCount(0);
});

test("éditer un mot : erreur signalée puis corrigée, brouillon enregistré, aperçu d'un exercice", async ({ page }) => {
  const calls = await mockApi(page, { roles: ["reviewer"] });
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/studio\/vi-south$/);
  const tree = page.getByTestId("studio-tree");
  await tree.getByLabel("Rechercher").fill("c_ba");
  await tree.getByRole("link").filter({ has: page.getByText("c_ba", { exact: true }) }).click();
  await expect(page).toHaveURL(/\/studio\/vi-south\/doc\/concept\/c_ba$/);

  const vi = page.getByLabel("En vietnamien du Sud");
  await expect(vi).toHaveValue("ba");
  await expect(page.getByTestId("issues-summary")).toHaveAttribute("data-errors", "0");
  // Pas de JSON pour un relecteur.
  await expect(page.getByRole("button", { name: "Avancé : JSON" })).toHaveCount(0);

  await vi.fill("bố");
  await expect(page.getByTestId("issues-vi")).toContainText("forme du Nord");
  await expect(vi).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("tone-detected")).toContainText("sắc");

  // Correction avec le clavier Telex : « baf » → « bà », puis « ba ».
  await page.getByLabel("Clavier Telex").check();
  await vi.fill("");
  await vi.pressSequentially("baf");
  await expect(vi).toHaveValue("bà");
  await vi.fill("ba");
  await expect(page.getByTestId("issues-summary")).toHaveAttribute("data-errors", "0");
  await expect(page.getByTestId("issues-vi")).toHaveCount(0);

  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
  const put = calls.filter((c) => c.method === "PUT" && c.path.endsWith("/documents/concept/c_ba")).at(-1);
  expect((put?.body as { data: { vi: string; tone: string } }).data).toMatchObject({ vi: "ba", tone: "ngang" });

  // Aperçu : l'exercice 6 de la leçon 1 passe par le vrai moteur.
  await page.goto("/studio/vi-south/doc/lesson/vi-south.u01.l01");
  await expect(page.getByTestId("step-5")).toBeVisible();
  await page.getByRole("button", { name: "Aperçu de l'exercice 6" }).click();
  const preview = page.getByTestId("step-preview");
  await preview.getByRole("radio").first().click();
  await preview.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByTestId("step-5").getByRole("status").filter({ hasText: /Bonne réponse|Mauvaise réponse|Presque/ })).toBeVisible();

  // Erreur d'exercice rattachée à l'exercice : bonne réponse retirée des options.
  await page.getByTestId("step-5").getByRole("textbox", { name: "Élément 1", exact: true }).fill("má");
  await expect(page.getByTestId("issues-steps.5")).toContainText("identique");
});

test("conflit : garder ma version après avoir vu les différences", async ({ page }) => {
  const calls = await mockApi(page, { roles: ["editor"], conflictOn: ["culture:cc_tones_south"] });
  await page.goto("/studio/vi-south/doc/culture/cc_tones_south");
  const title = page.getByRole("group", { name: "Titre" }).getByLabel("Français");
  await title.fill("Cinq tons, six accents");
  await expect(page.getByTestId("conflict")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Voir les différences" }).click();
  await expect(page.getByTestId("conflict-diff")).toContainText("Version de Lan");
  await page.getByRole("button", { name: "Garder ma version" }).click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved");
  const puts = calls.filter((c) => c.method === "PUT");
  expect((puts.at(-1)?.body as { baseUpdatedAt: string | null }).baseUpdatedAt).not.toBeNull();
  expect((puts.at(-1)?.body as { data: { title: { fr: string } } }).data.title.fr).toBe("Cinq tons, six accents");
  // Compteur de mots de la carte.
  await expect(page.getByTestId("word-counter").first()).toContainText("sur 60");
});

test("relecture au clavier puis publication par un éditeur", async ({ page }) => {
  const calls = await mockApi(page, { roles: ["editor"] });
  await page.goto("/studio/vi-south/relecture");
  const item = page.getByTestId("review-item");
  await expect(item).toContainText("Đây là ba tôi.");
  await expect(page.getByTestId("review-doubts")).toBeVisible();
  await page.getByRole("heading", { name: "Relecture" }).click();
  await page.keyboard.press("j");
  await expect(item).toContainText("cậu");
  await expect(page.getByTestId("review-unit-doubts")).toContainText("vi-south.u04");
  await page.keyboard.press("k");
  await expect(item).toContainText("Đây là ba tôi.");
  await page.keyboard.press("a");
  await expect(page.getByRole("button", { name: /papa.*Approuvé/ })).toBeVisible();
  expect(calls.find((c) => c.path.endsWith("/documents/concept/c_ba/review"))?.body).toEqual({ verdict: "approve", comment: "" });
  // Demander une correction sans commentaire : refusé avec un message.
  await page.getByRole("button", { name: "Demander une correction" }).click();
  await expect(page.getByRole("alert")).toContainText("Écris ce qu'il faut corriger");

  // Un brouillon, puis publication.
  await page.goto("/studio/vi-south/doc/concept/c_ba");
  await page.getByRole("group", { name: "Traduction" }).getByLabel("Français").fill("papa (Sud)");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
  await page.getByRole("link", { name: "Publier" }).click();
  const panel = page.getByTestId("publish-panel");
  await panel.getByRole("checkbox", { name: /c_ba/ }).check();
  await panel.getByRole("button", { name: "Vérifier sur le serveur" }).click();
  await expect(page.getByTestId("publish-validation")).toContainText("Tout est valide");
  await panel.getByLabel("Message de publication").fill("Glose de ba précisée");
  await panel.getByRole("button", { name: "Publier (1)" }).click();
  await expect(page.getByTestId("publish-result")).toContainText("content/vi-south/concepts/c_ba.json");
  expect(calls.find((c) => c.path.endsWith("/publish"))?.body).toEqual({ documents: [{ kind: "concept", id: "c_ba" }], message: "Glose de ba précisée" });
});

test("enregistrer l'audio d'un mot : courbe, envoi multipart, fichiers produits", async ({ page }) => {
  const calls = await mockApi(page, { roles: ["reviewer"] });
  await page.goto("/studio/vi-south/doc/concept/c_ba");
  const recorder = page.getByTestId("audio-recorder");
  await recorder.getByRole("button", { name: "Enregistrer" }).click();
  await expect(recorder.getByRole("button", { name: /Arrêter/ })).toBeVisible();
  await page.waitForTimeout(2_600);
  await recorder.getByRole("button", { name: /Arrêter/ }).click();
  await expect(recorder.getByTestId("recorder-plot")).toBeVisible();
  await expect(recorder.getByTestId("recorder-summary")).toContainText("Courbe de hauteur calculée");
  await recorder.getByRole("button", { name: "Envoyer cet enregistrement" }).click();
  const result = recorder.getByTestId("recorder-result");
  await expect(result).toContainText("audio/c_ba_mai_hcm_f_slow.opus");
  await expect(result.locator("audio")).toHaveCount(2);

  const upload = calls.find((c) => c.method === "POST" && c.path.endsWith("/audio"));
  expect(upload?.raw).toContain('name="conceptId"');
  expect(upload?.raw).toContain("c_ba");
  expect(upload?.raw).toContain('name="pitch"');
  expect(upload?.raw).toContain('"hopMs"');
  expect(upload?.raw).toContain("RIFF");
});
