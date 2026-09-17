import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { contentPlugin, packManifest } from "./vite-plugin-content.ts";
import { i18nLocalePlugin } from "./vite-plugin-i18n.ts";

/**
 * Précharge la police du premier écran (Be Vietnam Pro 400, latin) : elle arrive avant le premier rendu,
 * sans échange de police qui fait sauter la mise en page (CLS), et sans concurrencer le JS critique.
 */
function preloadFonts(): Plugin {
  // Un seul préchargement : la police du texte courant au-dessus de la ligne de flottaison. Les autres
  // sous-ensembles (vietnamien, gras, serif) arrivent via font-display: swap, sans concurrencer le JS critique.
  const wanted = /be-vietnam-pro-latin-400-normal-[\w-]+\.woff2$/;
  return {
    name: "parlo-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((file) => wanted.test(file))
          .map((file) => ({ tag: "link", attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${file}`, crossorigin: "" }, injectTo: "head" as const }));
      },
    },
  };
}

export default defineConfig({
  define: {
    __PACKS__: JSON.stringify(packManifest()),
  },
  plugins: [
    react(),
    tailwindcss(),
    contentPlugin(),
    i18nLocalePlugin(),
    preloadFonts(),
    VitePWA({
      // « prompt » : une nouvelle version attend et s'annonce (src/pwa/UpdatePrompt.tsx), jamais de rechargement en séance.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        id: "/",
        name: "Parlo — vietnamien du Sud",
        short_name: "Parlo",
        description: "7 minutes par jour pour parler le vietnamien du Sud.",
        lang: "fr",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Pas de verrou portrait : l'app installée tourne comme dans le navigateur (tablette, paysage).
        orientation: "any",
        background_color: "#F2F6F3",
        theme_color: "#0E5E55",
        categories: ["education", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Séance du jour", short_name: "Séance", url: "/seance", icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96", type: "image/png" }] },
          { name: "Révisions", short_name: "Révisions", url: "/revision", icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96", type: "image/png" }] },
        ],
        // Écrans réels de l'app (scripts/generate-screenshots.ts) : fiche d'installation enrichie sur Android.
        screenshots: [
          { src: "/screenshots/narrow-hub.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Le parcours du jour et la série" },
          { src: "/screenshots/narrow-lesson.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Écouter et reconnaître les tons" },
          { src: "/screenshots/wide-hub.png", sizes: "1920x1080", type: "image/png", form_factor: "wide", label: "Le parcours sur tablette et ordinateur" },
        ],
      },
      // Service worker écrit à la main (Phase 2 : notifications push) ; la stratégie de cache
      // (précache, SWR, audio LRU, images) vit dans src/sw.ts.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // App shell + core.json des packs (hub et planification hors ligne dès l'installation) ; les unités et leurs
        // médias sont mis en cache à la demande (leçon visitée ou « Disponible hors ligne », src/offline/downloads.ts).
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}", "content/*/v*/core.json"],
        // Outils internes (studio, espace enseignant) : chargés à la demande, jamais précachés chez les apprenants.
        // globIgnores remplace les exclusions par défaut du plugin : on les reprend (sinon le service worker se précache lui-même).
        // Captures du manifeste, écrans de démarrage iOS et icônes de raccourcis : jamais utiles hors ligne.
        globIgnores: ["**/node_modules/**/*", "sw.js", "workbox-*.js", "**/StudioApp-*.js", "**/TeacherPages-*.js", "screenshots/**", "splash/**", "icons/apple-touch-icon-*.png", "icons/shortcut-*.png"],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: { "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:8000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
