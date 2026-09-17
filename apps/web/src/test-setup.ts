import "fake-indexeddb/auto";

// Le bundle de packs est injecté par Vite (define) ; en test on le fixe.
(globalThis as { __PACKS__?: Record<string, number> }).__PACKS__ = { "vi-south": 1 };

// Chaînes d'interface chargées par domaine et par langue dans l'app : en test, tout est chargé d'avance.
const { ensureMessages } = await import("./i18n/index.ts");
await Promise.all([ensureMessages("all", "fr"), ensureMessages("all", "en")]);
