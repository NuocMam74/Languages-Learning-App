/**
 * Écriture d'un PDF, sans dépendance (contrat phase23 §4).
 *
 * Pourquoi pas une bibliothèque : embarquer du **texte** dans un PDF demande d'y embarquer aussi
 * une police, et le vietnamien est le cas qui casse tout — « nghệ », « tiếng », « ở đâu » empilent
 * deux diacritiques sur une voyelle. Les polices de base d'un PDF (WinAnsi) n'ont pas ces
 * caractères ; embarquer une TrueType demanderait un sous-ensembleur, un fichier de police servi à
 * part, et 1 Mo de dépendances dans une PWA qui doit marcher hors ligne.
 *
 * On prend donc l'autre chemin : **le navigateur compose, le PDF transporte**. Chaque page est
 * dessinée sur un canvas avec les polices déjà chargées par l'application (Be Vietnam Pro, Source
 * Serif 4 — toutes deux fournies avec le jeu vietnamien), exportée en JPEG, et déposée telle quelle
 * dans le PDF via `DCTDecode`, qui prend les octets JPEG sans les retoucher.
 *
 * Ce qu'on y gagne : un vrai `.pdf`, ouvrable et imprimable partout, avec des tons parfaitement
 * rendus, zéro dépendance, zéro réseau. Ce qu'on y perd, et qui est assumé : le texte n'est ni
 * sélectionnable ni cherchable dans le PDF. Pour une fiche qu'on relit et qu'on imprime, c'est le
 * bon échange ; le jour où ça ne le sera plus, la parade est connue (une police sous-ensemblée).
 */

/** A4 portrait, en points PostScript (1 pt = 1/72 pouce). */
export const A4 = { width: 595.28, height: 841.89 } as const;

/** Rendu à 150 ppp : net à l'impression, et une fiche reste sous 400 ko. */
export const PRINT_SCALE = 150 / 72;

export const PAGE_PX = {
  width: Math.round(A4.width * PRINT_SCALE),
  height: Math.round(A4.height * PRINT_SCALE),
} as const;

/** Qualité JPEG : au-dessus, le fichier double sans que l'œil y gagne sur du texte noir sur blanc. */
const JPEG_QUALITY = 0.92;

/** Octets d'une chaîne ASCII/latin1 — la syntaxe d'un PDF n'est jamais de l'UTF-8. */
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** Accumulateur d'octets qui sait où il en est : les tables `xref` d'un PDF sont des décalages. */
class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  offset = 0;

  push(chunk: Uint8Array | string): void {
    const bytes = typeof chunk === "string" ? latin1(chunk) : chunk;
    this.chunks.push(bytes);
    this.offset += bytes.length;
  }

  toBlob(): Blob {
    return new Blob(this.chunks as BlobPart[], { type: "application/pdf" });
  }
}

/** Une page prête à écrire : son image JPEG et ses dimensions en pixels. */
export interface PdfPage {
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
}

/** Échappe une chaîne de texte PDF (titre du document). */
const pdfString = (text: string) =>
  `(${[...text].map((c) => (c.charCodeAt(0) > 126 ? "?" : c)).join("").replace(/[\\()]/g, "\\$&")})`;

/**
 * Assemble les pages en un PDF 1.4. Structure minimale et parfaitement classique : un catalogue,
 * un nœud de pages, puis par page un objet Page, son flux de contenu et son image.
 */
export function buildPdf(pages: readonly PdfPage[], meta: { title: string } = { title: "Parlo" }): Blob {
  if (pages.length === 0) throw new Error("un PDF sans page");
  const w = new ByteWriter();
  // Index 0 inutilisé (l'objet libre de tête), les objets sont numérotés à partir de 1.
  const offsets: number[] = [0];
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = w.offset;
    w.push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      w.push("stream\n");
      w.push(stream);
      w.push("\nendstream\n");
    }
    w.push("endobj\n");
  };

  w.push("%PDF-1.4\n");
  // Commentaire d'octets hauts : la convention qui dit aux outils « ce fichier est binaire ».
  w.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1 : catalogue, 2 : arbre des pages, 3 : informations. Puis trois objets par page.
  const pageId = (i: number) => 4 + i * 3;
  const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(" ");

  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${pdfString(meta.title)} /Producer (Parlo) /Creator (Parlo) >>`);

  pages.forEach((page, i) => {
    const id = pageId(i);
    const contentId = id + 1;
    const imageId = id + 2;
    // L'image couvre la page entière : la mise en page (marges comprises) est dessinée au canvas.
    const content = latin1(`q\n${A4.width.toFixed(2)} 0 0 ${A4.height.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`);
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width.toFixed(2)} ${A4.height.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentId} 0 R >>`,
    );
    object(contentId, `<< /Length ${content.length} >>`, content);
    object(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      page.jpeg,
    );
  });

  const count = offsets.length;
  const xrefAt = w.offset;
  w.push(`xref\n0 ${count}\n`);
  w.push("0000000000 65535 f \n");
  for (let id = 1; id < count; id++) w.push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  w.push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return w.toBlob();
}

/** Canvas d'une page à l'échelle d'impression, fond blanc (une fiche se lit sur du papier). */
export function createPageCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_PX.width;
  canvas.height = PAGE_PX.height;
  return canvas;
}

/** Convertit un canvas de page en JPEG. */
export async function pageFromCanvas(canvas: HTMLCanvasElement): Promise<PdfPage> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("toBlob");
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), widthPx: canvas.width, heightPx: canvas.height };
}
