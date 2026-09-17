import { describe, expect, it } from "vitest";
import {
  activeDays,
  emptySkillStats,
  normalizeSkillStats,
  pruneSkillStats,
  recordSkillAnswer,
  skillLevel,
  skillOfStep,
  SKILL_OF_STEP,
  SKILL_WINDOW_DAYS,
  SKILLS,
  skillSummary,
  type SkillStats,
} from "./skills.ts";
import type { LessonStep, StepType } from "./types.ts";

/** Tous les types d'étape du moteur, écrits à la main : un nouveau type fait échouer ce test. */
const ALL_STEP_TYPES: StepType[] = [
  "culture_card",
  "listen_pick_image",
  "listen_pick_text",
  "listen_transcribe",
  "tone_identify",
  "tone_minimal_pair",
  "tone_produce",
  "speak_repeat",
  "listen_gist",
  "speak_answer",
  "speak_roleplay",
  "dialogue_choice",
  "match_pairs",
  "build_sentence",
  "fill_gap",
  "translate_to_vi",
  "translate_to_fr",
  "spot_the_south",
  "game",
];

/** Vérification de type : la liste ci-dessus couvre exactement `StepType`. */
type Covered = (typeof ALL_STEP_TYPES)[number];
const _exhaustive: Record<StepType, Covered> = Object.fromEntries(ALL_STEP_TYPES.map((t) => [t, t])) as Record<StepType, Covered>;

const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}`;

describe("SKILL_OF_STEP", () => {
  it("couvre tous les types d'étape, une seule compétence par type", () => {
    expect(Object.keys(SKILL_OF_STEP).sort()).toEqual([...ALL_STEP_TYPES].sort());
    for (const type of ALL_STEP_TYPES) expect(SKILLS).toContain(skillOfStep(type));
    expect(Object.keys(_exhaustive)).toHaveLength(ALL_STEP_TYPES.length);
  });

  it("respecte le découpage du contrat", () => {
    expect(skillOfStep("listen_pick_text")).toBe("listening");
    expect(skillOfStep("tone_identify")).toBe("listening");
    expect(skillOfStep("tone_minimal_pair")).toBe("listening");
    expect(skillOfStep("listen_gist")).toBe("listening");
    expect(skillOfStep("fill_gap")).toBe("reading");
    expect(skillOfStep("translate_to_fr")).toBe("reading");
    expect(skillOfStep("spot_the_south")).toBe("reading");
    expect(skillOfStep("build_sentence")).toBe("reading");
    expect(skillOfStep("match_pairs")).toBe("vocabulary");
    expect(skillOfStep("listen_pick_image")).toBe("vocabulary");
    expect(skillOfStep("translate_to_vi")).toBe("vocabulary");
    expect(skillOfStep("culture_card")).toBe("vocabulary");
    expect(skillOfStep("speak_repeat")).toBe("speaking");
    expect(skillOfStep("tone_produce")).toBe("speaking");
    expect(skillOfStep("dialogue_choice")).toBe("speaking");
  });

  it("accepte le type d'une étape du contenu sans conversion", () => {
    const step: LessonStep = { type: "match_pairs", concepts: [] };
    expect(skillOfStep(step.type)).toBe("vocabulary");
  });
});

describe("skillSummary", () => {
  it("part d'un état vide : quatre lignes, aucun ratio", () => {
    const summary = skillSummary(emptySkillStats());
    expect(summary.map((s) => s.skill)).toEqual([...SKILLS]);
    for (const line of summary) {
      expect(line).toMatchObject({ correct: 0, total: 0, ratio: null, level: "none", lifetime: 0 });
    }
  });

  it("agrège les réponses de plusieurs jours", () => {
    let stats = emptySkillStats();
    for (let i = 0; i < 8; i++) stats = recordSkillAnswer(stats, "listen_pick_text", i < 6, day(1));
    for (let i = 0; i < 4; i++) stats = recordSkillAnswer(stats, "listen_transcribe", true, day(2));
    const listening = skillSummary(stats).find((s) => s.skill === "listening");
    expect(listening).toMatchObject({ correct: 10, total: 12, lifetime: 12 });
    expect(listening?.ratio).toBeCloseTo(10 / 12);
    // 12 items, 83 % : solide (≥ 60 %, < 85 %).
    expect(listening?.level).toBe("solid");
  });

  it("ajoute les résultats d'examen au même dénominateur", () => {
    let stats = emptySkillStats();
    for (let i = 0; i < 10; i++) stats = recordSkillAnswer(stats, "speak_repeat", true, day(3));
    const withExam = skillSummary(stats, [{ skill: "speaking", score: 0.5, items: 10 }]);
    const speaking = withExam.find((s) => s.skill === "speaking");
    expect(speaking).toMatchObject({ correct: 15, total: 20, level: "solid" });
    // Un examen sans nombre d'items pèse un item.
    const single = skillSummary(emptySkillStats(), [{ skill: "reading", score: 1 }]).find((s) => s.skill === "reading");
    expect(single).toMatchObject({ correct: 1, total: 1, level: "new" });
  });

  it("borne un score d'examen hors [0,1]", () => {
    const [listening] = skillSummary(emptySkillStats(), [{ skill: "listening", score: 3, items: 4 }]);
    expect(listening).toMatchObject({ skill: "listening", correct: 4, total: 4 });
    const low = skillSummary(emptySkillStats(), [{ skill: "listening", score: -1, items: 4 }])[0];
    expect(low).toMatchObject({ correct: 0, total: 4 });
  });
});

describe("niveaux", () => {
  it("classe selon le volume puis le taux", () => {
    expect(skillLevel({ correct: 0, total: 0 })).toBe("none");
    expect(skillLevel({ correct: 9, total: 9 })).toBe("new");
    expect(skillLevel({ correct: 5, total: 10 })).toBe("fragile");
    expect(skillLevel({ correct: 6, total: 10 })).toBe("solid");
    expect(skillLevel({ correct: 84, total: 100 })).toBe("solid");
    expect(skillLevel({ correct: 85, total: 100 })).toBe("strong");
  });
});

describe("fenêtre de 60 jours", () => {
  it("garde au plus 60 jours et oublie les plus anciens", () => {
    let stats = emptySkillStats();
    for (let i = 0; i < 90; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + i));
      stats = recordSkillAnswer(stats, "fill_gap", true, date.toISOString().slice(0, 10));
    }
    const days = Object.keys(stats.byDay);
    expect(days).toHaveLength(SKILL_WINDOW_DAYS);
    // 90 jours écrits, les 60 derniers gardés : du 31 janvier au 31 mars.
    expect(days.sort()[0]).toBe("2026-01-31");
    expect(days.sort().at(-1)).toBe("2026-03-31");
    const reading = skillSummary(stats).find((s) => s.skill === "reading");
    // La fenêtre ne compte que 60 jours ; le volume total en garde 90.
    expect(reading).toMatchObject({ total: SKILL_WINDOW_DAYS, lifetime: 90 });
  });

  it("ne supprime rien tant que la fenêtre n'est pas pleine", () => {
    let stats = emptySkillStats();
    for (let i = 1; i <= 10; i++) stats = recordSkillAnswer(stats, "match_pairs", true, day(i));
    expect(Object.keys(stats.byDay)).toHaveLength(10);
    expect(pruneSkillStats(stats, day(10))).toBe(stats);
  });

  it("garde les jours futurs (horloge de l'appareil en avance)", () => {
    let stats = emptySkillStats();
    stats = recordSkillAnswer(stats, "match_pairs", true, "2027-01-01");
    stats = recordSkillAnswer(stats, "match_pairs", true, day(1));
    expect(Object.keys(stats.byDay).sort()).toEqual([day(1), "2027-01-01"]);
  });

  it("compte les jours actifs", () => {
    let stats = emptySkillStats();
    stats = recordSkillAnswer(stats, "match_pairs", true, day(1));
    stats = recordSkillAnswer(stats, "match_pairs", false, day(1));
    stats = recordSkillAnswer(stats, "speak_repeat", true, day(4));
    expect(activeDays(stats)).toBe(2);
  });
});

describe("normalizeSkillStats", () => {
  it("accepte une valeur absente ou abîmée", () => {
    expect(normalizeSkillStats(undefined)).toEqual(emptySkillStats());
    expect(normalizeSkillStats({ bySkill: { nope: { correct: 1, total: 1 } }, byDay: { "pas-un-jour": {} } })).toEqual(emptySkillStats());
  });

  it("conserve les compteurs connus et remet les négatifs à zéro", () => {
    const raw = { bySkill: { listening: { correct: -3, total: 5 } }, byDay: { "2026-03-01": { listening: { correct: 2, total: 5 } } } } as unknown;
    const stats = normalizeSkillStats(raw) satisfies SkillStats;
    expect(stats.bySkill.listening).toEqual({ correct: 0, total: 5 });
    expect(skillSummary(stats).find((s) => s.skill === "listening")).toMatchObject({ correct: 2, total: 5, level: "new" });
  });
});
