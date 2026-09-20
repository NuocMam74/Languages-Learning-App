import type { ExerciseResponse, Localized, ParloEvent, SrsCard } from "@parlo/core";

/**
 * Client HTTP de l'API Parlo.
 * - Jeton d'accès en mémoire uniquement ; le refresh vit dans le cookie httpOnly
 *   `parlo_refresh`, envoyé grâce à `credentials: "include"`.
 * - Un 401 déclenche un seul rafraîchissement, puis la requête est rejouée une fois.
 */

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Corps JSON de l'erreur (ex. 409 retry_locked → nextAttemptAt), null sinon. */
    readonly body: unknown = null,
  ) {
    super(`HTTP ${status}: ${detail}`);
  }
}

/** Réseau injoignable (hors ligne, DNS, CORS…). */
export class NetworkError extends Error {
  override name = "NetworkError";
}

/**
 * Le déploiement n'a pas d'API (scénario A du README : la PWA seule, en hébergement statique).
 * `apps/web/worker.js` répond alors `404 {"detail":"api_unavailable"}` à tout `/api/*` — sans ça,
 * l'app conclurait « réseau injoignable » et s'afficherait hors ligne en permanence.
 *
 * Ce n'est pas une panne passagère : rien ne sert de proposer « réessaie dans un instant ». Les
 * écrans qui en dépendent (créer un compte, se connecter) doivent le dire franchement et renvoyer
 * vers le mode invité, qui, lui, fonctionne entièrement.
 */
export function isApiUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.detail === "api_unavailable";
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let base: string = import.meta.env.VITE_API_BASE ?? "/api";
let fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init);
let accessToken: string | null = null;
let refreshing: Promise<RefreshOutcome> | null = null;
const listeners = new Set<(token: string | null) => void>();

/** Tests : injecte un fetch simulé et/ou une base d'URL. */
export function configureApi(options: { fetch?: FetchLike; base?: string }): void {
  if (options.fetch) fetchImpl = options.fetch;
  if (options.base !== undefined) base = options.base;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function onTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(`${base}${path}`, { ...init, credentials: "include" });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }
}

async function detailOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? "");
  } catch {
    return res.statusText;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** false : route publique (auth), pas de jeton ni de rafraîchissement. */
  auth?: boolean;
}

export async function request<T>(path: string, { method = "GET", body, auth = true }: RequestOptions = {}): Promise<T> {
  const build = (): RequestInit => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  };

  let refreshed = false;
  if (auth && !accessToken) {
    if (!(await refreshAccess())) throw new ApiError(401, "not_authenticated");
    refreshed = true;
  }
  let res = await send(path, build());
  if (auth && res.status === 401 && !refreshed && (await refreshAccess())) {
    res = await send(path, build());
  }
  if (!res.ok) {
    const errorBody: unknown = await res.clone().json().catch(() => null);
    throw new ApiError(res.status, await detailOf(res), errorBody);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Téléchargement binaire authentifié (PDF de certificat). */
export async function requestBlob(path: string): Promise<Blob> {
  const build = (): RequestInit => ({ method: "GET", headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let refreshed = false;
  if (!accessToken) {
    if (!(await refreshAccess())) throw new ApiError(401, "not_authenticated");
    refreshed = true;
  }
  let res = await send(path, build());
  if (res.status === 401 && !refreshed && (await refreshAccess())) res = await send(path, build());
  if (!res.ok) throw new ApiError(res.status, await detailOf(res));
  return res.blob();
}

/** Envoi multipart authentifié (Phase 4 : audio du studio). Le navigateur pose lui-même le Content-Type (boundary). */
export async function requestForm<T>(path: string, form: FormData, method: "POST" | "PUT" = "POST"): Promise<T> {
  const build = (): RequestInit => ({ method, headers: { Accept: "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: form });
  let refreshed = false;
  if (!accessToken) {
    if (!(await refreshAccess())) throw new ApiError(401, "not_authenticated");
    refreshed = true;
  }
  let res = await send(path, build());
  if (res.status === 401 && !refreshed && (await refreshAccess())) res = await send(path, build());
  if (!res.ok) {
    const errorBody: unknown = await res.clone().json().catch(() => null);
    throw new ApiError(res.status, await detailOf(res), errorBody);
  }
  return (await res.json()) as T;
}

/**
 * Requête authentifiée à réponse en flux (text/event-stream, Phase 3).
 * EventSource ne sait ni POSTer ni envoyer Authorization : on passe par fetch.
 * Le 401 est rattrapé une seule fois, avant que le flux ne commence ; la
 * réponse `ok` est rendue telle quelle (corps non lu). Un abandon via `signal`
 * rejette avec l'AbortError du navigateur (pas une NetworkError).
 */
export async function requestStream(path: string, { method = "POST", body, signal }: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
  const build = (): RequestInit => {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return { method, headers, ...(signal ? { signal } : {}), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  };
  const attempt = async () => {
    try {
      return await send(path, build());
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      throw error;
    }
  };
  let refreshed = false;
  if (!accessToken) {
    if (!(await refreshAccess())) throw new ApiError(401, "not_authenticated");
    refreshed = true;
  }
  let res = await attempt();
  if (res.status === 401 && !refreshed && (await refreshAccess())) res = await attempt();
  if (!res.ok) {
    const errorBody: unknown = await res.clone().json().catch(() => null);
    throw new ApiError(res.status, await detailOf(res), errorBody);
  }
  return res;
}

interface TokenResponse {
  accessToken: string;
  tokenType: "bearer";
  expiresIn: number;
}

export type RefreshOutcome = "ok" | "denied" | "network";

/** Rafraîchit le jeton d'accès via le cookie. Les appels concurrents partagent la même tentative. */
export function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= (async (): Promise<RefreshOutcome> => {
    try {
      const res = await send("/auth/refresh", { method: "POST", headers: { Accept: "application/json" } });
      if (!res.ok) {
        setAccessToken(null);
        return "denied";
      }
      const body = (await res.json()) as TokenResponse;
      setAccessToken(body.accessToken);
      return "ok";
    } catch {
      return "network";
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function refreshAccess(): Promise<boolean> {
  const outcome = await refreshSession();
  if (outcome === "network") throw new NetworkError("refresh");
  return outcome === "ok";
}

// --- Auth ---------------------------------------------------------------------

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  locale: "fr" | "en";
}

export async function register(input: RegisterInput): Promise<void> {
  const body = await request<TokenResponse>("/auth/register", { method: "POST", body: input, auth: false });
  setAccessToken(body.accessToken);
}

export async function login(email: string, password: string): Promise<void> {
  const body = await request<TokenResponse>("/auth/login", { method: "POST", body: { email, password }, auth: false });
  setAccessToken(body.accessToken);
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/auth/logout", { method: "POST", auth: false });
  } finally {
    setAccessToken(null);
  }
}

// --- /me ----------------------------------------------------------------------

export interface LevelDto {
  value: number;
  name: Localized | null;
  xpIntoLevel: number;
  xpForNext: number;
}

export interface MeResponse {
  user: { id: string; email: string | null; displayName: string; locale: string; createdAt: string; isGuest: boolean; emailVerified?: boolean };
  profile: { motivation: string | null; dailyGoalMin: number; reminderHour: number | null; levelEstimate: string | null; pathVariant: string | null };
  enrollment: { courseCode: string; xpTotal: number; level: number; currentLessonId: string | null } | null;
  streak: { current: number; longest: number; lastActiveDate: string | null; freezesAvailable: number; frozenUntil: string | null };
  levelEstimate?: number | null;
  badges?: { code: string; earnedAt: string }[];
  dailyGoal?: { targetMin: number; doneTodayMin: number; localDate: string };
  /** Toutes les inscriptions (une par pack). */
  enrollments?: NonNullable<MeResponse["enrollment"]>[];
  /** Phase 4 : rôles (`learner` implicite, `reviewer`, `editor`, `teacher`, `admin`) — docs/contracts/phase4.md §0. */
  roles?: string[];
  /** Contrat phase5 §3. */
  level?: LevelDto;
}

/** `localDate` : jour local de l'apprenant (série, objectif du jour). */
export const getMe = (localDate: string) => request<MeResponse>(`/me?localDate=${encodeURIComponent(localDate)}`);

export interface EventBatchResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

export const postEvents = (events: readonly ParloEvent[]) => request<EventBatchResult>("/me/events", { method: "POST", body: { events } });

// --- Cô Mai ---------------------------------------------------------------------

export interface TutorText {
  text: string;
  cached: boolean;
  source: string;
}

export const getTutorGreeting = (locale: string, localDate: string) =>
  request<TutorText>(`/tutor/greeting?locale=${encodeURIComponent(locale)}&localDate=${encodeURIComponent(localDate)}`);

export interface WhyInput {
  lessonId: string | null;
  stepIndex: number;
  given: string;
  expected: string;
  locale: string;
}

export const postTutorWhy = (input: WhyInput) => request<TutorText>("/tutor/why", { method: "POST", body: input });

// --- Phase 2 : examens, certificats, défis, push (docs/contracts/phase2.md) ------

export type ExamSkillName = "listening" | "reading" | "vocabulary" | "speaking";
export type ExamScoresDto = Record<ExamSkillName, number>;

export interface ExamSummary {
  id: string;
  level: string;
  certificate: { fr: string } & Partial<Record<string, string>>;
  requiresUnits: string[];
  durationMinutes: number;
  unlocked: boolean;
  lastAttempt: { id: string; submittedAt: string; passed: boolean; scores: ExamScoresDto; global?: number } | null;
  nextAttemptAt: string | null;
  /** Contrat phase5 §1 : moins de 15 items notables faute de médias. */
  unavailableReason?: "media_missing" | null;
}

export interface ExamStart {
  attemptId: string;
  seed: string;
  startedAt: string;
  expiresAt: string;
  items: { section: ExamSkillName; index: number }[];
}

export interface ExamSubmitAnswer {
  section: ExamSkillName;
  index: number;
  response: ExerciseResponse;
  responseMs: number;
}

export interface ExamSubmitResult {
  passed: boolean;
  global: number;
  scores: ExamScoresDto;
  gaps: { skill: ExamSkillName; conceptIds: string[] }[];
  certificate: { id: string; verificationCode: string } | null;
}

export interface CertificateDto {
  id: string;
  level: string;
  issuedAt: string;
  verificationCode: string;
  pdfUrl: string;
  shareImageUrl: string;
}

export interface VerifyResult {
  valid: boolean;
  displayName: string;
  level: string;
  certificate: { fr: string } & Partial<Record<string, string>>;
  issuedAt: string;
  scores: ExamScoresDto;
}

export const getExams = () => request<ExamSummary[]>("/exams");
export const startExam = (examId: string) => request<ExamStart>(`/exams/${encodeURIComponent(examId)}/start`, { method: "POST" });
export const submitExam = (attemptId: string, answers: readonly ExamSubmitAnswer[]) =>
  request<ExamSubmitResult>(`/exams/attempts/${encodeURIComponent(attemptId)}/submit`, { method: "POST", body: { answers } });
export const getCertificates = () => request<CertificateDto[]>("/certificates");
export const getCertificatePdf = (id: string) => requestBlob(`/certificates/${encodeURIComponent(id)}.pdf`);
export const verifyCertificate = (code: string) => request<VerifyResult>(`/verify/${encodeURIComponent(code)}`, { auth: false });

export interface ChallengeDto {
  id: string;
  kind: "words_theme" | "streak_days" | "speaking_minutes" | "lessons" | "game_score";
  title: { fr: string } & Partial<Record<string, string>>;
  target: number;
  unit: string | null;
  progress: number;
  completedAt: string | null;
  claimedAt: string | null;
  periodStart: string;
  periodEnd: string;
  badgeCode: string;
}

export const getCurrentChallenges = () => request<ChallengeDto[]>("/challenges/current");
export const claimChallenge = (id: string) => request<{ claimedAt: string; xp: number }>(`/challenges/${encodeURIComponent(id)}/claim`, { method: "POST" });

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  reminderHour: number;
  timezone: string;
}

export const getVapidKey = () => request<{ key: string }>("/push/vapid-public-key", { auth: false });
export const subscribePush = (input: PushSubscriptionInput) => request<void>("/push/subscribe", { method: "POST", body: input });
export const unsubscribePush = (endpoint: string) => request<void>("/push/subscribe", { method: "DELETE", body: { endpoint } });

export interface ProfilePatch {
  reminderHour?: number | null;
  timezone?: string;
  notificationsEnabled?: boolean;
  /** Phase 3 : ligues (docs/contracts/phase3.md §2). */
  leaguesEnabled?: boolean;
  /** Contrat phase5 §4 : réponses d'onboarding et réglages. */
  motivation?: string | null;
  entourage?: string | null;
  selfLevel?: string | null;
  dailyGoalMin?: number;
  pathVariant?: string | null;
  interfaceLocale?: string | null;
  /**
   * Contrat phase7 §3 : nom affiché modifiable depuis le profil. Les serveurs qui ne connaissent
   * pas encore ce champ l'ignorent (`ProfilePatch` accepte les champs inconnus) : le nom reste
   * alors celui de l'appareil.
   */
  displayName?: string;
}

export const patchProfile = (patch: ProfilePatch) => request<unknown>("/me/profile", { method: "PATCH", body: patch });

// --- Contrat phase5 : restauration, comptes, RGPD, Cô Mai ------------------------

export interface MeStateDto {
  profile: Partial<MeResponse["profile"]> & {
    entourage?: string | null;
    selfLevel?: string | null;
    reminder?: string | null;
    onboardedAt?: string | null;
  } | null;
  placement: { levelEstimate: number; entryLessonId: string } | null;
  lessonProgress: { lessonId: string; bestScore: number; attempts: number; completedAt: string }[];
  srsCards: SrsCard[];
  badges: { code: string; earnedAt: string }[];
  streak: MeResponse["streak"] & { frozenFrom?: string | null };
  xpTotal: number;
  level?: LevelDto;
  /** Le compte est inscrit à ce pack : onboarding et placement ne sont pas reproposés. */
  enrolled?: boolean;
}

export const getMeState = (pack: string) => request<MeStateDto>(`/me/state?pack=${encodeURIComponent(pack)}`);

export const forgotPassword = (email: string) => request<void>("/auth/password/forgot", { method: "POST", body: { email }, auth: false });
export const resetPassword = (token: string, password: string) => request<void>("/auth/password/reset", { method: "POST", body: { token, password }, auth: false });
export const verifyEmail = (token: string) => request<void>("/auth/email/verify", { method: "POST", body: { token }, auth: false });
export const resendVerification = () => request<void>("/auth/email/resend", { method: "POST" });

export interface OAuthProvider {
  id: "google" | "apple";
  name: string;
}

export const getOAuthProviders = () => request<OAuthProvider[]>("/auth/oauth/providers", { auth: false });
export const oauthStartUrl = (provider: string, next: string) => `${base}/auth/oauth/${encodeURIComponent(provider)}/start?next=${encodeURIComponent(next)}`;

export const getServerExport = () => request<unknown>("/me/export");
export const deleteAccount = (body: { password: string } | { confirm: "SUPPRIMER" }) => request<void>("/me", { method: "DELETE", body });

export interface TutorStatusDto {
  available: boolean;
  reason: "no_model" | "pack_unsupported" | null;
  personaName: string | null;
}

export const getTutorStatus = (pack: string) =>
  request<TutorStatusDto>(`/tutor/status?pack=${encodeURIComponent(pack)}`, { auth: hasAccessToken() });

/** Résultat d'une tentative déjà soumise (409 already_submitted) : route facultative, sinon null. */
export async function getExamAttemptResult(attemptId: string): Promise<ExamSubmitResult | null> {
  try {
    return await request<ExamSubmitResult>(`/exams/attempts/${encodeURIComponent(attemptId)}`);
  } catch {
    return null;
  }
}
