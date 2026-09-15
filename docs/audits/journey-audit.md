# Parlo — learner journey audit (2026-09-15)

Setup: API :8010 (temp SQLite `journey.db`, ROOT_PATH=/api, COOKIE_SECURE=false), vite dev :5183, production build
(`dist/`, `vite preview` :4183) for audio/offline honesty. Edge headless, Pixel 7, fr-FR. Persistent profiles =
devices (`profiles/phoneA|phoneB|phoneC|teacher|prodGuest`). Fake clock: day 1 = 2026-08-17, day 2 = 08-18,
day 11 = 08-27 (server fast-forward by events), day 30 = real date 09-15. Full console log: `journey-log.txt`.
Scripts: `j1-first-open.mjs` … `j11.mjs`, helpers `lib.mjs` (answers read from React props: right/wrong on demand).
Screenshots: `shots/NNN-*.png` (104 files).

Note: a first API run under Git Bash had ROOT_PATH mangled by MSYS path conversion (cookie path `C:/…/api/auth`);
fixed with MSYS_NO_PATHCONV and all account steps re-run. Not a product bug.

## 1. First open (j1, j7) — shots 001–016, prod-*
- Welcome: audio 404 (no `audio/welcome_mai.opus`) → falls back to TTS, label "voix de synthèse" (dev and prod).
- Language: "Espagnol (Amérique latine)" is selectable next to vi-south (shot 003). After switching, onboarding asks
  "Pourquoi le vietnamien ?" (j10) — Spanish pack is a 3-lesson proof, not a product.
- Onboarding 5 questions OK. Placement: every item audio-only; in prod tone items show "Audio natif pas encore
  enregistré" (prod-placement-item1). Low (0/8) → u01.l01; high (8/8) → only u02.l01 ("Douze voyelles").
- Lesson 1 u01.l01: 5/9 steps are tone exercises; prod has no audio for them → guessing. speak_repeat: "La courbe …
  pas encore enregistrée … (sans note)". Chợ nổi step offered. Recap +70 XP, badge, account offer.
- Deep link `/lecon/vi-south.u24.l08` opens a locked unit test for a new guest.

## 2. Accounts (j2, j3) — shots register-form, account-created, phoneB-*
- No "mot de passe oublié", no email verification (`/me.user` has no verified flag), Google/Apple disabled "bientôt".
- Guest→account migration: XP 70, streak 1, badge, lesson progress, SRS all reach the server. OK.
- Server profile after migration: `motivation:null, reminderHour:null, leaguesEnabled:true` although onboarding said
  family / evening / 10 min. Profile is never PATCHed (only leaguesEnabled on explicit toggle).
- Phone B login: forced through welcome → onboarding → placement → lesson 1 again. Hub then shows XP 70 / streak 1 /
  badge, but 0 completed lessons on the path, no due reviews, goal = new onboarding answer. On day 11 phone A shows 2
  checkmarks while server has 34 completed lessons (teacher dashboard shows 34). No pull of lessonProgress/SRS.
- Logout: local progress stays on device, hub still shows it (and resumes the in-progress lesson).
- Refresh-token rotation has no grace: same cookie used twice → 401 and `revoke_all` (curl test: 200, 401, then the
  fresh token 401). Observed in browser after a tab was closed during launch: user dropped to "Se reconnecter".
- Settings "Effacer les données de cet appareil" wipes local only; server account still logs in (200). Export =
  local JSON; copy says server export "sera disponible". No DELETE /me or export endpoint in routers.

## 3. Daily loop (j3, j4, j5, j10)
- Day 2 daily session: phases review → new → practice; tab killed in "new" → reopened at same cursor (resume OK).
  Recap +100 XP, streak 2, goal 10/10. Events not sent at session end: server still XP 70 right after; synced only on
  next app launch/visibility change, while hub says "Ta progression est sauvegardée sur ton compte".
- Streak 11 at day 11 → "1 protection de série" shown (OK). Day 30 (19 days idle, 1 freeze): hub, Cô Mai greeting,
  server `/me?localDate=2026-09-15` and teacher dashboard all still say streak 11.
- Empty `/revision` (nothing due): each visit → "Révision terminée +20 XP", session_completed, streak day. 5 visits =
  +100 XP (IndexedDB totals 160→260). Also synced to server (league XP).
- XP levels: `enrollment.level` stays 1 at 710 XP; no level names anywhere (grep) — spec §5.1 not implemented.
- Weekly challenge: progress + claim OK ("Badge récupéré · +50 XP"), badge count unchanged (1 sur 6).
- Reminders: VAPID not configured (`push_disabled`); denied message rendered twice on /rappels.
- Warm-up block never observed (no mastered items yet) — expected.

## 4. Progression & exams (j4) — shots exams-list, mock-*, real-*
- Personalised path: every unit l01 requires previous unit l08 → `nextLesson` boost can never reorder; family and
  travel get the same order (content/vi-south curriculum + packages/core/src/session.ts).
- Unit tests (l08) have no pass threshold: completion at any score unlocks the next unit and the exam.
- A0 unlocked after u01–u04 synced. Mock exam, all correct, speaking "C'est fait": "Tu serais reçu·e 100 %,
  Production orale non noté".
- Real exam, same answers: server 200 passed=false (speaking 0, others 1.0), then a second submit 409; UI shows
  "Le temps est écoulé depuis trop longtemps : la tentative n'a pas pu être enregistrée", attempt locked 48 h, no
  score shown. api.log: submit 200 then 409. Cause: `RealExamPage` submits from `onFinish` and again from the
  `useEffect` on `stage.kind === "submitting"`.
- No pitch references exist (`content/vi-south/pitch` empty) → every speaking item is ungraded → speaking always 0 →
  A0/A1/A2 impossible to pass, with or without microphone.
- Certificates/verify not reachable through the journey (tested only 404 path: "Aucun certificat…").

## 5. Engagement (j5, j6, j9, j11)
- /jeux: Chợ nổi, Xe ôm, Bữa cơm, Nhớ mặt playable in dev. Prod: Chợ nổi runs with "Audio natif pas encore
  enregistré" (pure guess between "to"/"tô"); express challenge = same guessing game with shareable score.
- Karaoké tonal page: "Aucune courbe de voix native n'est encore disponible" — dead end for the signature feature.
- Cô Mai without key: opening line = pack welcome; every reply "Cô Mai cherche ses mots… On réessaie avec une autre
  phrase ?" while header says "Encore 30 messages aujourd'hui". Looks broken. Quota 429 path not reachable w/o key.
- Weekly debrief fallback readable. League page says "désactivée" (local default for family) while server
  `/leagues/me` enabled=true → user is in server standings.
- Friends challenge invite on fresh device → register with `next` → auto-join, 2 participants. OK.
- Teacher (grant-role) creates class, student joins with explicit consent, dashboard lists student. OK.

## 6. Settings / i18n (j8)
- Locale en: 16/28 screens with French text (jeux ×5, examens ×3, certificats, défis, express, rappels, réglages,
  verifier, partage, defi invite). Static: 610/1137 FR keys lack `en` (studio 371, social 69, exams 60, games 53,
  base 27, notifications 18, challenges 5).
- Silent mode: listening/tone exercises print the transcript ("Transcription : má" above options ma / má) → answer
  given away, including exam listening items.

## 7. Content (content-scan.mjs)
- vi-south: 713 concepts, 194 lessons, 1426 audio refs, 0 audio files, 0 pitch files, 0 `reviewed:true`.
  254 tone steps, 187 speaking steps. No missing en glosses, images all present, culture cards complete.

## 8. Errors (j9)
- Access token TTL 15 s: SPA navigation after 20 s → 401 → refresh → retry OK.
- API blocked mid-session: session continues locally; real exam start → "L'examen certifiant demande une connexion";
  Cô Mai → "Cô Mai n'est pas joignable". Offline (prod SW): hub, /jeux, mock exam available. Network flapping: outbox
  drained, no rejects.

## 9. Static
- No TODO/FIXME. All web API calls exist in routers. Missing server features: password reset, email verification,
  OAuth (501), account deletion, server export, progress pull (`/me/srs/due`, `/me/session/next` unused by web).
- Server trusts client XP (`xpGained` ≤ 100000) and lesson_completed (exam unlock by events).
