import { memoSheet, type ContentIndex, type LessonId, type MemoSheet, type UnitId } from "@parlo/core";
import { ensureUnits } from "../content.ts";
import { l, t } from "../i18n/index.ts";
import { buildPdf } from "./pdf.ts";
import { renderMemoPages } from "./render.ts";

/**
 * Fabrication et enregistrement d'une fiche mémoire (contrat phase23 §4).
 *
 * Tout se passe sur l'appareil : le PDF n'est jamais demandé à un serveur, jamais envoyé nulle
 * part. C'est la condition pour qu'une fiche existe en mode invité et hors ligne — exactement les
 * moments où l'on veut l'emporter.
 */

/** Nom de fichier : lisible dans un dossier de téléchargements six mois plus tard. */
export function memoFilename(sheet: MemoSheet | { lessonId: string }, title?: string): string {
  const slug = (title ?? sheet.lessonId)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${t("memo.filename")}-${slug || "niveau"}.pdf`;
}

/**
 * Le partage de fichiers est-il réellement proposé par ce navigateur ?
 *
 * Sert à **offrir un second bouton**, jamais à remplacer le premier. Mesuré en jouant l'écran :
 * Edge sur Windows répond `true` à `canShare({ files })`. Un bouton « Télécharger en PDF » qui
 * ouvrait la feuille de partage de Windows au lieu d'enregistrer le fichier — et qui annonçait
 * ensuite « PDF enregistré » alors que rien n'avait été enregistré. Un bouton tient ce qu'il
 * promet : télécharger télécharge.
 */
export function canSharePdf(): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [new File([new Blob([])], "a.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

/** Enregistre le PDF sur l'appareil. Aucun réseau : le fichier a été fabriqué ici. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Partage le PDF (feuille du système). `false` : le partage n'a pas eu lieu, l'appelant décide. */
async function share(blob: Blob, filename: string, title: string): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  try {
    await nav.share({ files: [new File([blob], filename, { type: "application/pdf" })], title });
    return true;
  } catch (error) {
    // Feuille refermée : c'est un choix, pas une panne — on n'impose pas un téléchargement derrière.
    return error instanceof DOMException && error.name === "AbortError";
  }
}

/**
 * Fiche d'un niveau. L'unité est chargée si elle ne l'est pas déjà : on arrive ici depuis le bilan
 * (elle l'est) mais aussi depuis la liste des fiches, où l'on peut demander un niveau ancien dont
 * l'unité n'est plus en mémoire.
 */
export async function buildMemoSheet(content: ContentIndex, lessonId: LessonId): Promise<MemoSheet | null> {
  const unit = content.lessons.get(lessonId)?.unit;
  if (unit) await ensureUnits(content, [unit], { optional: true }).catch(() => []);
  return memoSheet(content, lessonId);
}

/** Fabrique la fiche et l'enregistre. `mode: "share"` passe par la feuille du système à la place. */
export async function downloadMemo(content: ContentIndex, lessonId: LessonId, mode: "download" | "share" = "download"): Promise<void> {
  const sheet = await buildMemoSheet(content, lessonId);
  if (!sheet) throw new Error(`fiche indisponible : ${lessonId}`);
  const title = l(sheet.title);
  const pages = await renderMemoPages(sheet, l(content.pack.name));
  const blob = buildPdf(pages, { title });
  const filename = memoFilename(sheet, title);
  if (mode === "share" && (await share(blob, filename, title))) return;
  save(blob, filename);
}

/**
 * Toutes les fiches d'un thème en un seul PDF — la forme qu'on imprime vraiment : on ne va pas
 * lancer huit impressions pour réviser une unité avant un voyage.
 */
export async function downloadUnitMemos(content: ContentIndex, unit: UnitId, lessonIds: readonly LessonId[]): Promise<void> {
  await ensureUnits(content, [unit], { optional: true }).catch(() => []);
  const sheets = lessonIds.flatMap((id) => memoSheet(content, id) ?? []);
  if (sheets.length === 0) throw new Error(`aucune fiche pour ${unit}`);
  const packName = l(content.pack.name);
  const pages = [];
  for (const sheet of sheets) pages.push(...(await renderMemoPages(sheet, packName)));
  const title = l(sheets[0]?.unitTitle ?? { fr: unit });
  save(buildPdf(pages, { title }), memoFilename({ lessonId: unit }, title));
}
