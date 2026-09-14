import "fake-indexeddb/auto";

// Le bundle de packs est injecté par Vite (define) ; en test on le fixe.
(globalThis as { __PACKS__?: Record<string, number> }).__PACKS__ = { "vi-south": 1 };
