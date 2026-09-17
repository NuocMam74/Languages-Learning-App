import { evaluate, sessionPhase, splitPack, type ContentIndex, type Exercise, type ExerciseResponse, type SessionRun } from "@parlo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackBundle } from "../../../../scripts/lib/load-pack.ts";
import { checkContentUpdate, ensureUnits, loadPack, UnitUnavailableError } from "../content.ts";
import { offlineKey, ParloDB, setDb, unitKey } from "../db.ts";
import { openSession, saveLessonPart, submitSessionAnswer } from "../learner.ts";
import { exerciseFor } from "../session-store.ts";
import { downloadUnit, enforceOfflineQuota, removeOfflineUnit, unitSize } from "./downloads.ts";

/** Contenu découpé côté client : démarrage sur core.json, unités à la demande, hors ligne explicite, quota LRU. */

const bundle = readPackBundle("vi-south");

function server(version = 1, log: string[] = []) {
  const files = { ...bundle, pack: { ...bundle.pack, version } };
  const { core, units } = splitPack(files, { mediaSize: () => 10_000 });
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    log.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    if (url.includes("/manifest") || url.endsWith("/latest.json")) return json({ code: "vi-south", version });
    if (url.endsWith(`/v${version}/core.json`)) return json(core);
    const unit = new RegExp(`/v${version}/units/(.+)\\.json$`).exec(url);
    if (unit) {
      const file = units.find((u) => u.unit === decodeURIComponent(unit[1] ?? ""));
      return file ? json(file) : new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, core, units, log };
}

const offline = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;

function answer(ex: Exercise): ExerciseResponse {
  if (ex.type === "speak_repeat" || ex.type === "tone_produce") return { kind: "speech", score: null };
  if (!("answerId" in ex)) return { kind: "skip" };
  return { kind: "choice", optionId: ex.answerId };
}

async function playSome(content: ContentIndex, start: SessionRun, n: number): Promise<SessionRun> {
  let run = start;
  for (let i = 0; i < n; i++) {
    const phase = sessionPhase(run, content);
    if (phase.kind === "recap") break;
    if (phase.kind === "save_lesson") {
      run = await saveLessonPart(content, run);
      continue;
    }
    const ex = exerciseFor(content, run, phase)!;
    run = await submitSessionAnswer(content, run, ex, evaluate(ex, answer(ex)), 1000);
  }
  return run;
}

let name = "";
beforeEach(() => {
  name = `parlo-offline-${Math.random()}`;
  setDb(new ParloDB(name));
});
afterEach(() => {
  setDb(null);
  localStorage.removeItem("parlo.offlineQuotaBytes");
});

describe("démarrage sur core.json, unités à la demande", () => {
  it("le hub n'a besoin que du core ; ouvrir une leçon charge son unité (une seule requête), gardée pour le hors ligne", async () => {
    const { fetchImpl, log } = server();
    const content = await loadPack("vi-south", fetchImpl);
    expect(log.filter((u) => u.includes("/units/"))).toEqual([]);
    expect(content.lessons.get("vi-south.u01.l01")?.steps).toEqual([]);

    // Deux demandes simultanées : un seul téléchargement.
    await Promise.all([ensureUnits(content, ["vi-south.u01"]), ensureUnits(content, ["vi-south.u01"])]);
    expect(log.filter((u) => u.endsWith("/units/vi-south.u01.json"))).toHaveLength(1);

    const run = await openSession(content, { source: "lesson", lessonId: "vi-south.u01.l02" });
    expect(run.lesson?.queue.length).toBeGreaterThan(0);
    const played = await playSome(content, run, 3);
    expect(played.lesson?.cursor).toBeGreaterThan(0);

    // Redémarrage sans réseau : core et unité visitée viennent d'IndexedDB.
    setDb(new ParloDB(name));
    const again = await loadPack("vi-south", offline);
    const resumed = await openSession(again, { source: "lesson", lessonId: "vi-south.u01.l02" });
    expect(again.lessons.get("vi-south.u01.l02")?.steps.length).toBeGreaterThan(0);
    expect(exerciseFor(again, resumed, sessionPhase(resumed, again))).not.toBeNull();
  });

  it("hors ligne, une leçon d'une unité jamais chargée ni téléchargée : UnitUnavailableError", async () => {
    const { fetchImpl } = server();
    await loadPack("vi-south", fetchImpl);
    setDb(new ParloDB(name));
    const content = await loadPack("vi-south", offline);
    await expect(openSession(content, { source: "lesson", lessonId: "vi-south.u05.l01" })).rejects.toBeInstanceOf(UnitUnavailableError);
    // Au mieux : rien ne casse, l'unité reste en résumé.
    expect(await ensureUnits(content, ["vi-south.u05"], { optional: true })).toEqual(["vi-south.u05"]);
  });

  it("ancien bundle stocké (avant le découpage) : découpé localement, toutes les unités restent hors ligne", async () => {
    const d = new ParloDB(name);
    setDb(d);
    await d.packs.put({ code: "vi-south", version: 1, files: bundle, fetchedAt: "" });
    const content = await loadPack("vi-south", offline);
    expect(content.split).toBeDefined();
    expect((await d.packs.get("vi-south"))?.core).toBeDefined();
    expect((await d.packs.get("vi-south"))?.files).toBeUndefined();
    expect(await d.units.count()).toBe(content.split!.units.size);
    await ensureUnits(content, ["vi-south.u07"]);
    expect(content.lessons.get("vi-south.u07.l01")?.steps.length).toBeGreaterThan(0);
  });

  it("ancien serveur sans core.json : bundle.json relu et découpé", async () => {
    const legacy = (async (input: string | URL | Request) =>
      String(input).endsWith("/bundle.json") ? new Response(JSON.stringify(bundle), { headers: { "Content-Type": "application/json" } }) : new Response("", { status: 404 })) as typeof fetch;
    const content = await loadPack("vi-south", legacy);
    await ensureUnits(content, ["vi-south.u02"]);
    expect(content.lessons.get("vi-south.u02.l01")?.steps.length).toBeGreaterThan(0);
  });
});

describe("mise à jour du contenu (contrat phase5 §6) avec unités", () => {
  it("séance en cours sur v1 : v2 attend, la séance reprend avec les unités v1 ; ensuite v2 s'applique et v1 est nettoyée", async () => {
    const v1 = server(1);
    const d = new ParloDB(name);
    setDb(d);
    const content = await loadPack("vi-south", v1.fetchImpl);
    const run = await playSome(content, await openSession(content, { source: "lesson", lessonId: "vi-south.u01.l01" }), 2);

    const v2 = server(2);
    expect(await checkContentUpdate("vi-south", v2.fetchImpl)).toBe("pending");
    setDb(new ParloDB(name));
    const reopened = await loadPack("vi-south", offline);
    expect(reopened.pack.version).toBe(1);
    const resumed = await openSession(reopened, { source: "lesson", lessonId: "vi-south.u01.l01" });
    expect(resumed.sessionId).toBe(run.sessionId);
    expect(resumed.lesson?.cursor).toBe(run.lesson?.cursor);

    // Séance terminée (snapshot retiré) : v2 appliquée au chargement suivant, unités v1 retirées.
    const db2 = new ParloDB(name);
    setDb(db2);
    await db2.snapshot.clear();
    const updated = await loadPack("vi-south", v2.fetchImpl);
    expect(updated.pack.version).toBe(2);
    await ensureUnits(updated, ["vi-south.u01"]);
    await new Promise((r) => setTimeout(r, 50));
    expect((await db2.units.toArray()).every((u) => u.version === 2)).toBe(true);
    expect(await db2.units.get(unitKey("vi-south", 2, "vi-south.u01"))).toBeDefined();
  });

  it("occupé (séance affichée) : la nouvelle version attend même sans snapshot", async () => {
    await loadPack("vi-south", server(1).fetchImpl);
    expect(await checkContentUpdate("vi-south", server(3).fetchImpl, () => true)).toBe("pending");
  });
});

describe("unités hors ligne : taille, téléchargement, quota LRU", () => {
  it("taille annoncée = JSON de l'unité + médias présents", async () => {
    const { fetchImpl, core } = server();
    const content = await loadPack("vi-south", fetchImpl);
    const entry = core.units.find((u) => u.id === "vi-south.u01")!;
    expect(unitSize(content, "vi-south.u01")).toBe(entry.bytes + entry.mediaBytes);
    expect(unitSize(content, "inconnue")).toBeNull();
  });

  it("téléchargement puis purge des moins récemment utilisées au-delà du quota, jamais l'unité en cours", async () => {
    const { fetchImpl } = server();
    const d = new ParloDB(name);
    setDb(d);
    await loadPack("vi-south", fetchImpl);
    const first = await downloadUnit("vi-south", 1, "vi-south.u01");
    expect(first.status).toBe("ready");
    expect(first.bytes).toBeGreaterThan(0);
    await d.offlineUnits.update(offlineKey("vi-south", "vi-south.u01"), { lastUsedAt: "2026-01-01T00:00:00.000Z" });
    await downloadUnit("vi-south", 1, "vi-south.u02");
    await d.offlineUnits.update(offlineKey("vi-south", "vi-south.u02"), { lastUsedAt: "2026-01-02T00:00:00.000Z" });
    await downloadUnit("vi-south", 1, "vi-south.u03");

    // Quota d'une seule unité : u01 (la plus ancienne) est l'unité en cours, donc u02 part d'abord.
    const quota = (await d.offlineUnits.get(offlineKey("vi-south", "vi-south.u03")))!.bytes + 1;
    const removed = await enforceOfflineQuota("vi-south", ["vi-south.u01", "vi-south.u03"], quota);
    expect(removed).toEqual(["vi-south.u02"]);
    expect(await d.offlineUnits.get(offlineKey("vi-south", "vi-south.u02"))).toBeUndefined();
    expect(await d.units.get(unitKey("vi-south", 1, "vi-south.u02"))).toBeUndefined();

    // Quota réglé très bas (localStorage) : un téléchargement purge tout sauf les unités protégées.
    localStorage.setItem("parlo.offlineQuotaBytes", "1");
    await downloadUnit("vi-south", 1, "vi-south.u04", { protect: ["vi-south.u01"] });
    expect((await d.offlineUnits.toArray()).map((r) => r.unit).sort()).toEqual(["vi-south.u01", "vi-south.u04"]);

    await removeOfflineUnit("vi-south", "vi-south.u04");
    expect(await d.offlineUnits.get(offlineKey("vi-south", "vi-south.u04"))).toBeUndefined();
  });

  it("une unité téléchargée se joue hors ligne sans avoir été visitée", async () => {
    const { fetchImpl } = server();
    await loadPack("vi-south", fetchImpl);
    await downloadUnit("vi-south", 1, "vi-south.u03");
    setDb(new ParloDB(name));
    const content = await loadPack("vi-south", offline);
    const run = await openSession(content, { source: "lesson", lessonId: "vi-south.u03.l01" });
    expect(exerciseFor(content, run, sessionPhase(run, content))).not.toBeNull();
  });
});
