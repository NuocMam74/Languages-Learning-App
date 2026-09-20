import { expect, test, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onboard, skipBriefing } from "./helpers.ts";

/**
 * Catalogue complet d'exercices (contrat phase6) en navigateur réel : les types que le moteur sait
 * construire sont jouables, notés et utilisables au clavier.
 *
 * La leçon en déclare neuf ; deux d'entre eux — `speak_answer` et `speak_roleplay` — ne sont plus
 * joués du tout (`SPEAKING_STEP_TYPES`) : l'app ne fait plus parler dans le micro. Ils restent
 * dans le contenu, et la séance doit les enjamber sans trou ni blocage. C'est aussi ce que ce
 * parcours vérifie.
 *
 * Le contenu publié répartit ces types sur les unités u04 à u24 : plutôt que de débloquer vingt
 * unités, la leçon d'ouverture (`vi-south.u01.l01`, où l'onboarding dépose l'apprenant) est
 * remplacée par une leçon qui les enchaîne tous, avec les concepts et le dialogue du pack réel.
 * Rien n'est ajouté au build : tout passe par `page.route` (service worker bloqué pour que
 * l'interception voie les requêtes), comme pour le karaoké.
 *
 * Le build de production ne contient encore aucun enregistrement : `mediaIndex` est complété avec
 * les fichiers déclarés par le contenu, sans quoi `listen_transcribe` et `listen_gist` seraient
 * retirés de la séance (contrat phase5 §1, phase6 §1).
 */

test.use({ reducedMotion: "reduce", serviceWorkers: "block" });

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "..", "..", "..", "content", "vi-south");
const SHOTS = join(HERE, "..", "..", "..", "test-results", "phase6");

interface DialogueFile {
  id: string;
  turns: { speaker: string; vi: string; audio?: string }[];
  question?: { options: unknown[]; answer: number };
}

/** Premier dialogue enregistré du pack avec sa question : le support du `listen_gist`. */
const gist: DialogueFile = (() => {
  for (const file of readdirSync(join(PACK, "dialogues")).sort()) {
    const dialogue = JSON.parse(readFileSync(join(PACK, "dialogues", file), "utf8")) as DialogueFile;
    if (dialogue.question && dialogue.turns.every((t) => t.audio)) return dialogue;
  }
  throw new Error("Aucun dialogue avec question dans le pack");
})();

const fr = (fr: string, en: string) => ({ fr, en });

/** Une leçon qui enchaîne les neuf types du contenu, sur les cinq « ma » de l'unité 1. */
const STEPS: Record<string, unknown>[] = [
  { type: "listen_transcribe", concept: "c_ma_mom" },
  { type: "match_pairs", concepts: ["c_ma_ghost", "c_ma_but", "c_ma_mom"] },
  {
    type: "fill_gap",
    text: "Đây là ___ tôi.",
    answer: "má",
    options: ["má", "mà", "ma"],
    translation: fr("Voici ma mère.", "This is my mom."),
  },
  { type: "translate_to_vi", source: fr("maman", "mom"), accepted: ["má"] },
  { type: "translate_to_fr", source: "má", accepted: { fr: ["maman", "ma mère"], en: ["mom", "mother"] } },
  { type: "listen_gist", dialogue: gist.id },
  {
    type: "dialogue_choice",
    situation: fr("Tu arrives chez ton amie Lan.", "You arrive at your friend Lan's."),
    turns: [
      {
        id: "t1",
        vi: "Má khỏe không?",
        translation: fr("Ta maman va bien ?", "Is your mom well?"),
        replies: [
          { id: "r1a", vi: "Dạ, má khỏe.", translation: fr("Oui, elle va bien.", "Yes, she's well."), next: "t2", best: true, feedback: fr("« Dạ » marque la politesse.", "“Dạ” marks politeness.") },
          { id: "r1b", vi: "Ma!", translation: fr("Fantôme !", "Ghost!"), next: "t2" },
        ],
      },
      {
        id: "t2",
        vi: "Con ăn cơm chưa?",
        translation: fr("Tu as mangé ?", "Have you eaten?"),
        replies: [
          { id: "r2a", vi: "Dạ, con ăn rồi.", translation: fr("Oui, j'ai mangé.", "Yes, I have."), next: "t3", best: true },
          { id: "r2b", vi: "Mà...", translation: fr("Mais…", "But…"), next: "t3" },
        ],
      },
      {
        id: "t3",
        vi: "Ăn thêm chút nữa nghen.",
        translation: fr("Reprends-en un peu.", "Have a bit more."),
        replies: [
          { id: "r3a", vi: "Dạ, cảm ơn má.", translation: fr("Oui, merci.", "Yes, thank you."), best: true },
          { id: "r3b", vi: "Mả.", translation: fr("Tombe.", "Tomb.") },
        ],
      },
    ],
  },
  { type: "speak_answer", prompt: "Má khỏe không?", translation: fr("Ta maman va bien ?", "Is your mom well?"), accepted: ["c_ma_mom"] },
  {
    type: "speak_roleplay",
    situation: fr("Tu présentes ta famille.", "You introduce your family."),
    prompts: [
      { cue: fr("Présente ta mère.", "Introduce your mother."), concept: "c_ma_mom" },
      { cue: fr("Dis « fantôme ».", "Say “ghost”."), concept: "c_ma_ghost" },
    ],
  },
];

/**
 * Déclare les médias du contenu et remplace les étapes de `vi-south.u01.l01`.
 * Les dialogues vivent dans `core.json`, les leçons dans `units/<unité>.json` (contenu découpé).
 */
async function seed(page: Page): Promise<void> {
  await page.route("**/content/*/v*/core.json", async (route) => {
    const response = await route.fetch();
    const core = (await response.json()) as {
      mediaIndex?: string[];
      conceptIndex: { audio: { src: string }[]; pitch?: string }[];
      dialogues?: DialogueFile[];
    };
    const paths = new Set(core.mediaIndex ?? []);
    for (const concept of core.conceptIndex) for (const track of concept.audio) paths.add(track.src);
    for (const dialogue of core.dialogues ?? []) for (const turn of dialogue.turns) if (turn.audio) paths.add(turn.audio);
    await route.fulfill({ response, json: { ...core, mediaIndex: [...paths].sort() } });
  });

  // Un fichier par unité, nommé par son identifiant (`vi-south.u01.json`).
  await page.route("**/content/*/v*/units/*u01.json", async (route) => {
    const response = await route.fetch();
    const unit = (await response.json()) as { lessons: { id: string; steps: unknown[] }[] };
    const lesson = unit.lessons.find((l) => l.id === "vi-south.u01.l01");
    if (!lesson) throw new Error("Leçon vi-south.u01.l01 introuvable dans l'unité 1");
    lesson.steps = STEPS;
    await route.fulfill({ response, json: unit });
  });
}

/**
 * Premier affichage avant le parcours d'accueil : au démarrage à froid (WebKit surtout), le temps de
 * charger l'app dépasse le délai par défaut de `onboard`. On l'absorbe ici, une fois.
 */
async function warmUp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/, { timeout: 60_000 });
}

const lesson = (page: Page) => page.locator('[data-testid="lesson"]');
const check = (page: Page) => page.getByRole("button", { name: "Valider" });
const shot = (page: Page, name: string, project: string) => page.screenshot({ path: join(SHOTS, project, `${name}.png`), fullPage: true });

/** Attend l'étape suivante : la bonne réponse enchaîne seule, une erreur attend « Continuer ». */
async function advance(page: Page, cursor: string | null): Promise<void> {
  const cont = page.getByRole("button", { name: "Continuer" });
  await expect(async () => {
    const snap = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="lesson"]');
      return el ? { status: el.getAttribute("data-status"), cursor: el.getAttribute("data-cursor") } : null;
    });
    if (!snap) return; // transition vers le bilan
    expect(snap.cursor !== cursor || (snap.status === "feedback" && (await cont.first().isVisible()))).toBe(true);
  }).toPass({ timeout: 15_000 });
}

/** Répond juste à l'étape affichée et passe à la suivante. */
async function answer(page: Page, act: () => Promise<void>): Promise<void> {
  const cursor = await lesson(page).getAttribute("data-cursor");
  await act();
  await advance(page, cursor);
  // Une bonne réponse n'ouvre pas la feuille de correction : rien à confirmer.
  await expect(lesson(page)).not.toHaveAttribute("data-correct", "false");
}

test("les exercices du catalogue sont jouables, notés et accessibles au clavier", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name || "default";
  await seed(page);
  await warmUp(page);
  await onboard(page);
  await expect(page).toHaveURL(/\/lecon\/vi-south\.u01\.l01$/);
  // La leçon s'ouvre sur sa fiche de préparation (contrat phase10 §1, élargi phase16 §2) : on la
  // consulte comme un apprenant, puis on arrive sur le premier exercice.
  await skipBriefing(page);

  // 1. listen_transcribe — clavier vietnamien : la frappe Telex « mas » donne « má ».
  await expect(page.getByRole("heading", { name: "Écris ce que tu entends" })).toBeVisible();
  const field = page.getByTestId("answer-input");
  await field.click();
  await field.pressSequentially("mas");
  await expect(field).toHaveValue("má");
  // La barre de diacritiques pose le même accent sans connaître le Telex.
  await field.fill("ma");
  await expect(page.locator('[data-key="stroke_d"]')).toBeDisabled();
  await page.locator('[data-key="tone_sac"]').click();
  await expect(field).toHaveValue("má");
  await shot(page, "01-listen-transcribe", project);
  await answer(page, async () => check(page).click());

  // La barre compte ce qui se joue : neuf étapes dans le contenu, sept à l'écran — les deux oraux
  // ne gonflent pas un total qu'on n'atteindrait jamais. Et la réussite se lit au fil de la
  // séance, dès le premier item noté (jamais avant : un « 0 % » d'avant la première réponse
  // serait faux).
  await expect(page.getByTestId("lesson-step")).toHaveText("Étape 2 sur 7");
  await expect(page.getByTestId("lesson-success")).toHaveAttribute("data-score", "100");

  // 2. match_pairs — deux touchers par paire, validation d'un coup.
  await expect(page.getByRole("heading", { name: "Associe les paires" })).toBeVisible();
  await expect(check(page)).toBeDisabled();
  for (const id of ["c_ma_ghost", "c_ma_but", "c_ma_mom"]) {
    await page.locator(`[data-option-id="l${id}"]`).click();
    await page.locator(`[data-option-id="r${id}"]`).click();
    await expect(page.locator(`[data-option-id="l${id}"]`)).toHaveAttribute("data-pair", /\d/);
  }
  await shot(page, "02-match-pairs", project);
  await answer(page, async () => check(page).click());

  // 3. fill_gap — la pastille choisie remplit le trou dans la phrase.
  await expect(page.getByRole("heading", { name: "Complète la phrase" })).toBeVisible();
  await page.getByRole("radio").filter({ hasText: /^má$/ }).click();
  await expect(page.getByTestId("gap-slot")).toHaveText("má");
  await shot(page, "03-fill-gap", project);
  await answer(page, async () => check(page).click());

  // 4. translate_to_vi — clavier vietnamien, validation à la touche Entrée.
  await expect(page.getByRole("heading", { name: "Dis-le en vietnamien" })).toBeVisible();
  await page.getByTestId("answer-input").click();
  await page.getByTestId("answer-input").pressSequentially("mas");
  await answer(page, async () => page.getByTestId("answer-input").press("Enter"));

  // 5. translate_to_fr — champ ordinaire, sans barre de diacritiques ; accès au clavier seul.
  await expect(page.getByRole("heading", { name: "Qu'est-ce que ça veut dire ?" })).toBeVisible();
  await expect(page.getByTestId("diacritic-bar")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await page.getByTestId("answer-input").focus();
  await page.keyboard.type("Maman");
  await answer(page, async () => page.keyboard.press("Enter"));

  // 6. listen_gist — le dialogue tour par tour, puis la question de compréhension.
  await expect(page.getByRole("heading", { name: "Écoute la conversation" })).toBeVisible();
  await expect(page.getByTestId("gist-dialogue")).not.toContainText(gist.turns[0]!.vi);
  await page.getByTestId("gist-listen").click();
  const gistAnswer = page.locator(`[data-option-id="${gist.question!.answer}"]`);
  await expect(gistAnswer).toBeVisible({ timeout: 15_000 });
  await gistAnswer.click();
  await shot(page, "06-listen-gist", project);
  await answer(page, async () => check(page).click());

  // 7. dialogue_choice — conversation à embranchements, retour par tour, bilan des meilleurs choix.
  await expect(page.getByTestId("dialogue-turn")).toHaveAttribute("data-turn", "t1");
  await page.locator('[data-option-id="r1a"]').click();
  await expect(page.getByTestId("dialogue-feedback")).toBeVisible();
  await shot(page, "07-dialogue-choice", project);
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByTestId("dialogue-turn")).toHaveAttribute("data-turn", "t2");
  await page.locator('[data-option-id="r2a"]').click();
  await expect(page.getByTestId("dialogue-turn")).toHaveAttribute("data-turn", "t3");
  await page.locator('[data-option-id="r3a"]').click();
  await expect(page.getByTestId("dialogue-summary")).toBeVisible();
  await answer(page, async () => check(page).click());

  // 8 et 9. speak_answer et speak_roleplay sont dans la leçon, et ne sont jamais présentés : la
  // séance passe directement au bilan. Aucun écran « Répète à voix haute » sur le chemin.
  await expect(page.getByRole("heading", { name: "Leçon terminée" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("speak-question")).toHaveCount(0);
  await expect(page.getByTestId("roleplay")).toHaveCount(0);

  // La note de la séance : sept items notés, tous justes du premier coup.
  await expect(page.getByTestId("recap-score")).toHaveAttribute("data-score", "100");
  await expect(page.getByTestId("recap-tally")).toContainText("7");
  await shot(page, "08-recap", project);

  // Les sept types joués ont bien produit un `answer_submitted` ; les deux oraux, jamais présentés, non.
  const submitted = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("parlo");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("outbox").objectStore("outbox").getAll();
          req.onsuccess = () => {
            resolve(
              (req.result as { event: { type: string; payload: { exerciseType?: string } } }[])
                .filter((r) => r.event.type === "answer_submitted")
                .map((r) => r.event.payload.exerciseType ?? ""),
            );
            open.result.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
  expect(new Set(submitted)).toEqual(
    new Set(["listen_transcribe", "match_pairs", "fill_gap", "translate_to_vi", "translate_to_fr", "listen_gist", "dialogue_choice"]),
  );
});

test("l'exercice écrit reste jouable en mode silencieux et ne montre jamais la réponse", async ({ page }) => {
  await seed(page);
  await warmUp(page);
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await page.goto("/reglages");
  await page.getByRole("switch", { name: "Mode silencieux" }).click();
  await page.goto("/lecon/vi-south.u01.l01");
  await skipBriefing(page);

  await expect(page.getByRole("heading", { name: "Écris ce que tu entends" })).toBeVisible();
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toBeVisible();
  await expect(transcript).not.toContainText("má");
  await expect(transcript).toContainText("maman");
});
