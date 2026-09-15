import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase 4 en intégration réelle : studio (rôle éditeur, brouillon, validation par le
 * validateur de la CI, publication dans CONTENT_DIR, audio) et espace enseignant
 * (classe, consentement de l'élève, devoir, tableau de bord).
 *
 * Nécessite l'API sur :8000 lancée avec STUDIO_PUBLISH_ENABLED=true et un CONTENT_DIR
 * de travail (copie jetable), et les variables DATABASE_URL / PARLO_CONTENT_DIR
 * identiques dans l'environnement du test (pour `grant-role` et la vérification des fichiers).
 */
test.skip(!process.env.PARLO_INTEGRATION || !process.env.PARLO_CONTENT_DIR, "intégration studio désactivée");
test.setTimeout(240_000);

const API = "http://localhost:8000";
const API_DIR = join(import.meta.dirname, "..", "..", "api");

async function register(request: import("@playwright/test").APIRequestContext, name: string) {
  const slug = name.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase();
  const email = `${slug}-${Date.now()}@parlo.app`;
  const res = await request.post(`${API}/auth/register`, { data: { email, password: "mot-de-passe-solide", displayName: name, locale: "fr" } });
  expect(res.ok()).toBe(true);
  return { email, headers: { Authorization: `Bearer ${((await res.json()) as { accessToken: string }).accessToken}` } };
}

function grant(email: string, role: string) {
  execFileSync("uv", ["run", "python", "-m", "app.maintenance", "grant-role", email, role], { cwd: API_DIR, env: process.env, stdio: "pipe" });
}

test("studio : brouillon, validation, publication et audio ; puis classe et devoir", async ({ request }) => {
  const editor = await register(request, "Thu");
  expect((await request.get(`${API}/studio/packs`, { headers: editor.headers })).status()).toBe(403);
  grant(editor.email, "editor");
  grant(editor.email, "reviewer");
  const h = editor.headers;

  // Brouillon d'un concept existant : glose française retouchée.
  const doc = (await (await request.get(`${API}/studio/packs/vi-south/documents/concept/c_ba`, { headers: h })).json()) as { published: Record<string, unknown> };
  const data = { ...doc.published, gloss: { fr: "papa (ba)", en: "dad" } };
  const saved = await request.put(`${API}/studio/packs/vi-south/documents/concept/c_ba`, { headers: h, data: { data, baseUpdatedAt: null } });
  expect(saved.ok()).toBe(true);
  let base = ((await saved.json()) as { updatedAt: string }).updatedAt;
  const put = async (body: unknown) => {
    const res = await request.put(`${API}/studio/packs/vi-south/documents/concept/c_ba`, { headers: h, data: { data: body, baseUpdatedAt: base } });
    expect(res.ok()).toBe(true);
    base = ((await res.json()) as { updatedAt: string }).updatedAt;
  };
  // Conflit : base périmée.
  const stale = await request.put(`${API}/studio/packs/vi-south/documents/concept/c_ba`, { headers: h, data: { data, baseUpdatedAt: "2000-01-01T00:00:00Z" } });
  expect(stale.status()).toBe(409);

  // Une forme du Nord dans un brouillon est bloquée par la garde du Sud, validation et publication comprises.
  const bad = { ...data, examples: [{ vi: "Đây là bố tôi.", fr: "Voici mon père." }] };
  await put(bad);
  const invalid = (await (await request.post(`${API}/studio/packs/vi-south/validate`, { headers: h })).json()) as { errors: { message: string }[] };
  expect(invalid.errors.some((e) => e.message.includes("forme du Nord"))).toBe(true);
  expect((await request.post(`${API}/studio/packs/vi-south/publish`, { headers: h, data: { documents: [{ kind: "concept", id: "c_ba" }], message: "test" } })).status()).toBe(422);
  await put(data);

  const valid = (await (await request.post(`${API}/studio/packs/vi-south/validate`, { headers: h })).json()) as { errors: unknown[] };
  expect(valid.errors).toEqual([]);

  // Audio : un « enregistrement » synthétique, traité par le pipeline ffmpeg du serveur.
  const wav = join(mkdtempSync(join(tmpdir(), "parlo-studio-")), "ba.wav");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=200:duration=1", "-af", "adelay=400|400,apad=pad_dur=0.4", "-ar", "48000", "-ac", "1", wav]);
  const upload = await request.post(`${API}/studio/packs/vi-south/audio`, {
    headers: h,
    multipart: { file: { name: "ba.wav", mimeType: "audio/wav", buffer: readFileSync(wav) }, conceptId: "c_ba", voice: "mai_hcm_f" },
  });
  expect(upload.ok()).toBe(true);
  const files = ((await upload.json()) as { files: { path: string }[] }).files.map((f) => f.path);
  expect(files.some((p) => p.endsWith("_slow.opus"))).toBe(true);

  const review = await request.post(`${API}/studio/packs/vi-south/documents/concept/c_ba/review`, { headers: h, data: { verdict: "approve", comment: "Relu." } });
  expect(review.ok()).toBe(true);

  const publish = await request.post(`${API}/studio/packs/vi-south/publish`, { headers: h, data: { documents: [{ kind: "concept", id: "c_ba" }], message: "Relecture de c_ba" } });
  expect(publish.ok()).toBe(true);
  const contentDir = process.env.PARLO_CONTENT_DIR ?? "";
  const written = JSON.parse(readFileSync(join(contentDir, "vi-south", "concepts", "c_ba.json"), "utf8")) as { gloss: { fr: string }; reviewed: boolean; audio: { source: string }[] };
  expect(written.gloss.fr).toBe("papa (ba)");
  expect(written.reviewed).toBe(true);
  expect(written.audio.some((a) => a.source === "native")).toBe(true);
  expect(existsSync(join(contentDir, "vi-south", files.find((p) => p.endsWith(".opus"))!))).toBe(true);

  // Espace enseignant.
  const teacher = await register(request, "Cô Hạnh");
  grant(teacher.email, "teacher");
  const cls = (await (await request.post(`${API}/classes`, { headers: teacher.headers, data: { name: "Vietnamien A0 — mardi", packCode: "vi-south" } })).json()) as { id: string; joinCode: string };
  const student = await register(request, "Lan");
  expect((await request.post(`${API}/classes/join/${cls.joinCode}`, { headers: student.headers, data: { consent: false } })).status()).toBe(400);
  expect((await request.post(`${API}/classes/join/${cls.joinCode}`, { headers: student.headers, data: { consent: true } })).ok()).toBe(true);
  const assign = await request.post(`${API}/classes/${cls.id}/assignments`, { headers: teacher.headers, data: { title: "Les tons", lessonIds: ["vi-south.u01.l01", "vi-south.u01.l02"], dueDate: "2026-09-25" } });
  expect(assign.status()).toBe(201);
  const detail = (await (await request.get(`${API}/classes/${cls.id}`, { headers: teacher.headers })).json()) as { students: Record<string, unknown>[] };
  expect(detail.students).toHaveLength(1);
  expect(JSON.stringify(detail)).not.toContain("@parlo.app"); // jamais l'email
  const mine = (await (await request.get(`${API}/me/classes`, { headers: student.headers })).json()) as { assignments: { total: number }[] }[];
  expect(mine[0]?.assignments[0]?.total).toBe(2);
});
