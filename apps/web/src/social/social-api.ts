import type { Localized } from "@parlo/core";
import { request } from "../api.ts";

/**
 * Client HTTP Phase 3 : ligues, défis entre amis, défi express, partage
 * (docs/contracts/phase3.md §2–3). Les requêtes passent par `request` (jeton, refresh).
 */

export interface LeagueRow {
  rank: number;
  displayName: string;
  xp: number;
  isMe: boolean;
}

export type LeagueDto =
  | {
      enabled: true;
      division: number;
      divisionName: Localized;
      weekStart: string;
      weekEnd: string;
      standings: LeagueRow[];
      promoteTop: number;
      relegateBottom: number;
    }
  | { enabled: false };

export const getLeague = () => request<LeagueDto>("/leagues/me");

export interface FriendParticipant {
  displayName: string;
  xp: number;
  isMe: boolean;
}

export interface FriendChallengeCreated {
  id: string;
  inviteCode: string;
  inviteUrl: string;
  endsAt: string;
}

export interface FriendChallengeDto {
  id: string;
  inviteCode: string;
  endsAt: string;
  participants: FriendParticipant[];
}

export const createFriendChallenge = () => request<FriendChallengeCreated>("/challenges/friends", { method: "POST", body: { kind: "xp_7d" } });
export const joinFriendChallenge = (code: string) =>
  request<{ id: string; participants: FriendParticipant[]; endsAt: string }>(`/challenges/friends/join/${encodeURIComponent(code)}`, { method: "POST" });
export const getFriendChallenges = () => request<FriendChallengeDto[]>("/challenges/friends");

export interface ExpressScoreInput {
  game: "cho_noi";
  score: number;
  correct: number;
  total: number;
  localDate: string;
}

/** `id` : hypothèse côté client (identifiant de partage) — absent du contrat, facultatif. */
export interface ExpressScoreResult {
  best: number;
  rankToday: number | null;
  id?: string;
  shareId?: string;
}

export const postExpressScore = (input: ExpressScoreInput) => request<ExpressScoreResult>("/challenges/express/scores", { method: "POST", body: input });

export interface ExpressShareDto {
  displayName: string;
  game: string;
  score: number;
  createdAt: string;
}

export const getExpressShare = (id: string) => request<ExpressShareDto>(`/share/express/${encodeURIComponent(id)}`, { auth: false });
