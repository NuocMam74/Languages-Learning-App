/**
 * Registre des modules de chaînes d'interface. Chaque domaine (session, jeux,
 * compte…) a son fichier ; ajoute ici une ligne d'import et une entrée.
 * Les clés doivent être préfixées par le domaine pour éviter les collisions.
 */
import * as base from "./base.ts";

export const modules = [base] as const;
