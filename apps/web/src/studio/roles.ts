import { localDay } from "@parlo/core";
import { useEffect, useState } from "react";
import { ApiError, getMe } from "../api.ts";

/** Rôles de l'utilisateur (contrat phase4 §0) : lus sur GET /me, vérifiés de toute façon côté serveur. */

export const STUDIO_ROLES = ["reviewer", "editor", "admin"] as const;

export const canUseStudio = (roles: readonly string[]) => roles.some((r) => (STUDIO_ROLES as readonly string[]).includes(r));
/** Publier, JSON avancé : éditeurs et administrateurs. */
export const canPublish = (roles: readonly string[]) => roles.includes("editor") || roles.includes("admin");

export type RolesState = { status: "loading" } | { status: "ready"; roles: string[] } | { status: "signed_out" } | { status: "error" };

export function useMyRoles(enabled = true): RolesState {
  const [state, setState] = useState<RolesState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getMe(localDay(new Date()))
      .then((me) => alive && setState({ status: "ready", roles: me.roles ?? [] }))
      .catch((error: unknown) => {
        if (!alive) return;
        setState(error instanceof ApiError && (error.status === 401 || error.status === 403) ? { status: "signed_out" } : { status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return state;
}
