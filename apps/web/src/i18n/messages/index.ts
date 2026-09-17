/**
 * Registre des modules de chaînes d'interface. Chaque domaine (session, jeux,
 * compte…) a son fichier ; ajoute ici une ligne d'import et une entrée.
 * Les clés doivent être préfixées par le domaine pour éviter les collisions.
 */
import * as base from "./base.ts";
import * as games from "./games.ts";
import * as account from "./account.ts";
import * as badges from "./badges.ts";
import * as placement from "./placement.ts";
import * as session from "./session.ts";
import * as settings from "./settings.ts";
import * as tutor from "./tutor.ts";
import * as exams from "./exams.ts";
import * as challenges from "./challenges.ts";
import * as notifications from "./notifications.ts";
import * as karaoke from "./karaoke.ts";
import * as social from "./social.ts";
import * as packs from "./packs.ts";
import * as classes from "./classes.ts";
import * as journey from "./journey.ts";
import * as mobile from "./mobile.ts";
import * as offline from "./offline.ts";
import * as dashboard from "./dashboard.ts";
import * as profile from "./profile.ts";
import * as exercises from "./exercises.ts";
import * as review from "./review.ts";
import * as rewards from "./rewards.ts";
import * as missions from "./missions.ts";

/**
 * Registre des types (MessageKey). Au runtime, i18n/index.ts charge chaque fichier de ce dossier par
 * langue (`?lang=fr|en`) : domaines du premier affichage tout de suite, les autres à la demande.
 */
export const modules = [base, games, session, account, badges, placement, settings, tutor, exams, challenges, notifications, karaoke, social, packs, classes, journey, mobile, offline, dashboard, profile, exercises, review, rewards, missions] as const;
