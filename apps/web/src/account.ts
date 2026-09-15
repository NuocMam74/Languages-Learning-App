import { localDay } from "@parlo/core";
import { create } from "zustand";
import { deleteAccount as deleteAccountApi, getMe, login, logout, patchProfile, refreshSession, register, resendVerification, type MeResponse, type ProfilePatch, type RegisterInput } from "./api.ts";
import { db, getKv, setKv } from "./db.ts";
import { clearLearningData, getProfile } from "./learner.ts";
import { timezone } from "./notifications/push.ts";
import { profilePatchFrom } from "./profile-sync.ts";
import { restoreFromServer } from "./restore.ts";
import { ACCOUNT_KEY, syncEngine, type SyncResult } from "./sync.ts";

/**
 * Compte de l'apprenant (spec §4.1.6, contrat phase5 §4). Sans compte : mode invité, tout reste
 * local. Le compte connu est mémorisé localement (sans secret) ; le jeton d'accès vit en mémoire
 * (api.ts) et se renouvelle via le cookie httpOnly.
 */

export interface Account {
  email: string;
  displayName: string;
  locale: "fr" | "en";
  linkedAt: string;
  /** Rôles lus sur /me (visibilité des packs en préparation). */
  roles?: string[];
  /** Email vérifié (bandeau « vérifie ton email »). */
  emailVerified?: boolean;
}

export type AccountStatus = "loading" | "guest" | "signed_in" | "expired";

interface AccountState {
  status: AccountStatus;
  account: Account | null;
  init: () => Promise<void>;
  createAccount: (input: RegisterInput) => Promise<SyncResult>;
  signIn: (email: string, password: string) => Promise<SyncResult>;
  /** Retour d'un fournisseur OAuth (`/compte?oauth=ok`) : le cookie de refresh est posé. */
  completeOAuth: () => Promise<boolean>;
  /** Déconnexion : tentative d'envoi de l'outbox, puis effacement des données d'apprentissage locales. */
  signOut: () => Promise<void>;
  deleteAccount: (body: { password: string } | { confirm: "SUPPRIMER" }) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Relit le compte stocké (après une synchronisation qui a mis à jour rôles et vérification). */
  reload: () => Promise<void>;
}

function accountFrom(me: MeResponse | null, fallback: { email: string }): Account {
  return {
    email: me?.user.email ?? fallback.email,
    displayName: me?.user.displayName ?? fallback.email,
    locale: me?.user.locale === "en" ? "en" : "fr",
    linkedAt: new Date().toISOString(),
    ...(Array.isArray(me?.roles) ? { roles: me.roles } : {}),
    ...(typeof me?.user.emailVerified === "boolean" ? { emailVerified: me.user.emailVerified } : {}),
  };
}

const readMe = () => getMe(localDay(new Date())).catch(() => null);

export const useAccount = create<AccountState>((set, get) => ({
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
    const account: Account = { email: input.email, displayName: input.displayName, locale: input.locale, linkedAt: new Date().toISOString(), emailVerified: false };
    await setKv(ACCOUNT_KEY, account);
    set({ status: "signed_in", account });
    // Réponses d'onboarding et réglages : envoyés dès l'inscription (contrat phase5 §4).
    try {
      // Ligue : choix explicite seulement ; sinon le serveur applique le défaut de la motivation.
      const leagues = await getKv<boolean | null>("leagues.enabled", null);
      const patch: ProfilePatch = { ...profilePatchFrom(await getProfile()), timezone: timezone(), ...(leagues !== null ? { leaguesEnabled: leagues } : {}) };
      await patchProfile(patch);
    } catch {
      // Hors ligne ou refus : les changements suivants partiront par la file de profil.
    }
    // Migration de l'invité : toute l'outbox (historique compris) part sous le nouveau compte.
    return syncEngine.flush({ force: true });
  },

  async signIn(email, password) {
    await login(email, password);
    const me = await readMe();
    const account = accountFrom(me, { email });
    await setKv(ACCOUNT_KEY, account);
    set({ status: "signed_in", account });
    const result = await syncEngine.flush({ force: true });
    // Nouvel appareil : progression, cartes et badges du compte (contrat phase5 §4). L'écran de
    // connexion recharge ensuite l'app (profil et parcours relus), sans démonter la page en cours.
    await restoreFromServer(undefined, { notify: false });
    return result;
  },

  async completeOAuth() {
    if ((await refreshSession()) !== "ok") return false;
    const me = await readMe();
    if (!me) return false;
    const account = accountFrom(me, { email: me.user.email ?? "" });
    await setKv(ACCOUNT_KEY, account);
    set({ status: "signed_in", account });
    await syncEngine.flush({ force: true });
    await restoreFromServer(undefined, { notify: false });
    return true;
  },

  async signOut() {
    // Dernière chance pour l'outbox : ce qui ne part pas est perdu (l'apprenant a été prévenu).
    if ((await db().outbox.count()) > 0) await syncEngine.flush({ force: true }).catch(() => undefined);
    try {
      await logout();
    } catch {
      // Hors ligne : le cookie expirera ; on oublie le compte localement.
    }
    await clearLearningData();
    set({ status: "guest", account: null });
  },

  async deleteAccount(body) {
    await deleteAccountApi(body);
    await clearLearningData();
    set({ status: "guest", account: null });
  },

  async resendVerification() {
    await resendVerification();
  },

  async reload() {
    const account = await getKv<Account | null>(ACCOUNT_KEY, null);
    if (account && get().status !== "guest") set({ account });
  },
}));
