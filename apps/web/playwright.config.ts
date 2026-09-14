import { defineConfig, devices } from "@playwright/test";

/**
 * Parcours critiques en navigateur réel, sur le build de production
 * (le service worker n'existe qu'en build).
 * Local : PW_CHANNEL=msedge (ou chrome) évite de télécharger un navigateur.
 */
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    ...devices["Pixel 7"],
    locale: "fr-FR",
    ...(channel ? { channel } : {}),
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
