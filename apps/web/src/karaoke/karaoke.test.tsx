import { buildContentIndex, type ContentIndex } from "@parlo/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPackFiles, toRaw } from "../../../../scripts/lib/load-pack.ts";
import { KaraokeExercise } from "./KaraokeExercise.tsx";
import { karaokeCandidates } from "./KaraokePage.tsx";
import { loadReference, referencePath, syllableLabels } from "./reference.ts";

const content: ContentIndex = buildContentIndex(toRaw(readPackFiles("vi-south")));
afterEach(cleanup);

describe("reference", () => {
  const concept = content.concepts.get("s_chao_anh")!;

  it("chemin : pitchRef d'étape > concept.pitch > convention pitch/<id>.json", () => {
    expect(referencePath(concept, "pitch/x.json")).toBe("pitch/x.json");
    expect(referencePath(concept, null)).toBe("pitch/s_chao_anh.json");
    expect(referencePath({ ...concept, id: "c_z", pitch: undefined as never }, null)).toBe("pitch/c_z.json");
  });

  it("syllabes affichées sans ponctuation", () => {
    expect(syllableLabels("Đây là ba tôi.")).toEqual(["Đây", "là", "ba", "tôi"]);
  });

  it("fichier absent ou page HTML (repli SPA) → null ; JSON valide → référence", async () => {
    const html = vi.fn(async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
    expect(await loadReference(content, concept, "pitch/html.json", html)).toBeNull();
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    expect(await loadReference(content, concept, "pitch/missing.json", missing)).toBeNull();
    const ok = vi.fn(async () => new Response(JSON.stringify({ v: 1, hopMs: 10, st: [0, 0.5, null, -1] }), { headers: { "content-type": "application/json" } }));
    expect(await loadReference(content, concept, "pitch/ok.json", ok)).toMatchObject({ source: "file", reference: { hopMs: 10 } });
  });
});

describe("karaokeCandidates", () => {
  it("retient les concepts dont le contenu déclare une courbe", () => {
    const { all, known } = karaokeCandidates(content, new Set());
    expect(all.map((c) => c.concept.id)).toEqual(expect.arrayContaining(["s_chao_anh", "s_day_la"]));
    expect(known).toEqual([]);
  });
});

describe("KaraokeExercise", () => {
  it("sans courbe de référence : écoute non notée, « C'est fait » → score null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onSubmit = vi.fn();
    const concept = content.concepts.get("c_ma_mom")!;
    render(<KaraokeExercise content={content} concept={concept} pitchRef={null} mode="tone" tone="sac" sessionId={null} onSubmit={onSubmit} />);
    // Une consigne, pas une excuse : sans courbe, l'exercice reste utile et ne s'annonce pas
    // comme un chantier (contrat phase16 §5).
    await waitFor(() => expect(screen.getByText(/répète à voix haute|say it out loud/)).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: /C'est fait|Done/ }));
    expect(onSubmit).toHaveBeenCalledWith(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
