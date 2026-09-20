import { defineConfig, devices } from "@playwright/test";

/**
 * Parcours critiques en navigateur réel, sur le build de production
 * (le service worker n'existe qu'en build).
 * Local : PW_CHANNEL=msedge (ou chrome) évite de télécharger un navigateur.
 */
const channel = process.env.PW_CHANNEL;
// Port dédié aux tests : 5173 et 8000 restent à la personne qui développe (PW_PORT=4901 en revue design).
const port = Number(process.env.PW_PORT ?? 4173);

/*
 * Sortie des artefacts (traces, captures). Par défaut `test-results/` dans le dépôt, comme
 * Playwright l'entend. `PW_OUTPUT_DIR` la déplace ailleurs — utile quand la copie de travail est
 * dans un dossier **synchronisé** (OneDrive, Dropbox) : le client de synchronisation verrouille et
 * déplace les fichiers pendant que Playwright les écrit, ce qui fait échouer une trace, puis tomber
 * le serveur de prévisualisation, puis tous les tests suivants. Rien à voir avec l'application.
 *
 *   PW_OUTPUT_DIR="$TEMP/parlo-e2e" npx playwright test
 */
const outputDir = process.env.PW_OUTPUT_DIR;

export default defineConfig({
  testDir: "e2e",
  ...(outputDir ? { outputDir } : {}),
  timeout: 90_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices["Pixel 7"],
    locale: "fr-FR",
    ...(channel ? { channel } : {}),
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
