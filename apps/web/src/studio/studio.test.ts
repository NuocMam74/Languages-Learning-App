import { beforeAll, describe, expect, it } from "vitest";
import { usePrefs } from "../prefs.ts";
import type { Concept, Lesson } from "@parlo/core";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { doubtsFor, unitsOf } from "./doubts.ts";
import { applyTelexKey, telexInput, telexToVietnamese } from "./telex.ts";
import { issuesAt, overlay, schemaIssues, southIssues, validateDraft, contentIssuePath } from "./validation.ts";
import { decodeWav, encodeWav, findVoiceBounds, resample, trimSilence } from "./wav.ts";

describe("Telex", () => {
  it.each([
    ["tieengs vieetj", "tiếng việt"],
    ["tieesng", "tiếng"],
    ["hoafn", "hoàn"],
    ["dduwowcj", "được"],
    ["nguwowif", "người"],
    ["hoaf", "hòa"],
    ["khoer", "khỏe"],
    ["toans", "toán"],
    ["quas", "quá"],
    ["gif", "gì"],
    ["giaf", "già"],
    ["chaof anh", "chào anh"],
    ["Vieetj Nam", "Việt Nam"],
    ["ddaau", "đâu"],
    ["mawcj", "mặc"],
    ["w", "ư"],
    ["ass", "as"],
    ["aaa", "aa"],
    ["mas", "má"],
    ["mafz", "ma"],
    ["masf", "mà"],
  ])("%s → %s", (typed, expected) => {
    expect(telexToVietnamese(typed)).toBe(expected);
  });

  it("résultat toujours en NFC", () => {
    const out = telexToVietnamese("nguwowif");
    expect(out).toBe(out.normalize("NFC"));
  });

  it("une lettre sans commande n'est pas transformée", () => {
    expect(applyTelexKey("b", "a")).toBeNull();
    expect(applyTelexKey("", "s")).toBeNull();
  });

  it("saisie en direct : convertit le mot sous le curseur et replace le curseur", () => {
    expect(telexInput("Đây là ba", "Đây là bas", 10)).toEqual({ value: "Đây là bá", caret: 9 });
    // Frappe au milieu du texte.
    expect(telexInput("ma anh", "mas anh", 3)).toEqual({ value: "má anh", caret: 2 });
    // Collage (plusieurs caractères) : rien.
    expect(telexInput("ma", "ma anh", 6)).toBeNull();
  });
});

describe("WAV", () => {
  it("encode puis relit un PCM mono 48 kHz", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = encodeWav(samples, 48_000);
    expect(buffer.byteLength).toBe(44 + samples.length * 2);
    const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
    expect(header).toBe("RIFF");
    const decoded = decodeWav(buffer);
    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.channels).toBe(1);
    expect(decoded.samples.length).toBe(5);
    expect(decoded.samples[1]).toBeCloseTo(0.5, 3);
    expect(decoded.samples[4]).toBeCloseTo(-1, 3);
  });

  it("retire le silence de tête et de queue en gardant une marge", () => {
    const rate = 48_000;
    const signal = new Float32Array(rate * 2);
    for (let i = rate * 0.5; i < rate * 1.2; i++) signal[i] = 0.3 * Math.sin((2 * Math.PI * 200 * i) / rate);
    const bounds = findVoiceBounds(signal, rate, { padMs: 100 });
    expect(bounds).not.toBeNull();
    expect(bounds!.start / rate).toBeCloseTo(0.4, 1);
    expect(bounds!.end / rate).toBeCloseTo(1.3, 1);
    expect(trimSilence(new Float32Array(rate), rate).length).toBe(0);
  });

  it("rééchantillonne 44,1 → 48 kHz", () => {
    const out = resample(new Float32Array(44_100), 44_100, 48_000);
    expect(out.length).toBe(48_000);
  });
});

describe("validation du brouillon", () => {
  // Messages dans la langue d'interface : ces assertions portent sur le français (jsdom annonce en-US).
  beforeAll(() => usePrefs.setState({ locale: "fr" }));
  const raw = toRaw(readPackFiles("vi-south"));
  const concept = raw.concepts.find((c) => c.id === "c_ba") as Concept;
  const lesson = raw.lessons.find((l) => l.id === "vi-south.u01.l01") as Lesson;

  it("superpose le brouillon au pack publié", () => {
    const edited = { ...concept, vi: "ba ơi" };
    const next = overlay(raw, "concept", "c_ba", edited);
    expect(next.concepts.filter((c) => c.id === "c_ba")).toEqual([edited]);
    expect(next.concepts.length).toBe(raw.concepts.length);
    expect(raw.concepts.find((c) => c.id === "c_ba")?.vi).toBe("ba");
  });

  it("le contenu publié est valide", () => {
    expect(validateDraft({ raw }, "concept", "c_ba", concept).filter((i) => i.level === "error")).toEqual([]);
    expect(validateDraft({ raw }, "lesson", lesson.id, lesson).filter((i) => i.level === "error")).toEqual([]);
  });

  it("erreurs de schéma rattachées au champ, en français", () => {
    const { gloss: _gloss, ...rest } = concept;
    const issues = schemaIssues("concept", { ...rest, id: "Ba", gloss: { en: "dad" } });
    expect(issuesAt(issues, "id")[0]?.message).toMatch(/Identifiant de mot/);
    expect(issuesAt(issues, "gloss.fr")[0]?.message).toBe("Ce champ est obligatoire.");
  });

  it("erreur d'étape de leçon rattachée au champ de l'étape", () => {
    const steps = lesson.steps.map((s, i) => (i === 3 ? { type: "tone_identify", concept: "not an id" } : s));
    const issues = schemaIssues("lesson", { ...lesson, steps });
    expect(issuesAt(issues, "steps.3.concept").length).toBe(1);
  });

  it("contrôle sémantique : ton incohérent avec l'orthographe", () => {
    const issues = validateDraft({ raw }, "concept", "c_ba", { ...concept, tone: "sac" });
    expect(issuesAt(issues, "tone")[0]?.message).toMatch(/ne correspond pas/);
  });

  it("contrôle sémantique : étape rattachée à steps.N", () => {
    const steps = lesson.steps.map((s, i) => (i === 5 ? { type: "listen_pick_text", concept: "c_ma_mom", distractors: ["má"] } : s));
    const issues = validateDraft({ raw }, "lesson", lesson.id, { ...lesson, steps });
    expect(issuesAt(issues, "steps.5").some((i) => /identique/.test(i.message))).toBe(true);
  });

  it("garde du Sud sur les champs vietnamiens (pas sur northernEquivalent)", () => {
    const issues = southIssues("concept", { ...concept, vi: "bố", northernEquivalent: "bố" }, raw.variants);
    expect(issues.map((i) => i.path)).toEqual(["vi"]);
    expect(issues[0]?.message).toMatch(/forme du Nord/);
  });

  it("chemins des problèmes d'examen et NFC", () => {
    const exam = { id: "vi-south.exam.a0", sections: [{ skill: "listening" }, { skill: "reading" }] };
    expect(contentIssuePath({ level: "error", where: "vi-south.exam.a0 reading[2] (fill_gap)", message: "x" }, "exam", exam.id, exam)).toBe("sections.1.items.2.step");
    expect(contentIssuePath({ level: "error", where: "c_ba", message: "Chaîne non NFC en examples[0].vi" }, "concept", "c_ba", concept)).toBe("examples.0.vi");
  });
});

describe("doutes de relecture", () => {
  const raw = toRaw(readPackFiles("vi-south"));
  const file = { "vi-south.u01": ["doute d'unité"], c_ba: ["doute du mot"], _general: ["doute général"] };

  it("unités d'un document", () => {
    expect(unitsOf("lesson", "vi-south.u04.l02", raw)).toEqual(["vi-south.u04"]);
    expect(unitsOf("concept", "c_ma_mom", raw)).toContain("vi-south.u01");
  });

  it("regroupe doutes du document (sans doublon), de l'unité et généraux", () => {
    const groups = doubtsFor(file, "lesson", "vi-south.u01.l01", ["doute serveur"], raw);
    expect(groups.own).toEqual(["doute serveur"]);
    expect(groups.units).toEqual([{ unit: "vi-south.u01", doubts: ["doute d'unité"] }]);
    expect(groups.general).toEqual([{ group: "general", doubts: ["doute général"] }]);
    expect(doubtsFor(file, "concept", "c_ba", ["doute du mot"], raw).own).toEqual(["doute du mot"]);
  });
});
