import type { ParloEvent } from "@parlo/core";

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
  ) {
    super(`HTTP ${status}: ${detail}`);
  }
}

/** Réseau injoignable (hors ligne, DNS, CORS…). */
export class NetworkError extends Error {
  override name = "NetworkError";
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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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
  if (!res.ok) throw new ApiError(res.status, await detailOf(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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

export interface MeResponse {
  user: { id: string; email: string | null; displayName: string; locale: string; createdAt: string; isGuest: boolean };
  profile: { motivation: string | null; dailyGoalMin: number; reminderHour: number | null; levelEstimate: string | null; pathVariant: string | null };
  enrollment: { courseCode: string; xpTotal: number; level: number; currentLessonId: string | null } | null;
  streak: { current: number; longest: number; lastActiveDate: string | null; freezesAvailable: number; frozenUntil: string | null };
  levelEstimate?: number | null;
  badges?: { code: string; earnedAt: string }[];
  dailyGoal?: { targetMin: number; doneTodayMin: number; localDate: string };
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
