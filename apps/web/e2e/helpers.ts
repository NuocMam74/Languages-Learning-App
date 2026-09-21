import { expect, type Locator, type Page } from "@playwright/test";

/** Aides partagées des parcours e2e (séance, onboarding). */

/**
 * Traverse le premier lancement et **rend la main sur le parcours** (`/apprendre`).
 *
 * Depuis le contrat phase23 §3, l'enchaînement est : cinq questions → test de niveau → visite
 * guidée → parcours. Plus aucune leçon n'est imposée à l'arrivée ; les tests qui en veulent une
 * passent par `onboard` (voir plus bas), qui ouvre explicitement la première.
 *
 * `minutes` : un des objectifs proposés (10, 15 ou 20 — le plancher est passé à 10, contrat
 * phase21 §3).
 */
export async function onboardToHub(page: Page, minutes = "10 min") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(page.getByRole("heading", { name: "Quelle langue veux-tu parler ?" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    const choice = i === 3 ? page.getByRole("button", { name: minutes, exact: true }) : page.locator("main button").first();
    await choice.click();
  }
  // Le test de niveau n'est proposé que si assez d'items ont leur audio natif (contrat phase5 §1) ;
  // sans lui, on arrive directement sur la visite.
  const placement = page.getByRole("heading", { name: "Commençons par te situer" });
  const tour = page.getByTestId("discovery-step");
  await expect(placement.or(tour).first()).toBeVisible();
  if (await placement.isVisible()) await page.getByRole("button", { name: "Je pars de zéro" }).click();
  await expect(tour).toBeVisible();
  await page.getByTestId("discovery-skip").click();
  await expect(page).toHaveURL(/\/apprendre$/);
}

/**
 * Premier lancement, puis **ouvre la première leçon** : la forme qu'attendent les parcours qui
 * enchaînent sur une séance. L'application ne le fait plus d'elle-même (contrat phase23 §3) —
 * c'est le test qui demande la leçon, comme un apprenant la demanderait depuis le parcours.
 */
export async function onboard(page: Page, minutes = "10 min") {
  await onboardToHub(page, minutes);
  await page.goto("/lecon/vi-south.u01.l01");
  // Depuis le contrat phase10 §1, une leçon qui introduit du nouveau s'ouvre sur sa fiche de
  // découverte : l'arrivée peut donc être la fiche **ou** le premier exercice.
  await expect(page.locator('[data-testid="lesson"], [data-testid="lesson-intro"]').first()).toBeVisible();
  await expect(page).toHaveURL(/\/lecon\/vi-south\.u01\.l01$/);
}

/**
 * Déplie tous les volets de la fiche de préparation : le bouton « Commencer les exercices » reste
 * fermé tant qu'il en reste un (contrat phase16 §2). C'est le geste qu'un apprenant fait ; les
 * tests de parcours le font aussi, sinon ils butent sur un bouton désactivé.
 */
export async function openAllBriefingPanels(page: Page): Promise<void> {
  const panels = page.locator('[data-testid^="brief-panel-"][data-open="false"]');
  for (let i = 0; i < 20 && (await panels.count()) > 0; i++) await panels.first().click({ timeout: 5_000 }).catch(() => {});
}

/**
 * Referme les cartes de félicitations empilées (contrat phase9 §5). Elles se posent par-dessus
 * l'écran, en couvrent les liens, et arrivent **après** le bilan : un test qui enchaîne sur le
 * parcours doit les refermer comme le ferait un apprenant, pas les contourner.
 */
export async function dismissCelebrations(page: Page): Promise<void> {
  const layer = page.locator('[data-testid="celebration-layer"]').first();
  const ok = page.getByTestId("celebration-ok").first();
  for (let i = 0; i < 8; i++) {
    if (!(await layer.isVisible().catch(() => false))) {
      // Une carte peut encore être en route : les récompenses sont accordées après l'affichage du
      // bilan. On lui laisse un instant plutôt que de conclure trop tôt et de se faire intercepter
      // le clic suivant.
      await layer.waitFor({ state: "visible", timeout: 1_500 }).catch(() => undefined);
      if (!(await layer.isVisible().catch(() => false))) return;
    }
    await ok.click({ timeout: 5_000 }).catch(() => undefined);
    await layer.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  }
}

/**
 * Traverse la fiche de préparation si elle s'affiche, et rend la main sur le premier exercice.
 * Les tests qui ciblent un exercice précis passent par ici : depuis le contrat phase10 §1, une
 * leçon qui introduit du nouveau ne s'ouvre pas sur une question.
 */
export async function skipBriefing(page: Page): Promise<void> {
  // On laisse l'écran arriver avant de décider : `isVisible()` ne patiente pas, et une leçon met
  // un instant à s'ouvrir. L'attente est **tolérante** : si rien de tout cela n'apparaît, on rend
  // la main sans rien affirmer — c'est à l'assertion de l'appelant de dire ce qui manque, pas à ce
  // helper de masquer l'échec derrière le sien.
  const start = page.getByTestId("intro-start");
  const lesson = page.locator('[data-testid="lesson"]');
  await expect(start.or(lesson).first())
    .toBeVisible({ timeout: 30_000 })
    .catch(() => undefined);
  if (!(await start.isVisible().catch(() => false))) return;
  await openAllBriefingPanels(page);
  // Elle a pu se refermer entre-temps (un clic qui atteint la barre d'action collée en bas) : si
  // le bouton n'est plus là, c'est qu'on est déjà dans les exercices. Rien à forcer.
  if (!(await start.isVisible().catch(() => false))) return;
  await expect(start).toBeEnabled();
  await start.click();
}

/**
 * Remplit un champ et **vérifie que la valeur tient**. Un écran qui vient de s'ouvrir peut se
 * remonter dans la foulée (chunk chargé à la demande), et un champ contrôlé se vide alors sans
 * bruit : le bouton d'envoi reste fermé et le test attend un élément qui ne s'activera jamais.
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Répond à l'item affiché, juste ou non : la séance doit aller au bilan quoi qu'il arrive. */
export async function playOneStep(page: Page, finished: RegExp): Promise<"done" | "step"> {
  // Fiche de préparation (contrat phase10 §1, élargi phase16 §2) : une séance qui introduit du
  // nouveau s'ouvre sur ce que les exercices vont exiger. Elle n'est pas un item — on la consulte
  // et on passe aux exercices.
  // On guette le **bouton**, pas la fiche : il vit dans la barre d'action de `Screen`, montée juste
  // après le corps de la fiche. Guetter la fiche puis cliquer le bouton laissait une fenêtre où le
  // premier était là et le second pas encore — le clic attendait alors sans fin.
  const introStart = page.getByTestId("intro-start");
  const heading = page.getByRole("heading", { name: finished });
  const session = page.locator('[data-testid="lesson"][data-status="answering"], [data-testid="lesson"][data-status="feedback"]');
  // On attend **l'un des trois** avant de décider : fiche, exercice ou bilan. Tester la fiche sans
  // l'attendre concluait « pas de fiche » pendant qu'elle finissait de s'afficher, puis on
  // attendait un exercice qui ne viendrait pas — un échec à 5 s sur un écran parfaitement normal.
  await expect(introStart.or(heading).or(session).first()).toBeVisible();
  if (await introStart.isVisible().catch(() => false)) {
    // Une seule implémentation, celle de `skipBriefing` : elle attend que le bouton s'ouvre.
    // Cliquer sans attendre échouait en silence (le bouton reste fermé tant qu'un volet n'est pas
    // déplié) et la séance ne bougeait plus, sans que rien ne le dise.
    await skipBriefing(page);
    return "step";
  }
  await expect(heading.or(session).first()).toBeVisible();
  if (await heading.isVisible()) return "done";

  // Position de la séance : le compteur **et** la phase. `data-cursor` vaut
  // `reviewCursor + lesson.cursor` ; à la bascule révisions → leçon, `lesson.cursor` repart de
  // zéro, donc la somme reste identique alors que l'écran a changé d'exercice. Lu seul, le
  // compteur fait croire que la séance n'avance plus, et le tour échoue après dix secondes
  // d'attente — sur une machine chargée, c'est exactement là que ça tombait. La phase, elle,
  // change à cette frontière (`review` → `new`), et ne change jamais sans que la séance ait bougé.
  const cursor = await session.getAttribute("data-cursor");
  const phase = await session.getAttribute("data-phase");
  const cont = page.getByRole("button", { name: "Continuer" });
  const done = page.getByRole("button", { name: "C'est fait" });
  const radio = page.getByRole("radio").first();
  const check = page.getByRole("button", { name: "Valider" });

  // Catalogue complet (contrat phase6) : appariement, dialogue à embranchements, écrits et écoute
  // globale ne se jouent pas comme un QCM. On répond au hasard : ce qui compte ici est que la
  // séance avance jusqu'au bilan, juste ou faux.
  const pairs = page.getByTestId("match-pairs");
  const dialogueTurn = page.getByTestId("dialogue-turn");
  const input = page.getByTestId("answer-input");
  const gistListen = page.getByTestId("gist-listen");
  const roleplay = page.getByTestId("roleplay");

  const wasFeedback = (await session.getAttribute("data-status")) === "feedback";
  // « Continuer » décide en premier, sans se fier à `data-status` : cet attribut est une lecture
  // d'instant, et s'y fier se trompait dans les deux sens — cliquer un « Continuer » déjà parti,
  // ou cliquer une option que la correction venait de désactiver. S'il est là, c'est qu'il y a une
  // correction à refermer ou une carte à passer ; dans les deux cas, c'est le bon geste.
  if (await cont.first().isVisible().catch(() => false)) {
    await cont.first().click();
  } else if (await pairs.isVisible()) {
    const columns = pairs.locator("ul");
    const count = await columns.first().locator("button").count();
    for (let i = 0; i < count; i++) {
      await columns.first().locator("button").nth(i).click();
      await columns.last().locator("button").nth(i).click();
    }
    // Les associations se perdent si l'écran se remonte pendant qu'on clique : après une bonne
    // réponse, la séance enchaîne d'elle-même (700 ms) et la vue repart à zéro. « Valider » reste
    // alors fermé — on rend la main plutôt que d'attendre un bouton qui ne s'ouvrira pas.
    if (await check.isDisabled().catch(() => true)) {
      await page.waitForTimeout(200);
      return "step";
    }
    await check.click();
  } else if (await dialogueTurn.isVisible()) {
    for (let i = 0; i < 8 && !(await page.getByTestId("dialogue-summary").isVisible()); i++) {
      await page.getByRole("radio").first().click();
      if (await cont.isVisible()) await cont.click();
    }
    await check.click();
  } else if (await gistListen.isVisible()) {
    await gistListen.click();
    await expect(radio).toBeVisible({ timeout: 15_000 });
    await radio.click();
    await check.click();
  } else if (await input.isVisible()) {
    await input.fill("?");
    await check.click();
  } else if (await done.isVisible()) {
    await done.click();
    // Jeu de rôle : une réplique par prise, la même action revient jusqu'à la dernière.
    for (let i = 0; i < 4 && (await roleplay.isVisible()) && (await done.isVisible()); i++) await done.click();
  } else if (await radio.isVisible()) {
    // Après une bonne réponse, la séance enchaîne d'elle-même (700 ms) : pendant ce temps les
    // options sont désactivées et « Continuer » n'est pas encore là. Cliquer une option
    // désactivée attendrait sans fin — on laisse passer le tour, l'appelant rappellera.
    if (!(await radio.isEnabled().catch(() => false))) {
      await page.waitForTimeout(400);
      return "step";
    }
    await radio.click();
    await check.click();
  } else if (await check.isVisible()) {
    const free = page.locator("main .flex-wrap").last().locator("button:not([disabled])").first();
    // Même raison : un écran verrouillé n'offre rien à toucher. On patiente au lieu d'insister.
    if ((await free.count()) === 0) {
      await page.waitForTimeout(400);
      return "step";
    }
    await free.click();
    await check.click();
  } else {
    await cont.first().click(); // carte culture, « Continuer sans jouer »
  }

  await expect(async () => {
    if (await heading.isVisible()) return;
    // La séance a pu enchaîner sur la fiche de préparation : le rappel espacé est fini, le bloc
    // « Nouveau » s'ouvre sur ce que la leçon va exiger (contrat phase10 §1). L'écran d'exercice
    // est démonté — c'est un pas en avant, pas une transition en cours. Le tour suivant la traverse.
    if (await introStart.isVisible().catch(() => false)) return;
    // Lecture atomique : pendant la transition vers le bilan l'écran de séance est démonté,
    // et getAttribute attendrait sans fin.
    const snap = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="lesson"]');
      return el ? { status: el.getAttribute("data-status"), cursor: el.getAttribute("data-cursor"), phase: el.getAttribute("data-phase") } : null;
    });
    if (!snap) throw new Error("transition en cours");
    const status = snap.status;
    const moved = snap.cursor !== cursor || snap.phase !== phase;
    // Question neuve : rien n'est encore sélectionné. Vrai pour un QCM (aucune option cochée) comme
    // pour un appariement (aucune carte retenue) — sans ce second cas, l'intervention de Cô Mai
    // après trois erreurs, qui remonte le **même** exercice sans bouger le curseur, passait pour
    // une séance bloquée.
    const freshQuestion =
      ((await radio.isVisible()) && (await page.locator('[role="radio"][aria-checked="true"]').count()) === 0) ||
      ((await pairs.isVisible().catch(() => false)) && (await pairs.locator('button[aria-pressed="true"]').count()) === 0);
    const ready = (status === "feedback" && (await cont.first().isVisible())) || (status === "answering" && (moved || freshQuestion || wasFeedback));
    expect(ready).toBe(true);
  }).toPass({ timeout: 10_000 });
  return "step";
}

export async function playUntil(page: Page, finished: RegExp) {
  for (let i = 0; i < 120; i++) {
    if ((await playOneStep(page, finished)) === "done") return;
  }
  throw new Error("La séance ne se termine pas");
}

