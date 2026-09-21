import { expect, test, type Page } from "@playwright/test";
import { dismissCelebrations } from "./helpers.ts";

/**
 * Critère d'acceptation Phase 0 (spec §15) : un utilisateur invité termine une
 * leçon hors ligne, et sa progression est conservée après redémarrage.
 */

async function onboard(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await page.getByRole("button", { name: "Commencer" }).click();
  // Choix de la langue (seul le vietnamien du Sud est actif).
  await expect(page).toHaveURL(/\/langue$/);
  await page.getByRole("button", { name: "Continuer" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} sur 5`)).toBeVisible();
    await page.locator("main button").first().click();
  }
  // Test de niveau puis visite guidée (contrat phase23 §3). Le test n'existe que si assez d'items
  // ont leur enregistrement natif (contrat phase10 §5) : les deux chemins sont légitimes, le test
  // n'en impose aucun. Aucun des deux ne mène à une leçon — c'est l'apprenant qui la demande.
  await expect(page).toHaveURL(/\/(placement|decouverte)$/);
  if (new URL(page.url()).pathname === "/placement") await page.getByRole("button", { name: "Je pars de zéro" }).click();
  await expect(page).toHaveURL(/\/decouverte$/);
  await page.getByTestId("discovery-skip").click();
  await expect(page).toHaveURL(/\/apprendre$/);
  await page.goto("/lecon/vi-south.u01.l01");
  await expect(page).toHaveURL(/\/lecon\/vi-south\.u01\.l01$/);
}

/** Répond à l'étape affichée, juste ou non : la leçon doit se terminer quoi qu'il arrive. */
async function playOneStep(page: Page): Promise<"done" | "step"> {
  const finished = page.getByRole("heading", { name: "Leçon terminée" });
  const lesson = page.locator('[data-testid="lesson"][data-status="answering"], [data-testid="lesson"][data-status="feedback"]');
  // Une leçon s'ouvre sur sa fiche de préparation (contrat phase10 §1, élargi phase16 §2) : on la
  // consulte volet par volet, comme un apprenant, avant d'atteindre le premier exercice. Ce
  // fichier garde ses propres aides — c'est le critère d'acceptation Phase 0, il doit tenir seul.
  const start = page.getByTestId("intro-start");
  await expect(finished.or(lesson).or(start).first()).toBeVisible();
  if (await start.isVisible().catch(() => false)) {
    const panels = page.locator('[data-testid^="brief-panel-"][data-open="false"]');
    for (let i = 0; i < 20 && (await panels.count()) > 0; i++) await panels.first().click();
    // Le bouton ne s'ouvre qu'une fois tous les volets dépliés (contrat phase16 §2) : l'attendre
    // plutôt que de cliquer dans le vide. S'il a disparu, la fiche s'est refermée toute seule et
    // on est déjà dans les exercices — le tour suivant s'en chargera.
    if (await start.isVisible().catch(() => false)) {
      await expect(start).toBeEnabled();
      await start.click();
    }
    return "step";
  }
  if (await finished.isVisible()) return "done";

  const cursor = await lesson.getAttribute("data-cursor");
  const cont = page.getByRole("button", { name: "Continuer" });
  const done = page.getByRole("button", { name: "C'est fait" });
  const radio = page.getByRole("radio").first();
  const check = page.getByRole("button", { name: "Valider" });
  // Appariement : ni bouton radio ni champ, deux colonnes de cartes à relier. La leçon 1 en
  // contient un depuis le contrat phase21 §1 (elle fait relier les cinq tons de « ma » à leur
  // sens) — sans cette branche, la séance ne va plus au bilan.
  const pairs = page.getByTestId("match-pairs");

  // L'écran peut encore être en train de se construire : attendre une action possible avant de choisir.
  await expect(cont.or(done).or(radio).or(check).first()).toBeVisible();
  const wasFeedback = (await lesson.getAttribute("data-status")) === "feedback";
  // « Continuer » décide en premier, sans se fier à `data-status` : cet attribut est une lecture
  // d'instant, et la question suivante a pu s'afficher entre-temps. S'il est là, c'est qu'il y a
  // une correction à refermer ou une carte à passer — dans les deux cas, c'est le bon geste.
  if (await cont.isVisible().catch(() => false)) {
    await cont.click();
  } else if (await pairs.isVisible().catch(() => false)) {
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
  } else if (await done.isVisible()) {
    await done.click();
  } else if (await radio.isVisible()) {
    // Après une bonne réponse, l'écran s'enchaîne seul (700 ms) : les options sont désactivées et
    // cliquer l'une d'elles attendrait sans fin. On laisse passer le tour.
    if (!(await radio.isEnabled().catch(() => false))) {
      await page.waitForTimeout(400);
      return "step";
    }
    await radio.click();
    await check.click();
  } else if (await check.isVisible()) {
    const free = page.locator("main .flex-wrap").last().locator("button:not([disabled])").first();
    if ((await free.count()) === 0) {
      await page.waitForTimeout(400);
      return "step";
    }
    await free.click();
    await check.click();
  } else {
    await cont.click(); // carte culture, mini-jeu à venir
  }

  // Attend un nouvel état stable : correction affichée, étape suivante, question de la carte culture, ou fin.
  await expect(async () => {
    if (await finished.isVisible()) return;
    // Lecture atomique : pendant l'enregistrement du bilan l'écran de séance est démonté.
    if (await start.isVisible().catch(() => false)) return;
    const snap = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="lesson"]');
      return el ? { status: el.getAttribute("data-status"), cursor: el.getAttribute("data-cursor") } : null;
    });
    if (!snap) throw new Error("transition en cours");
    const status = snap.status;
    const moved = snap.cursor !== cursor;
    // Question neuve : rien n'est encore sélectionné. Vrai pour un QCM (aucune option cochée) comme
    // pour un appariement (aucune carte retenue) — sans ce second cas, l'intervention de Cô Mai
    // après trois erreurs, qui remonte le **même** exercice sans bouger le curseur, passait pour
    // une séance bloquée.
    const freshQuestion =
      ((await radio.isVisible()) && (await page.locator('[role="radio"][aria-checked="true"]').count()) === 0) ||
      ((await pairs.isVisible().catch(() => false)) && (await pairs.locator('button[aria-pressed="true"]').count()) === 0);
    const ready = (status === "feedback" && (await cont.isVisible())) || (status === "answering" && (moved || freshQuestion || wasFeedback));
    expect(ready).toBe(true);
  }).toPass({ timeout: 10_000 });
  return "step";
}

async function finishLesson(page: Page) {
  for (let i = 0; i < 60; i++) {
    if ((await playOneStep(page)) === "done") return;
  }
  throw new Error("La leçon ne se termine pas");
}

test("un invité termine une leçon hors ligne et la retrouve après redémarrage", async ({ page, context }) => {
  await onboard(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  await context.setOffline(true);
  await finishLesson(page);
  await expect(page.getByText(/^\+\d+ XP$/)).toBeVisible();
  // Les cartes de félicitations (contrat phase9 §5) se posent **par-dessus** le bilan et couvrent
  // son bouton. Elles arrivent **après** l'affichage du bilan : regarder si elles sont là conclut
  // « non » pendant qu'elles montent, puis le clic se fait intercepter. `dismissCelebrations` leur
  // laisse le temps d'apparaître — c'est la seule implémentation, on ne la recopie pas ici.
  await dismissCelebrations(page);
  await page.getByRole("button", { name: "Retour au parcours" }).click();

  const xpBefore = await page.getByText(/^\d+ XP$/).textContent();
  expect(xpBefore).not.toBe("0 XP");

  // Redémarrage à froid, toujours hors ligne : servi par le service worker, état depuis IndexedDB.
  await page.reload();
  await expect(page.getByText("Hors ligne", { exact: false })).toBeVisible();
  await expect(page.getByText(/^\d+ XP$/)).toHaveText(xpBefore ?? "");
  await expect(page.getByText("1 jour de suite")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cinq tons à entendre" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Séance du jour/ })).toBeVisible();
});

test("une leçon interrompue reprend exactement au même endroit", async ({ page }) => {
  await onboard(page);
  // On joue jusqu'à ce que la barre avance vraiment : consulter la fiche de préparation et
  // refermer une correction prennent des tours sans faire bouger le curseur. La barre visée est
  // celle de la séance (« Étape i sur n ») — la fiche a la sienne, et prendre « la dernière »
  // revenait à mesurer la préparation.
  const progress = page.getByRole("progressbar", { name: /Étape/ });
  let before: string | null = null;
  for (let i = 0; i < 10 && Number(before ?? 0) === 0; i++) {
    await playOneStep(page);
    before = await progress.getAttribute("aria-valuenow");
  }
  expect(Number(before)).toBeGreaterThan(0);

  await page.goto("/apprendre");
  await expect(page).toHaveURL(/\/lecon\/vi-south\.u01\.l01$/);
  await expect(progress).toHaveAttribute("aria-valuenow", before ?? "");
});
