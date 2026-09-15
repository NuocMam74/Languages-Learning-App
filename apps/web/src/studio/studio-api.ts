import { request, requestBlob, requestForm } from "../api.ts";

/** Client du studio de contenu (docs/contracts/phase4.md §1). */

export type DocKind = "lesson" | "concept" | "culture" | "curriculum" | "lexical-variants" | "exam" | "pack";

export const DOC_KINDS: readonly DocKind[] = ["lesson", "concept", "culture", "curriculum", "lexical-variants", "exam", "pack"];

export interface StudioPack {
  code: string;
  name: string | Record<string, string>;
  version: number;
}

export interface TreeLesson {
  id: string;
  title: string | Record<string, string>;
  kind: string;
  reviewed: boolean;
  draft: boolean;
}

export interface StudioTree {
  units: { id: string; title: string | Record<string, string>; status: string; lessons: TreeLesson[] }[];
  concepts: { id: string; vi: string; reviewed: boolean; draft: boolean }[];
  culture: { id: string; reviewed: boolean; draft: boolean }[];
}

export interface DraftInfo {
  data: unknown;
  updatedAt: string;
  updatedBy: string;
}

export interface StudioDocument {
  kind: DocKind;
  id: string;
  published: unknown;
  draft: DraftInfo | null;
}

export interface ServerIssue {
  where: string;
  message: string;
}

export interface ValidateResult {
  errors: ServerIssue[];
  warnings: ServerIssue[];
}

export interface PublishResult {
  written: string[];
  packVersion: number;
}

export interface ReviewItem {
  kind: DocKind;
  id: string;
  title: string;
  vi: string[];
  doubts: string[];
}

export interface AudioUploadResult {
  files: { path: string; durationMs: number }[];
  pitch: { path: string } | null;
}

const enc = encodeURIComponent;
const packPath = (code: string) => `/studio/packs/${enc(code)}`;
const docPath = (code: string, kind: DocKind, id: string) => `${packPath(code)}/documents/${enc(kind)}/${enc(id)}`;

export const getStudioPacks = () => request<StudioPack[]>("/studio/packs");
export const getStudioTree = (code: string) => request<StudioTree>(`${packPath(code)}/tree`);
export const getDocument = (code: string, kind: DocKind, id: string) => request<StudioDocument>(docPath(code, kind, id));
export const saveDraft = (code: string, kind: DocKind, id: string, data: unknown, baseUpdatedAt: string | null) =>
  request<{ updatedAt: string }>(docPath(code, kind, id), { method: "PUT", body: { data, baseUpdatedAt } });
export const discardDraft = (code: string, kind: DocKind, id: string) => request<void>(`${docPath(code, kind, id)}/draft`, { method: "DELETE" });
export const validatePack = (code: string) => request<ValidateResult>(`${packPath(code)}/validate`, { method: "POST" });
export const publishDocuments = (code: string, documents: { kind: DocKind; id: string }[], message: string) =>
  request<PublishResult>(`${packPath(code)}/publish`, { method: "POST", body: { documents, message } });

export function getReviewQueue(code: string, filters: { kind?: string; unit?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.unit) params.set("unit", filters.unit);
  const query = params.toString();
  return request<ReviewItem[]>(`${packPath(code)}/review-queue${query ? `?${query}` : ""}`);
}

export const postReview = (code: string, kind: DocKind, id: string, verdict: "approve" | "changes", comment: string) =>
  request<{ reviewedBy: string; reviewedAt: string }>(`${docPath(code, kind, id)}/review`, { method: "POST", body: { verdict, comment } });

export function uploadAudio(code: string, input: { file: Blob; fileName: string; conceptId: string; voice: string; pitch: string | null }) {
  const form = new FormData();
  form.append("file", input.file, input.fileName);
  form.append("conceptId", input.conceptId);
  form.append("voice", input.voice);
  if (input.pitch) form.append("pitch", input.pitch);
  return requestForm<AudioUploadResult>(`${packPath(code)}/audio`, form);
}

/** Aperçu d'un fichier média du brouillon (chemin relatif au pack, ex. audio/c_ba_mai.opus). */
export const getAudioPreview = (code: string, path: string) => requestBlob(`${packPath(code)}/audio/${path.split("/").map(enc).join("/")}`);

export function labelOf(text: string | Partial<Record<string, string>> | undefined | null): string {
  if (!text) return "";
  return typeof text === "string" ? text : (text.fr ?? Object.values(text)[0] ?? "");
}
