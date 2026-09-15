import { describe, expect, it } from "vitest";
import { dataCodewords, encodeQr, formatBits, qrPath, reedSolomon, type QrMatrix } from "./qr.ts";

/**
 * Vérifications indépendantes de l'encodeur : exemples publiés (Reed-Solomon « HELLO WORLD » 1-M,
 * table des bits de format), capacités de la norme, puis décodage complet par un lecteur écrit
 * ici à partir de la norme (zones fonctionnelles recalculées, pas celles de l'encodeur).
 */

describe("primitives", () => {
  it("Reed-Solomon : exemple de référence 1-M", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it("bits de format de la table de la norme", () => {
    expect(formatBits(0, 0).toString(2).padStart(15, "0")).toBe("101010000010010"); // M, masque 0
    expect(formatBits(1, 4).toString(2).padStart(15, "0")).toBe("110011000101111"); // L, masque 4
    expect(formatBits(3, 6).toString(2).padStart(15, "0")).toBe("010111011011010"); // Q, masque 6
    expect(formatBits(3, 7).toString(2).padStart(15, "0")).toBe("010101111101101"); // Q, masque 7
  });

  it("capacités en octets de données (niveau M)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(dataCodewords)).toEqual([16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
  });
});

// --- Lecteur de référence ---------------------------------------------------------

const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const BLOCKS: Record<number, [ecc: number, blocks: number]> = { 1: [10, 1], 2: [16, 1], 3: [26, 1], 4: [18, 2], 5: [24, 2], 6: [16, 4], 7: [18, 4], 8: [22, 4], 9: [22, 5], 10: [26, 5] };

function isFunctionModule(version: number, size: number, x: number, y: number): boolean {
  if (x === 6 || y === 6) return true;
  if ((x <= 8 && y <= 8) || (x >= size - 8 && y <= 8) || (x <= 8 && y >= size - 8)) return true;
  const pos = ALIGN[version]!;
  for (const ax of pos) for (const ay of pos) {
    const corner = (ax === 6 && ay === 6) || (ax === 6 && ay === pos.at(-1)) || (ax === pos.at(-1) && ay === 6);
    if (!corner && Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true;
  }
  if (version >= 7 && ((x >= size - 11 && x <= size - 9 && y <= 5) || (y >= size - 11 && y <= size - 9 && x <= 5))) return true;
  return false;
}

function decode(matrix: QrMatrix): string {
  const { modules, version, size } = matrix;
  const at = (x: number, y: number) => modules[y]![x]!;
  // Finders : centre sombre, anneau clair.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    expect(at(cx, cy) && !at(cx + 2, cy) && at(cx + 3, cy)).toBe(true);
  }
  // Format (première copie), comparé à la seconde.
  let f1 = 0;
  const firstCoords: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  firstCoords.forEach(([x, y], i) => (f1 |= (at(x, y) ? 1 : 0) << i));
  let f2 = 0;
  for (let i = 0; i < 8; i++) f2 |= (at(size - 1 - i, 8) ? 1 : 0) << i;
  for (let i = 8; i < 15; i++) f2 |= (at(8, size - 15 + i) ? 1 : 0) << i;
  expect(f2).toBe(f1);
  const raw = f1 ^ 0x5412;
  expect(raw >> 13).toBe(0); // niveau M
  const mask = (raw >> 10) & 7;
  expect(formatBits(0, mask)).toBe(f1);

  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask]!;

  // Lecture en zigzag, deux colonnes à la fois, de droite à gauche.
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) {
      const y = upward ? size - 1 - k : k;
      for (const x of [right, right - 1]) {
        if (!isFunctionModule(version, size, x, y)) bits.push(at(x, y) !== maskFn(x, y) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Désentrelacement puis contrôle Reed-Solomon de chaque bloc.
  const [ecc, numBlocks] = BLOCKS[version]!;
  const dataTotal = dataCodewords(version);
  const shortLen = Math.floor(dataTotal / numBlocks);
  const numLong = dataTotal % numBlocks;
  const lens = Array.from({ length: numBlocks }, (_, i) => shortLen + (i >= numBlocks - numLong ? 1 : 0));
  const blocks: number[][] = lens.map(() => []);
  let p = 0;
  for (let i = 0; i < shortLen + 1; i++) for (let b = 0; b < numBlocks; b++) if (i < lens[b]!) blocks[b]!.push(codewords[p++]!);
  const eccBlocks: number[][] = lens.map(() => []);
  for (let i = 0; i < ecc; i++) for (let b = 0; b < numBlocks; b++) eccBlocks[b]!.push(codewords[p++]!);
  blocks.forEach((block, b) => expect(reedSolomon(block, ecc)).toEqual(eccBlocks[b]));

  const data = blocks.flat();
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  const read = (from: number, len: number) => stream.slice(from, from + len).reduce((a, b) => (a << 1) | b, 0);
  expect(read(0, 4)).toBe(0b0100);
  const countBits = version <= 9 ? 8 : 16;
  const length = read(4, countBits);
  const bytes = Array.from({ length }, (_, i) => read(4 + countBits + i * 8, 8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe("encodeQr", () => {
  it.each([
    "https://parlo.app/classe/7K3Q9B",
    "A",
    "http://localhost:4192/classe/ABC123",
    "Lớp tiếng Việt — mardi soir, groupe débutant ".repeat(2),
    "x".repeat(150),
  ])("se relit à l'identique : %s", (text) => {
    const matrix = encodeQr(text);
    expect(matrix.size).toBe(matrix.version * 4 + 17);
    expect(decode(matrix)).toBe(text);
  });

  it("choisit la plus petite version", () => {
    expect(encodeQr("https://parlo.app/classe/7K3Q9B").version).toBe(3);
    expect(encodeQr("A").version).toBe(1);
  });

  it("refuse un texte trop long ; chemin SVG avec zone de silence", () => {
    expect(() => encodeQr("x".repeat(300))).toThrow(RangeError);
    const path = qrPath(encodeQr("A"));
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
