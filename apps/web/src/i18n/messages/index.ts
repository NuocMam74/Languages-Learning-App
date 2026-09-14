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

export const modules = [base, games, session, account, badges, placement, settings, tutor] as const;
