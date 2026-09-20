import { overallMark, themeMarks, weakestThemes, type ContentIndex, type OverallMark, type ThemeMark } from "@parlo/core";
import { progressState } from "../learner.ts";

/**
 * Bulletin du parcours (contrat phase21 §4) : la moyenne générale, la note de chaque thème, et les
 * thèmes qui résistent. Tout se lit en local, comme le reste du profil — le bulletin doit être
 * complet en mode invité, hors ligne.
 *
 * La note vient de `lessonProgress.bestScore`, le meilleur essai. Refaire un niveau ne peut donc
 * que la faire monter : c'est la condition pour qu'on ose retravailler un thème faible.
 */

export interface MarksView {
  overall: OverallMark;
  /** Tous les thèmes, dans l'ordre du cursus — y compris ceux pas encore abordés. */
  themes: ThemeMark[];
  /** Ceux à reprendre en premier, du plus faible au moins faible. */
  weak: ThemeMark[];
}

export async function packMarks(content: ContentIndex): Promise<MarksView> {
  const { scores } = await progressState(content);
  const themes = themeMarks(content, scores);
  return { overall: overallMark(content, scores), themes, weak: weakestThemes(themes) };
}
