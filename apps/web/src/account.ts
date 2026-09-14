import { localDay } from "@parlo/core";
import { create } from "zustand";
import { getMe, login, logout, refreshSession, register, type RegisterInput } from "./api.ts";
import { db, getKv, setKv } from "./db.ts";
import { ACCOUNT_KEY, syncEngine, type SyncResult } from "./sync.ts";

/**
 * Compte de l'apprenant (spec §4.1.6). Sans compte : mode invité, tout reste
 * local. Le compte connu est mémorisé localement (sans secret) ; le jeton
 * d'accès vit en mémoire (api.ts) et se renouvelle via le cookie httpOnly.
 */

export interface Account {
  email: string;
  displayName: string;
  locale: "fr" | "en";
  linkedAt: string;
}

export type AccountStatus = "loading" | "guest" | "signed_in" | "expired";

interface AccountState {
  status: AccountStatus;
  account: Account | null;
  init: () => Promise<void>;
  createAccount: (input: RegisterInput) => Promise<SyncResult>;
  signIn: (email: string, password: string) => Promise<SyncResult>;
  signOut: () => Promise<void>;
}

export const useAccount = create<AccountState>((set) => ({
  status: "loading",
  account: null,

  async init() {
    const account = await getKv<Account | null>(ACCOUNT_KEY, null);
    if (!account) {
      set({ status: "guest", account: null });
      return;
    }
    set({ status: "signed_in", account });
    if (!navigator.onLine) return;
    const outcome = await refreshSession();
    if (outcome === "denied") set({ status: "expired" });
  },

  async createAccount(input) {
    await register(input);
    const account: Account = { email: input.email, displayName: input.displayName, locale: input.locale, linkedAt: new Date().toISOString() };
    await setKv(ACCOUNT_KEY, account);
    set({ status: "signed_in", account });
    // Migration de l'invité : toute l'outbox (historique compris) part sous le nouveau compte.
    return syncEngine.flush({ force: true });
  },

  async signIn(email, password) {
    await login(email, password);
    let displayName = email;
    let locale: "fr" | "en" = "fr";
    try {
      const me = await getMe(localDay(new Date()));
      displayName = me.user.displayName;
      locale = me.user.locale === "en" ? "en" : "fr";
    } catch {
      // /me indisponible : on garde l'email comme nom affiché.
    }
    const account: Account = { email, displayName, locale, linkedAt: new Date().toISOString() };
    await setKv(ACCOUNT_KEY, account);
    set({ status: "signed_in", account });
    return syncEngine.flush({ force: true });
  },

  async signOut() {
    try {
      await logout();
    } catch {
      // Hors ligne : le cookie expirera ; on oublie le compte localement.
    }
    await db().kv.delete(ACCOUNT_KEY);
    set({ status: "guest", account: null });
  },
}));
