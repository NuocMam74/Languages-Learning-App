import { buildContentIndex, buildExam, makeEvent, type ExamFile, type Exercise, type ExerciseResponse } from "@parlo/core";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_ROOT, readPackFiles, toRaw } from "../../../scripts/lib/load-pack.ts";

/**
 * Critère d'acceptation Phase 2 (spec §15), en intégration réelle avec l'API :
 * un utilisateur passe l'examen A0 et télécharge un diplôme vérifiable.
 * Nécessite l'API sur :8000 et `vite` en dev sur :5173 (voir integration.spec.ts).
 */
test.skip(!process.env.PARLO_INTEGRATION, "intégration réelle désactivée (PARLO_INTEGRATION)");
test.use({ baseURL: "http://localhost:5173" });

const API = "http://localhost:8000";

function rightAnswer(ex: Exercise): ExerciseResponse {
  switch (ex.type) {
    case "build_sentence": {
      const words = ex.target.replace(/[.,!?]/g, "").split(" ");
      const ids: string[] = [];
      for (let i = 0; i < words.length; ) {
        const tok = ex.tokens.find((t) => !ids.includes(t.id) && t.text !== undefined && words.slice(i, i + t.text.split(" ").length).join(" ") === t.text);
        if (!tok?.text) throw new Error(`jeton introuvable : ${words[i]}`);
        ids.push(tok.id);
        i += tok.text.split(" ").length;
      }
      return { kind: "tokens", optionIds: ids };
    }
    case "speak_repeat":
      return { kind: "speech", score: 88 };
    case "game":
    case "unsupported":
      return { kind: "skip" };
    default:
      return { kind: "choice", optionId: ex.answerId };
  }
}

test("passer l'examen A0, télécharger le diplôme et le vérifier publiquement", async ({ page, request }) => {
  const content = buildContentIndex(toRaw(readPackFiles("vi-south")));
  const exam = JSON.parse(readFileSync(join(CONTENT_ROOT, "vi-south", "exams", "a0.json"), "utf8")) as ExamFile;

  const email = `exam-${Date.now()}@parlo.app`;
  const reg = await request.post(`${API}/auth/register`, { data: { email, password: "mot-de-passe-solide", displayName: "Nguyễn Thị Lan", locale: "fr" } });
  expect(reg.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${((await reg.json()) as { accessToken: string }).accessToken}` };

  // Verrouillé tant que les tests d'unité ne sont pas faits.
  expect((await request.post(`${API}/exams/${exam.id}/start`, { headers })).status()).toBe(403);

  const unitTests = exam.requiresUnits.flatMap((u) => content.curriculum.units.find((x) => x.id === u)?.lessons ?? []).filter((id) => content.lessons.get(id)?.kind === "unit_test");
  const events = unitTests.map((lessonId) => makeEvent("lesson_completed", { sessionId: `s-${lessonId}`, lessonId, score: 0.9, durationMs: 300_000 }));
  const sync = await request.post(`${API}/me/events`, { headers, data: { events } });
  expect(((await sync.json()) as { rejected: unknown[] }).rejected).toEqual([]);

  const start = await request.post(`${API}/exams/${exam.id}/start`, { headers });
  expect(start.status()).toBe(201);
  const { attemptId, seed } = (await start.json()) as { attemptId: string; seed: string };

  const questions = buildExam(content, exam, seed);
  const answers = questions.map((q) => ({ section: q.section, index: q.index, response: rightAnswer(q.exercise), responseMs: 2500 }));
  const submit = await request.post(`${API}/exams/attempts/${attemptId}/submit`, { headers, data: { answers } });
  expect(submit.ok()).toBe(true);
  const result = (await submit.json()) as { passed: boolean; global: number; certificate: { id: string; verificationCode: string } | null };
  expect(result.passed).toBe(true);
  expect(result.global).toBe(1);
  const certificate = result.certificate!;

  const pdf = await request.get(`${API}/certificates/${certificate.id}.pdf`, { headers });
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  // Deuxième tentative immédiate : verrouillée 48 h.
  expect((await request.post(`${API}/exams/${exam.id}/start`, { headers })).status()).toBe(409);

  // Vérification publique, sans compte, depuis la PWA.
  await page.goto(`/verifier/${certificate.verificationCode}`);
  await expect(page.getByText("Nguyễn Thị Lan")).toBeVisible();
  await expect(page.getByText("Certificat authentique")).toBeVisible();
  await expect(page.getByText(/A0/).first()).toBeVisible();
  await page.goto("/verifier/ZZZZZZZZZZ");
  await expect(page.getByText("Aucun certificat ne correspond à ce code.")).toBeVisible();
});
