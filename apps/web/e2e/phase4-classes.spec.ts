import { expect, test, type Page, type Route } from "@playwright/test";
import { onboard } from "./helpers.ts";

/**
 * Phase 4 — espace enseignant et classes (spec §15, RGPD §14) : l'enseignant crée une classe
 * (code, QR, nouveau code), consulte le tableau (tri, tiroir élève, retrait), crée et supprime
 * un devoir ; l'élève invité passe par la création de compte, rejoint avec consentement, voit
 * le devoir sur le hub puis quitte la classe. API simulée (docs/contracts/phase4.md §0, §2).
 */
test.use({ reducedMotion: "reduce" });

const ACCOUNT = { email: "hoa@parlo.app", displayName: "Cô Hoa", locale: "fr", linkedAt: new Date().toISOString() };

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const isoDay = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function students() {
  return [
    {
      id: "st-minh", displayName: "Minh", joinedAt: "2026-09-01T10:00:00Z", lastActiveDate: isoDay(0), streak: 4, xpWeek: 120, lessonsCompleted: 6,
      currentLessonId: "vi-south.u01.l01", weakConcepts: [{ id: "c_ai", vi: "ai", errorRate: 0.72 }], exams: [{ level: "A0", passed: true, global: 0.84 }],
    },
    {
      id: "st-thao", displayName: "Thảo", joinedAt: "2026-09-02T10:00:00Z", lastActiveDate: isoDay(-3), streak: 0, xpWeek: 340, lessonsCompleted: 11,
      currentLessonId: null, weakConcepts: [], exams: [],
    },
    {
      id: "st-bao", displayName: "Bảo", joinedAt: "2026-09-03T10:00:00Z", lastActiveDate: null, streak: 0, xpWeek: 0, lessonsCompleted: 0,
      currentLessonId: null, weakConcepts: [], exams: [],
    },
  ];
}

async function mockApi(page: Page, options: { signedIn: boolean; roles: string[] }) {
  const calls: Call[] = [];
  let signedIn = options.signedIn;
  const classes: { id: string; name: string; joinCode: string; packCode: string }[] = [];
  let roster = students();
  let assignments: { id: string; title: string; lessonIds: string[]; unitId: string | null; dueDate: string | null; completed: number; total: number }[] = [];
  let myClasses = [
    {
      id: "cls-1", name: "Mardi soir", teacherName: "Cô Hoa",
      assignments: [{ id: "as-1", title: "Les tons", lessonIds: ["vi-south.u01.l01", "vi-south.u01.l02", "vi-south.u01.l03", "vi-south.u01.l04", "vi-south.u01.l05"], dueDate: isoDay(3), completed: 3, total: 5 }],
    },
  ];
  let joined = false;

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    calls.push({ method, path, body });
    const reply = (status: number, json?: unknown) =>
      status === 204 ? route.fulfill({ status }) : route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });

    if (path === "/auth/refresh") return signedIn ? reply(200, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 }) : reply(401, { detail: "no" });
    if (path === "/auth/register") {
      signedIn = true;
      return reply(201, { accessToken: "e2e-token", tokenType: "bearer", expiresIn: 900 });
    }
    if (request.headers().authorization !== "Bearer e2e-token") return reply(401, { detail: "unauthorized" });

    if (path === "/me/events") {
      const { events } = body as { events: { id: string }[] };
      return reply(200, { accepted: events.map((e) => e.id), rejected: [] });
    }
    if (path === "/me" && method === "GET") {
      return reply(200, {
        user: { id: "u-1", email: ACCOUNT.email, displayName: ACCOUNT.displayName, locale: "fr", createdAt: "2026-01-01T00:00:00Z", isGuest: false },
        profile: { motivation: null, dailyGoalMin: 10, reminderHour: null, levelEstimate: null, pathVariant: null },
        enrollment: null,
        streak: { current: 0, longest: 0, lastActiveDate: null, freezesAvailable: 0, frozenUntil: null },
        roles: options.roles,
      });
    }

    // Enseignant
    if (path === "/classes" && method === "POST") {
      const { name, packCode } = body as { name: string; packCode: string };
      const created = { id: `cls-${classes.length + 1}`, name, joinCode: "7K3Q9B", packCode };
      classes.push(created);
      return reply(201, created);
    }
    if (path === "/classes" && method === "GET") return reply(200, classes.map((c) => ({ ...c, studentCount: roster.length })));
    const regen = path.match(/^\/classes\/([^/]+)\/regenerate-code$/);
    if (regen && method === "POST") {
      classes.find((c) => c.id === regen[1])!.joinCode = "M4TR2D";
      return reply(200, { joinCode: "M4TR2D" });
    }
    const removeStudent = path.match(/^\/classes\/([^/]+)\/students\/([^/]+)$/);
    if (removeStudent && method === "DELETE") {
      roster = roster.filter((s) => s.id !== removeStudent[2]);
      return reply(204);
    }
    const assignmentCreate = path.match(/^\/classes\/([^/]+)\/assignments$/);
    if (assignmentCreate && method === "POST") {
      const input = body as { title: string; dueDate: string; unitId?: string; lessonIds?: string[] };
      const lessonIds = input.lessonIds ?? Array.from({ length: 9 }, (_, i) => `vi-south.u01.l0${i + 1}`);
      assignments.push({ id: `as-${assignments.length + 1}`, title: input.title, lessonIds, unitId: input.unitId ?? null, dueDate: input.dueDate, completed: 1, total: roster.length });
      return reply(201, { id: `as-${assignments.length}` });
    }
    const assignmentDelete = path.match(/^\/classes\/([^/]+)\/assignments\/([^/]+)$/);
    if (assignmentDelete && method === "DELETE") {
      assignments = assignments.filter((a) => a.id !== assignmentDelete[2]);
      return reply(204);
    }
    const detail = path.match(/^\/classes\/([^/]+)$/);
    if (detail && method === "GET") {
      const cls = classes.find((c) => c.id === detail[1]);
      if (!cls) return reply(404, { detail: "not found" });
      return reply(200, { ...cls, students: roster, assignments });
    }

    // Élève
    if (path === "/classes/join/7K3Q9B" && method === "POST") {
      if ((body as { consent?: boolean } | null)?.consent !== true) return reply(400, { detail: "consent_required" });
      joined = true;
      return reply(200, { classId: "cls-1", name: "Mardi soir", teacherName: "Cô Hoa" });
    }
    if (path === "/me/classes" && method === "GET") return reply(200, joined ? myClasses : []);
    if (path === "/me/classes/cls-1" && method === "DELETE") {
      myClasses = [];
      return reply(204);
    }
    return reply(404, { detail: "not found" });
  });
  return calls;
}

/** Séance commencée oubliée : sinon l'ouverture de « / » reprend la leçon (spec §4.3). */
async function forgetSession(page: Page) {
  await page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(["snapshot"], "readwrite");
      tx.objectStore("snapshot").delete("current");
      tx.objectStore("snapshot").delete("vi-south");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  });
}

async function writeAccount(page: Page) {
  await page.evaluate(async (account) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("parlo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(["kv"], "readwrite");
      tx.objectStore("kv").put({ key: "account", value: account });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  }, ACCOUNT);
}

test("enseignant : classe, QR et nouveau code, tableau trié, tiroir élève, retrait, devoir créé puis supprimé", async ({ page, context }) => {
  test.setTimeout(120_000);
  const calls = await mockApi(page, { signedIn: true, roles: ["learner", "teacher"] });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/bienvenue");
  await expect(page.getByRole("button", { name: "Commencer" })).toBeVisible();
  await writeAccount(page);

  // Lien dans les réglages réservé au rôle enseignant.
  await page.goto("/reglages");
  await page.getByRole("link", { name: "Espace enseignant" }).click();
  await expect(page).toHaveURL(/\/prof$/);
  await expect(page.getByText(/Aucune classe pour l'instant/)).toBeVisible();
  await expect(page.getByText(/jamais leur email/)).toBeVisible();

  await page.getByLabel("Nom de la classe").fill("Mardi soir");
  await page.getByRole("button", { name: "Créer la classe" }).click();
  const row = page.getByTestId("class-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("join-code")).toHaveText("7K3Q9B");
  await expect(row.getByText(/\/classe\/7K3Q9B$/)).toBeVisible();
  expect(calls.find((c) => c.path === "/classes" && c.method === "POST")?.body).toEqual({ name: "Mardi soir", packCode: "vi-south" });

  await row.getByRole("button", { name: "Copier le lien" }).click();
  await expect(row.getByRole("button", { name: "Lien copié" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/classe\/7K3Q9B$/);
  await row.getByRole("button", { name: "Afficher le QR code" }).click();
  await expect(page.getByRole("img", { name: "QR code du lien de la classe Mardi soir" })).toBeVisible();

  await row.getByRole("button", { name: "Nouveau code" }).click();
  await expect(row.getByRole("alertdialog")).toContainText("L'ancien code et l'ancien lien ne fonctionneront plus");
  await row.getByRole("button", { name: "Changer le code" }).click();
  await expect(row.getByTestId("join-code")).toHaveText("M4TR2D");

  // Tableau de la classe.
  await page.getByRole("link", { name: "Ouvrir la classe Mardi soir" }).click();
  await expect(page).toHaveURL(/\/prof\/classes\/cls-1$/);
  const rows = page.getByTestId("roster-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Bảo");
  await expect(rows.first()).toContainText("jamais");
  // Leçon en cours résolue depuis le contenu du pack.
  await expect(page.getByTestId("roster").getByText("Cinq tons à entendre")).toBeVisible();
  await expect(rows.nth(1)).toContainText("A0 réussi");

  await page.getByRole("button", { name: "Trier par XP semaine" }).click();
  await expect(rows.first()).toContainText("Thảo");
  await expect(page.getByRole("columnheader", { name: "Trier par XP semaine" })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: "Trier par XP semaine" }).click();
  await expect(rows.first()).toContainText("Bảo");
  await expect(rows.first()).toContainText("—");

  // Tiroir élève : notions fragiles (vietnamien en serif + glose locale), examens, retrait.
  await page.getByRole("button", { name: "Minh", exact: true }).click();
  const drawer = page.getByTestId("student-drawer");
  await expect(drawer).toBeVisible();
  const weak = drawer.getByTestId("weak-concept");
  await expect(weak.locator('[lang="vi"]')).toHaveText("ai");
  await expect(weak.locator('[lang="vi"]')).toHaveClass(/font-serif/);
  await expect(weak).toContainText("qui ?");
  await expect(weak).toContainText("72 % d'erreurs");
  await expect(drawer.getByText("A0 réussi")).toBeVisible();
  await drawer.getByRole("button", { name: "Retirer de la classe" }).click();
  await expect(drawer.getByRole("alertdialog")).toContainText("Retirer Minh de la classe ?");
  await drawer.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  expect(calls.some((c) => c.method === "DELETE" && c.path === "/classes/cls-1/students/st-minh")).toBe(true);

  // Devoirs : état vide explicatif, création d'une unité entière, barre d'avancement, suppression.
  await expect(page.getByTestId("assignments-empty")).toContainText("Choisis des leçons ou une unité entière");
  const form = page.getByTestId("assignment-form");
  await form.getByRole("button", { name: "Créer le devoir" }).click();
  await expect(form.getByRole("alert")).toHaveText("Donne un titre, une date et au moins une leçon.");
  await form.getByLabel("Titre").fill("Premiers sons");
  const due = isoDay(4);
  await form.getByLabel("À terminer pour le").fill(due);
  await form.getByText("Premiers sons, premiers mots", { exact: true }).click();
  // « Toute l'unité » de **cette** unité : les bases (u00, contrat phase26 §2) la précèdent
  // désormais dans la liste, repliées.
  const u01 = form.locator("details").filter({ hasText: "Premiers sons, premiers mots" });
  await u01.getByLabel("Toute l'unité").check();
  await expect(form.getByText("9 leçons choisies")).toBeVisible();
  await form.getByRole("button", { name: "Créer le devoir" }).click();
  const assignment = page.getByTestId("assignment-row");
  await expect(assignment).toHaveCount(1);
  expect(calls.find((c) => c.method === "POST" && c.path === "/classes/cls-1/assignments")?.body).toEqual({ title: "Premiers sons", dueDate: due, unitId: "vi-south.u01" });
  await expect(assignment).toContainText("1 sur 2 élèves ont terminé");
  await expect(assignment.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

  // Impression : le tableau reste, les formulaires et devoirs disparaissent.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("roster")).toBeVisible();
  await expect(form).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await assignment.getByRole("button", { name: "Supprimer" }).click();
  await assignment.getByRole("button", { name: "Supprimer le devoir" }).click();
  await expect(page.getByTestId("assignment-row")).toHaveCount(0);
  expect(calls.some((c) => c.method === "DELETE" && c.path === "/classes/cls-1/assignments/as-1")).toBe(true);
});

test("sans rôle enseignant : page d'explication, aucun lien dans les réglages", async ({ page }) => {
  const calls = await mockApi(page, { signedIn: true, roles: ["learner"] });
  await page.goto("/bienvenue");
  await expect(page.getByRole("button", { name: "Commencer" })).toBeVisible();
  await writeAccount(page);
  await page.goto("/prof");
  await expect(page.getByTestId("teacher-not-teacher")).toContainText("Tu es enseignant ?");
  expect(calls.some((c) => c.path.startsWith("/classes"))).toBe(false);
  const meCalls = calls.filter((c) => c.path === "/me").length;
  await page.goto("/reglages");
  await expect(page.getByRole("heading", { name: "Mes données" })).toBeVisible();
  await expect.poll(() => calls.filter((c) => c.path === "/me").length).toBeGreaterThan(meCalls);
  await expect.poll(() => calls.filter((c) => c.path === "/me/classes").length).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "Espace enseignant" })).toHaveCount(0);
  await expect(page.getByTestId("classes-settings")).toHaveCount(0);
});

test("élève : invitation en invité → compte → consentement → rejoint ; devoir sur le hub ; quitter la classe", async ({ page }) => {
  test.setTimeout(150_000);
  const calls = await mockApi(page, { signedIn: false, roles: ["learner"] });
  await onboard(page);
  await page.getByRole("button", { name: "Quitter la leçon" }).click();
  await expect(page.getByTestId("tutor-greeting")).toBeVisible();

  await page.goto("/classe/7k3q9b");
  await expect(page.getByText(/il te faut un compte/)).toBeVisible();
  await page.getByRole("link", { name: "Créer un compte" }).click();
  await expect(page).toHaveURL(/\/compte\?next=%2Fclasse%2F7K3Q9B$/);
  await page.getByLabel("Prénom ou pseudo").fill("Lan Nguyễn");
  await page.getByLabel("Email").fill("lan@parlo.app");
  await page.getByLabel("Mot de passe").fill("motdepasse-solide");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(page).toHaveURL(/\/classe\/7K3Q9B$/);
  const joinForm = page.getByTestId("class-join-form");
  await expect(joinForm.getByText("ton adresse email ;")).toBeVisible();
  // Plus de micro dans l'app : la liste ne promet plus rien sur la voix, elle n'en collecte aucune.
  await expect(joinForm.getByText(/voix/)).toHaveCount(0);
  await expect(joinForm.getByText(/il n'y a pas de messagerie/)).toBeVisible();
  const submit = page.getByRole("button", { name: "Rejoindre la classe" });
  await expect(submit).toBeDisabled();
  expect(calls.some((c) => c.path.startsWith("/classes/join"))).toBe(false);
  await page.getByLabel("J'accepte de partager ma progression avec l'enseignant de cette classe.").check();
  await submit.click();
  await expect(page.getByTestId("class-joined")).toContainText("Tu as rejoint « Mardi soir »");
  await expect(page.getByText("Enseignant : Cô Hoa")).toBeVisible();
  expect(calls.find((c) => c.path === "/classes/join/7K3Q9B")?.body).toEqual({ consent: true });

  // Accueil : « Devoir : … pour <jour> (3/5) » vers la prochaine leçon du devoir (contrat phase7 §2.4).
  await forgetSession(page);
  await page.goto("/");
  const weekday = new Date(`${isoDay(3)}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long" });
  const card = page.getByTestId("hub-assignment");
  await expect(card).toHaveText(`Devoir : Les tons pour ${weekday} (3/5)`);
  await expect(card).toHaveAttribute("href", "/lecon/vi-south.u01.l01");

  // Mes classes (depuis les réglages) : avancement, puis quitter avec confirmation.
  await page.goto("/reglages");
  await page.getByRole("link", { name: "Mes classes" }).click();
  await expect(page).toHaveURL(/\/mes-classes$/);
  const cls = page.getByTestId("my-class");
  await expect(cls).toContainText("Avec Cô Hoa");
  await expect(cls.getByTestId("my-assignment")).toContainText("3/5 leçons");
  await cls.getByRole("button", { name: "Quitter la classe" }).click();
  await expect(cls.getByRole("alertdialog")).toContainText("Cô Hoa ne verra plus ta progression");
  await cls.getByRole("button", { name: "Quitter", exact: true }).click();
  await expect(page.getByTestId("my-classes-empty")).toBeVisible();
  expect(calls.some((c) => c.method === "DELETE" && c.path === "/me/classes/cls-1")).toBe(true);

  await page.goto("/apprendre");
  await expect(page.getByTestId("tutor-greeting")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("hub-assignment")).toHaveCount(0);
});
