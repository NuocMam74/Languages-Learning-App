import { describe, expect, it } from "vitest";
import { deriveRating, isDue, isMastered, mergeCards, newCard, review } from "./srs.ts";

const T0 = new Date("2026-09-01T08:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

describe("srs", () => {
  it("une carte neuve n'est pas due tant qu'elle n'a pas été vue", () => {
    const card = newCard("c_ba", T0);
    expect(card.state).toBe("new");
    expect(isDue(card, days(10))).toBe(false);
  });

  it("une réussite repousse l'échéance, un échec la rapproche", () => {
    const good = review(newCard("c_ba", T0), "easy", T0);
    const again = review(newCard("c_ba", T0), "again", T0);
    expect(Date.parse(good.due)).toBeGreaterThan(Date.parse(again.due));
    expect(good.reps).toBe(1);
    expect(good.lastReview).toBe(T0.toISOString());
  });

  it("est sérialisable en JSON sans perte", () => {
    const card = review(newCard("c_ba", T0), "good", T0);
    const back = JSON.parse(JSON.stringify(card)) as typeof card;
    expect(review(back, "good", days(3))).toEqual(review(card, "good", days(3)));
  });

  it("devient due puis maîtrisée après des réussites espacées", () => {
    let card = review(newCard("c_ba", T0), "easy", T0);
    let now = T0;
    for (let i = 0; i < 6; i++) {
      now = new Date(Date.parse(card.due));
      expect(isDue(card, now)).toBe(true);
      card = review(card, "good", now);
    }
    expect(isMastered(card)).toBe(true);
  });

  it("mergeCards : l'état le plus avancé gagne, dans les deux sens", () => {
    const a = review(newCard("c_ba", T0), "good", T0);
    const b = review(a, "good", days(1));
    expect(mergeCards(a, b)).toBe(b);
    expect(mergeCards(b, a)).toBe(b);
  });

  it("mergeCards : à reps égales, la révision la plus récente gagne", () => {
    const a = review(newCard("c_ba", T0), "good", T0);
    const b = review(newCard("c_ba", T0), "hard", days(1));
    expect(mergeCards(a, b)).toBe(b);
  });
});

describe("deriveRating", () => {
  it("échec → again, erreur de ton seule → hard", () => {
    expect(deriveRating({ correct: false, responseMs: 1000, format: "listen_pick_text" })).toBe("again");
    expect(deriveRating({ correct: false, nearMiss: true, responseMs: 1000, format: "listen_pick_text" })).toBe("hard");
  });

  it("réponse très lente → hard", () => {
    expect(deriveRating({ correct: true, responseMs: 30_000, format: "tone_identify" })).toBe("hard");
  });

  it("un QCM réussi ne vaut jamais easy ; une production rapide oui", () => {
    expect(deriveRating({ correct: true, responseMs: 500, format: "listen_pick_image" })).toBe("good");
    expect(deriveRating({ correct: true, responseMs: 3000, format: "speak_repeat" })).toBe("easy");
  });
});
