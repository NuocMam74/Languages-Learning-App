import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import { installChunkRecovery } from "./pwa/chunk-recovery.tsx";
import { captureInstallPrompt } from "./pwa/install.ts";
import { usePwaUpdate } from "./pwa/update.ts";
import "./app.css";

// Invite d'installation Android et chunks périmés : écoutés avant le premier rendu.
captureInstallPrompt();
installChunkRecovery();

// registerType "prompt" : une nouvelle version attend et s'annonce (UpdatePrompt), activée à la demande.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    usePwaUpdate.getState().offer(() => updateSW(true));
  },
  onRegisteredSW(_url, registration) {
    // App installée gardée ouverte des jours : vérification horaire d'une nouvelle version.
    if (registration) setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root introuvable");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
