import type { Page } from "@playwright/test";

/**
 * Le build de production ne contient encore aucun enregistrement natif : l'index des médias du
 * bundle est vide et les exercices tonaux sont retirés (contrat phase5 §1). Pour tester les parcours
 * qui en dépendent (Chợ nổi, karaoké), on complète `mediaIndex` du bundle servi au navigateur avec
 * les médias déclarés par le contenu. Le service worker doit être bloqué (`serviceWorkers: "block"`)
 * pour que l'interception voie la requête.
 */
export async function declareAllMedia(page: Page, options: { audio?: boolean; pitch?: boolean } = {}): Promise<void> {
  const { audio = true, pitch = true } = options;
  await page.route("**/content/*/v*/bundle.json", async (route) => {
    const response = await route.fetch();
    const bundle = (await response.json()) as {
      mediaIndex?: string[];
      concepts: { audio: { src: string }[]; pitch?: string }[];
      lessons: { steps: { pitchRef?: string }[] }[];
    };
    const paths = new Set(bundle.mediaIndex ?? []);
    for (const concept of bundle.concepts) {
      if (audio) for (const track of concept.audio) paths.add(track.src);
      if (pitch && concept.pitch) paths.add(concept.pitch);
    }
    if (pitch) for (const lesson of bundle.lessons) for (const step of lesson.steps) if (step.pitchRef) paths.add(step.pitchRef);
    await route.fulfill({ response, json: { ...bundle, mediaIndex: [...paths].sort() } });
  });
}
