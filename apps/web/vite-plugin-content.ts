import { splitPack, type CoreFile, type UnitFile } from "@parlo/core";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { Plugin } from "vite";
import { CONTENT_ROOT, listPacks, mediaFiles, packMediaSize, readPackBundle } from "../../scripts/lib/load-pack.ts";

/**
 * Sert le contenu comme le fera le CDN : /content/<pack>/…
 *   - latest.json : `{code, version}` (contrat phase5 §6) ;
 *   - v<version>/core.json : de quoi afficher le hub et planifier (petit, précaché) ;
 *   - v<version>/units/<unitId>.json : leçons complètes d'une unité (à la demande, hors ligne explicite) ;
 *   - v<version>/bundle.json : tout le JSON d'un pack (anciens clients, gardé une version) ;
 *   - v<version>/audio/, pitch/, img/ : médias tels quels.
 * Même découpage que l'API (`apps/api/app/services/content_split.py`), calculé par @parlo/core.
 * En dev : middleware. En build : fichiers émis dans dist/.
 */

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
  return JSON.stringify(readPackBundle(code));
}

function split(code: string): { core: CoreFile; units: UnitFile[] } {
  return splitPack(readPackBundle(code), { mediaSize: (path) => packMediaSize(code, path) });
}

/** Nom de fichier d'une unité (ids `vi-south.u01` : caractères sûrs dans une URL). */
export const unitFileName = (unitId: string) => `units/${unitId}.json`;

export function contentPlugin(): Plugin {
  return {
    name: "parlo-content",

    configureServer(server) {
      server.watcher.add(CONTENT_ROOT);
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        const latest = /^\/content\/([a-z-]+)\/latest\.json$/.exec(url);
        if (latest && listPacks().includes(latest[1] ?? "")) {
          const code = latest[1] ?? "";
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-cache");
          res.end(JSON.stringify({ code, version: packVersion(code) }));
          return;
        }
        const match = /^\/content\/([a-z-]+)\/v(\d+)\/(.+)$/.exec(url);
        if (!match) return next();
        const [, code = "", , path = ""] = match;
        if (!listPacks().includes(code)) return next();
        const json = (body: string) => {
          res.setHeader("Content-Type", "application/json");
          res.end(body);
        };
        if (path === "bundle.json") return json(bundle(code));
        if (path === "core.json") return json(JSON.stringify(split(code).core));
        const unit = /^units\/([^/]+)\.json$/.exec(path);
        if (unit) {
          const file = split(code).units.find((u) => u.unit === unit[1]);
          if (file) return json(JSON.stringify(file));
          res.statusCode = 404;
          res.end();
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
        const version = packVersion(code);
        const base = `content/${code}/v${version}`;
        const { core, units } = split(code);
        this.emitFile({ type: "asset", fileName: `content/${code}/latest.json`, source: JSON.stringify({ code, version }) });
        this.emitFile({ type: "asset", fileName: `${base}/core.json`, source: JSON.stringify(core) });
        for (const unit of units) this.emitFile({ type: "asset", fileName: `${base}/${unitFileName(unit.unit)}`, source: JSON.stringify(unit) });
        this.emitFile({ type: "asset", fileName: `${base}/bundle.json`, source: bundle(code) });
        for (const file of mediaFiles(code)) {
          const rel = relative(join(CONTENT_ROOT, code), file).split(sep).join("/");
          this.emitFile({ type: "asset", fileName: `${base}/${rel}`, source: readFileSync(file) });
        }
      }
    },

    // Pas de `preload` du core dans la page : mesuré sur Lighthouse mobile, il retarde le JS critique à la première
    // visite (bande passante partagée) et n'apporte rien ensuite (core.json est précaché par le service worker).
  };
}

/** Packs disponibles et leur version, injectés dans l'app au build. */
export function packManifest(): Record<string, number> {
  return Object.fromEntries(listPacks().map((code) => [code, packVersion(code)]));
}
