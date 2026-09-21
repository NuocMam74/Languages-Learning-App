import { describe, expect, it } from "vitest";
import { A4, buildPdf, type PdfPage } from "./pdf.ts";
import { memoFilename } from "./download.ts";

/**
 * L'écrivain PDF (contrat phase23 §4). Un PDF invalide ne se voit pas à l'écran : il s'ouvre chez
 * l'apprenant, ou pas. Ce qui est vérifié ici est donc la **structure du fichier** — l'en-tête, le
 * compte d'objets, la table `xref` dont chaque entrée doit pointer au bon octet, et la présence de
 * l'image de chaque page.
 *
 * La table `xref` est le seul endroit où une erreur d'un octet rend le fichier illisible partout :
 * c'est elle qu'on relit ici, décalage par décalage.
 */

/** Une page factice : ces octets ne sont pas un vrai JPEG, la structure n'en dépend pas. */
const page = (n: number): PdfPage => ({ jpeg: new Uint8Array(Array.from({ length: n }, (_, i) => i % 256)), widthPx: 1240, heightPx: 1754 });

async function bytes(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  return Array.from(buffer, (b) => String.fromCharCode(b)).join("");
}

describe("structure du fichier", () => {
  it("commence par un en-tête PDF et finit par %%EOF", async () => {
    const raw = await bytes(buildPdf([page(64)]));
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("déclare autant de pages qu'on lui en donne", async () => {
    const raw = await bytes(buildPdf([page(32), page(32), page(32)]));
    expect(raw).toContain("/Type /Pages /Kids [4 0 R 7 0 R 10 0 R] /Count 3");
    expect(raw.match(/\/Type \/Page[^s]/g)).toHaveLength(3);
  });

  it("porte la taille A4 et l'image en pleine page", async () => {
    const raw = await bytes(buildPdf([page(16)]));
    expect(raw).toContain(`/MediaBox [0 0 ${A4.width.toFixed(2)} ${A4.height.toFixed(2)}]`);
    expect(raw).toContain(`${A4.width.toFixed(2)} 0 0 ${A4.height.toFixed(2)} 0 0 cm`);
  });

  it("embarque les octets JPEG tels quels, en DCTDecode", async () => {
    const jpeg = page(200);
    const raw = await bytes(buildPdf([jpeg]));
    expect(raw).toContain("/Filter /DCTDecode /Length 200");
    expect(raw).toContain("/Width 1240 /Height 1754");
    // Les octets se retrouvent intacts : aucun ré-encodage en chemin.
    expect(raw).toContain(Array.from(jpeg.jpeg, (b) => String.fromCharCode(b)).join(""));
  });

  it("la table xref pointe sur le bon octet pour chaque objet", async () => {
    const raw = await bytes(buildPdf([page(48), page(48)]));
    const xrefAt = Number(/startxref\n(\d+)/.exec(raw)?.[1]);
    expect(raw.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const table = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(raw);
    const count = Number(table?.[1]);
    // 3 objets d'en-tête + 3 par page.
    expect(count).toBe(1 + 3 + 2 * 3);
    const rows = (table?.[2] ?? "").trimEnd().split("\n");
    expect(rows).toHaveLength(count);
    rows.slice(1).forEach((row, i) => {
      const offset = Number(row.slice(0, 10));
      expect(raw.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });

  it("refuse de fabriquer un PDF sans page", () => {
    expect(() => buildPdf([])).toThrow();
  });
});

describe("nom de fichier", () => {
  it("part du titre, sans accents ni ponctuation", () => {
    expect(memoFilename({ lessonId: "vi-south.u01.l01" }, "Cinq tons à entendre")).toBe("parlo-fiche-cinq-tons-a-entendre.pdf");
  });

  it("se rabat sur l'identifiant du niveau quand il n'y a pas de titre", () => {
    expect(memoFilename({ lessonId: "vi-south.u02.l03" })).toBe("parlo-fiche-vi-south-u02-l03.pdf");
  });

  it("ne produit jamais un nom vide, même pour un titre sans une seule lettre latine", () => {
    expect(memoFilename({ lessonId: "vi-south.u01.l01" }, "···")).toBe("parlo-fiche-niveau.pdf");
  });
});
