/**
 * Génère les icônes PWA (PNG) sans dépendance : soleil curcuma au-dessus de
 * deux vagues sur fond jade — le delta au lever du jour.
 * Usage : npx tsx apps/web/scripts/generate-icons.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

type RGB = [number, number, number];
const JADE: RGB = [0x0e, 0x5e, 0x55];
const NUOC: RGB = [0xf2, 0xf6, 0xf3];
const NGHE: RGB = [0xe5, 0xa2, 0x1b];

const OUT = join(import.meta.dirname, "..", "public", "icons");

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size: number, pixel: (x: number, y: number) => RGB): Buffer {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Motif dans un repère normalisé [0,1]² ; `scale` < 1 garde la zone sûre des icônes maskable. */
function artwork(size: number, scale: number) {
  return (px: number, py: number): RGB => {
    const u = ((px + 0.5) / size - 0.5) / scale + 0.5;
    const v = ((py + 0.5) / size - 0.5) / scale + 0.5;
    const sun = Math.hypot(u - 0.5, v - 0.4) < 0.17;
    const wave = (base: number) => {
      const crest = base + 0.035 * Math.sin((u - 0.1) * Math.PI * 3);
      return v > crest && v < crest + 0.055 && u > 0.18 && u < 0.82;
    };
    if (wave(0.62) || wave(0.74)) return NUOC;
    if (sun) return NGHE;
    return JADE;
  };
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon-192.png"), png(192, artwork(192, 1)));
writeFileSync(join(OUT, "icon-512.png"), png(512, artwork(512, 1)));
writeFileSync(join(OUT, "icon-maskable-512.png"), png(512, artwork(512, 0.72)));
writeFileSync(join(OUT, "apple-touch-icon.png"), png(180, artwork(180, 0.86)));
// iOS : tailles iPad (152, 167) et Spotlight/réglages (120) ; icônes des raccourcis du manifeste (96).
for (const size of [120, 152, 167, 180]) writeFileSync(join(OUT, `apple-touch-icon-${size}.png`), png(size, artwork(size, 0.86)));
writeFileSync(join(OUT, "shortcut-96.png"), png(96, artwork(96, 0.86)));
writeFileSync(
  join(OUT, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0E5E55"/><circle cx="50" cy="40" r="17" fill="#E5A21B"/><path d="M18 64q10.7-7 21.3 0t21.4 0 21.3 0M18 76q10.7-7 21.3 0t21.4 0 21.3 0" stroke="#F2F6F3" stroke-width="5.5" fill="none" stroke-linecap="round"/></svg>\n`,
);
console.log(`Icônes écrites dans ${OUT}`);
