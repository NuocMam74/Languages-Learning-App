import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { Plugin } from "vite";
import { CONTENT_ROOT, listPacks, readPackFiles, toRaw } from "../../scripts/lib/load-pack.ts";

/**
 * Sert le contenu comme le fera le CDN : /content/<pack>/v<version>/…
 *   - bundle.json : tout le JSON d'un pack en un fichier (un seul aller-retour, cache hors ligne simple)
 *   - audio/, pitch/, img/ : médias tels quels
 * En dev : middleware. En build : fichiers émis dans dist/ (donc précachables).
 */

const MEDIA_DIRS = ["audio", "pitch", "img"];
const MIME: Record<string, string> = {
  ".json": "application/json",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function packVersion(code: string): number {
  return (JSON.parse(readFileSync(join(CONTENT_ROOT, code, "pack.json"), "utf8")) as { version: number }).version;
}

function bundle(code: string): string {
  return JSON.stringify(toRaw(readPackFiles(code)));
}

function mediaFiles(code: string): string[] {
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir).flatMap((name) => {
          const full = join(dir, name);
          return statSync(full).isDirectory() ? walk(full) : extname(name) in MIME ? [full] : [];
        })
      : [];
  return MEDIA_DIRS.flatMap((d) => walk(join(CONTENT_ROOT, code, d)));
}

export function contentPlugin(): Plugin {
  return {
    name: "parlo-content",

    configureServer(server) {
      server.watcher.add(CONTENT_ROOT);
      server.middlewares.use((req, res, next) => {
        const match = /^\/content\/([a-z-]+)\/v(\d+)\/(.+)$/.exec(req.url?.split("?")[0] ?? "");
        if (!match) return next();
        const [, code = "", , path = ""] = match;
        if (!listPacks().includes(code)) return next();
        if (path === "bundle.json") {
          res.setHeader("Content-Type", MIME[".json"] ?? "application/json");
          res.end(bundle(code));
          return;
        }
        const file = join(CONTENT_ROOT, code, path);
        if (!file.startsWith(join(CONTENT_ROOT, code) + sep) || !existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },

    generateBundle() {
      for (const code of listPacks()) {
        const base = `content/${code}/v${packVersion(code)}`;
        this.emitFile({ type: "asset", fileName: `${base}/bundle.json`, source: bundle(code) });
        for (const file of mediaFiles(code)) {
          const rel = relative(join(CONTENT_ROOT, code), file).split(sep).join("/");
          this.emitFile({ type: "asset", fileName: `${base}/${rel}`, source: readFileSync(file) });
        }
      }
    },
  };
}

/** Packs disponibles et leur version, injectés dans l'app au build. */
export function packManifest(): Record<string, number> {
  return Object.fromEntries(listPacks().map((code) => [code, packVersion(code)]));
}
