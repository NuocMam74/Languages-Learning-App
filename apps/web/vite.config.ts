import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import { contentPlugin, packManifest } from "./vite-plugin-content.ts";

export default defineConfig({
  define: {
    __PACKS__: JSON.stringify(packManifest()),
  },
  plugins: [
    react(),
    tailwindcss(),
    contentPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "Parlo — vietnamien du Sud",
        short_name: "Parlo",
        description: "7 minutes par jour pour parler le vietnamien du Sud.",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F2F6F3",
        theme_color: "#0E5E55",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      // Service worker écrit à la main (Phase 2 : notifications push) ; la stratégie de cache
      // (précache, SWR, audio LRU, images) vit dans src/sw.ts.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // App shell + contenu JSON des packs embarqués : la première leçon marche hors ligne dès l'installation.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}", "content/**/bundle.json"],
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
