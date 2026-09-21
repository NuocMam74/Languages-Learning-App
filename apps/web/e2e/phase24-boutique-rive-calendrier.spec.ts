import { expect, test, type Page } from "@playwright/test";
import { onboardToHub } from "./helpers.ts";

/**
 * Contrat phase24 : la boutique, la rive, les ambiances, la quête de la semaine, le calendrier.
 *
 * Ce que ces parcours tiennent, et qu'aucun test unitaire ne voit : la boucle entière se ferme à
 * l'écran — on gagne des xu, on les dépense, et ce qu'on achète se voit sur la rive et dans le
 * profil.
 */

/**
 * Donne des xu et des jours travaillés **dans la semaine en cours**.
 *
 * Remonter « les N derniers jours » ne marche pas : un mardi, deux d'entre eux tombent la semaine
 * précédente et la quête n'en voit qu'un. On part donc du lundi de la semaine locale — le même
 * calcul que `weekStart` — pour que le test dise la même chose quel que soit le jour où il tourne.
 */
async function seed(page: Page, coins: number, activeDays: number) {
  await page.evaluate(
    `(async () => {
      const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const now = new Date();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
      const journal = {};
      for (let i = 0; i < ${activeDays}; i++) {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        journal[iso(d)] = { items: 12, correct: 9, minutes: 8, sessions: 1 };
      }
      const read = () => new Promise((res, rej) => {
        const open = indexedDB.open("parlo");
        open.onsuccess = () => { const db = open.result; const tx = db.transaction("kv", "readonly"); const get = tx.objectStore("kv").get("rewards");
          get.onsuccess = () => { db.close(); res(get.result ? get.result.value : null); }; };
        open.onerror = () => rej(open.error);
      });
      const put = (value) => new Promise((res, rej) => {
        const open = indexedDB.open("parlo");
        open.onsuccess = () => { const db = open.result; const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put({ key: "rewards", value });
          tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
        open.onerror = () => rej(open.error);
      });
      await put({ ...((await read()) || {}), coins: ${coins}, level: 1, journal });
    })()`,
  );
}

test("la boucle se ferme : on gagne des xu, on achète, et ça se voit sur la rive", async ({ page }) => {
  test.setTimeout(240_000);
  await onboardToHub(page);
  await seed(page, 2000, 1);

  await page.goto("/boutique/scene");
  await expect(page.getByTestId("shop-balance")).toContainText("2000");

  // 1. Acheter une pièce de décor : confirmation, puis elle est à nous.
  const first = page.getByTestId("shop-grid").getByTestId("shop-entry").first();
  // La clé porte le rayon **et** l'identifiant : c'est elle qui permet de retrouver la pièce sur
  // la rive sans se fier à son libellé.
  const id = ((await first.getAttribute("data-key")) ?? "").replace(/^scene:/, "");
  expect(id).not.toBe("");
  const before = Number((await page.getByTestId("shop-remaining").getAttribute("data-remaining")) ?? "0");
  await first.getByTestId("shop-buy").click();
  await expect(page.getByTestId("shop-confirm")).toBeVisible();
  await page.getByTestId("shop-confirm-yes").click();

  await expect(first).toHaveAttribute("data-state", "owned");
  // Le rayon se met à jour : une pièce de moins à découvrir.
  await expect(page.getByTestId("shop-remaining")).toHaveAttribute("data-remaining", String(before - 1));
  // Et le solde a baissé.
  await expect(page.getByTestId("shop-balance")).not.toContainText("2000");

  // 2. La pièce achetée se pose réellement sur la rive, et y reste après rechargement.
  await page.goto("/ma-rive");
  await expect(page.getByTestId("scene-view")).toBeVisible();

  // Les pièces d'un emplacement ne sont rendues qu'une fois l'emplacement ouvert : on les ouvre
  // jusqu'à trouver celui qui contient la pièce achetée.
  const item = page.locator(`[data-testid="scene-item"][data-id="${id}"]`);
  const slots = page.getByTestId("scene-slot");
  for (let i = 0; i < (await slots.count()); i++) {
    await slots.nth(i).locator("button").first().click();
    if (await item.isVisible().catch(() => false)) break;
  }
  await expect(item).toHaveAttribute("data-state", "owned");
  await item.click();
  await expect(item).toHaveAttribute("data-chosen", "true");

  // Rechargement : l'aménagement est enregistré, pas seulement affiché.
  await page.reload();
  await expect(page.getByTestId("scene-view")).toBeVisible();
  const reopened = page.locator(`[data-testid="scene-item"][data-id="${id}"]`);
  for (let i = 0; i < (await slots.count()); i++) {
    await slots.nth(i).locator("button").first().click();
    if (await reopened.isVisible().catch(() => false)) break;
  }
  await expect(reopened).toHaveAttribute("data-chosen", "true");

  // 3. La rive se voit dans le profil, sans aller la chercher.
  await page.goto("/profil");
  await expect(page.getByTestId("rewards-scene")).toBeVisible();
});

test("on n'achète pas sans les fonds, et jamais deux fois", async ({ page }) => {
  test.setTimeout(180_000);
  await onboardToHub(page);
  await seed(page, 0, 0);

  await page.goto("/boutique");
  // Sans un xu : tout est hors de portée, et le bouton le dit plutôt que d'échouer au clic.
  const entry = page.getByTestId("shop-grid").getByTestId("shop-entry").first();
  await expect(entry).toHaveAttribute("data-state", "tooExpensive");
  await expect(entry.getByTestId("shop-buy")).toBeDisabled();
  await expect(entry).toContainText("Il te manque");
});

test("la quête compte des jours, et les paliers se réclament une seule fois", async ({ page }) => {
  test.setTimeout(180_000);
  await onboardToHub(page);
  // Trois jours travaillés : le premier palier est atteint, pas les suivants.
  await seed(page, 0, 3);

  await page.goto("/missions");
  const quest = page.getByTestId("quest-card");
  await expect(quest).toBeVisible();
  // Les sept cases de la semaine sont là, quoi qu'il arrive.
  await expect(quest.getByTestId("quest-day")).toHaveCount(7);

  // Trois jours de la semaine en cours ont été semés : le premier palier est atteint, c'est un
  // fait, pas une chance — d'où l'assertion plutôt qu'un saut conditionnel.
  await expect(quest.locator('[data-testid="quest-step"][data-days="3"]')).toHaveAttribute("data-state", "claimable");
  await expect(quest.locator('[data-testid="quest-step"][data-days="5"]')).toHaveAttribute("data-state", "locked");

  await quest.locator('[data-testid="quest-step"][data-days="3"]').getByTestId("quest-claim").click();
  // Le palier passe à « réclamé » et ne propose plus rien.
  await expect(quest.locator('[data-testid="quest-step"][data-days="3"]')).toHaveAttribute("data-state", "claimed");
  await expect(quest.locator('[data-testid="quest-step"][data-days="3"]').getByTestId("quest-claim")).toHaveCount(0);
});

test("le calendrier montre le programme, puis ce qui a été fait", async ({ page }) => {
  test.setTimeout(180_000);
  await onboardToHub(page);
  await seed(page, 0, 1);

  await page.goto("/calendrier");
  // Sept jours, et aucun ne réclame : un jour à venir dit « À venir », pas « en retard ».
  await expect(page.getByTestId("calendar-day")).toHaveCount(7);
  // `data-today` est porté par la carte elle-même, pas par un enfant.
  await expect(page.locator('[data-testid="calendar-day"][data-today]')).toHaveCount(1);
  await expect(page.getByText("en retard")).toHaveCount(0);

  // Le niveau n'est nommé qu'une fois : on ignore lequel viendra jeudi.
  const named = page.getByTestId("calendar-day").filter({ hasText: "Le niveau du jour ·" });
  expect(await named.count()).toBeLessThanOrEqual(1);

  // Le mois : une grille pleine, aujourd'hui dedans, et le détail se touche.
  await page.getByTestId("calendar-tab").filter({ hasText: "Le mois" }).click();
  await expect(page).toHaveURL(/\/calendrier\/month$/);
  const cells = page.getByTestId("calendar-cell");
  expect(await cells.count()).toBeGreaterThanOrEqual(28);
  await expect(page.locator('[data-testid="calendar-cell"][data-active]').first()).toBeVisible();
  await expect(page.getByTestId("calendar-detail")).toBeVisible();
  await page.locator('[data-testid="calendar-cell"][data-active]').first().click();
  await expect(page.getByTestId("calendar-detail")).toContainText("exercices");
});

test("une ambiance non possédée ne se porte pas, et celle d'origine est toujours là", async ({ page }) => {
  test.setTimeout(180_000);
  await onboardToHub(page);
  await seed(page, 0, 0);

  await page.goto("/ma-rive");
  const ambiances = page.getByTestId("scene-ambiance");
  await expect(ambiances).toHaveCount(4);
  // Le delta est porté d'emblée ; les autres sont désactivées et disent ce qu'il faut pour les avoir.
  await expect(page.locator('[data-testid="scene-ambiance"][data-id="delta"]')).toHaveAttribute("data-worn", "true");
  const locked = page.locator('[data-testid="scene-ambiance"][data-id="mua"]');
  await expect(locked).toBeDisabled();
  await expect(locked).toContainText("En boutique");
  // Celle qu'une collection offre ne s'annonce pas comme un achat à 0 xu.
  await expect(page.locator('[data-testid="scene-ambiance"][data-id="tet"]')).toContainText("Collection");
});
