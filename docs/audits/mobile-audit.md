# Parlo: mobile QA audit (prod build, 2026-09-15)

**Setup.** I ran `vite build` and served it with `vite preview` on port 4301. Tests were driven by Playwright 1.63: WebKit 26.6 for iPhone SE (375×667), iPhone 13 (390×844) and landscape (844×390), and Edge/Chromium for Pixel 7 (412×915), Galaxy (360×740) and tablet (768×1024). Every device ran the guest flow (welcome, onboarding, lesson 1, hub, all public routes, games, mock exam, offline). Every device also ran a signed-in flow with a mocked `/api` using roles learner, teacher and reviewer: settings, exams, certificates, league, challenges, express, weekly review (bilan), Cô Mai, Đối đáp, teacher pages, classes and studio.

A "keyboard open" state was emulated by focusing the input and shrinking the viewport height to 55%.

**Scripts and data**
- Scripts: `lib.mjs`, `run.mjs`, `extra.mjs`, `pwa.mjs`, `perf.mjs`, `cls.mjs`.
- Raw metrics: `results-<device>[-auth].json`, `extra-*.json`, `pwa-pixel7-i13.json`, `perf.json`, `lh/*.json`.
- Screenshots: `shots/<device>/<state>.png`.

**Tooling limits (not app bugs)**
- In WebKit, `page.route` cannot intercept fetches once the Workbox service worker controls the page. So the signed-in WebKit runs used `serviceWorkers: "block"` (`results-se-auth`, `i13-auth`, `land-auth`).
- On Windows, Playwright WebKit throws "internal error" when it navigates to a new URL while offline.
- CDP emulation of `display-mode: standalone` was not honoured by Edge.
- Safe-area insets cannot be emulated, so they were checked by reading the code only.
- Lighthouse could not keep IndexedDB state, so the hub was measured with a CDP-throttled Playwright run instead.

## P0: broken or blocking
None measured. Every route renders on all 6 devices. The main action stays reachable. Feedback-sheet buttons are always in view, even at 390 px height.

## P1: serious UX problems

1. **The hub scrolls sideways on narrow phones.** Component: `src/components/RiverPath.tsx` (label `absolute w-36 left-[calc(100%+0.75rem)]`).
   - When lesson 1 is current (80 px dot at x=50%), the label ends 9 px past the screen edge.
   - SE (WebKit): scrollWidth 384 vs innerWidth 375. iPhone 13: 391 vs 390.
   - Galaxy 360 (Chromium): the layout viewport grows to 376 px (364 px for guests), so the whole page is zoomed out and can be panned.
   - Measured in `extra-se.json` and `extra-galaxy.json` with `overflowFinder`; see `shots/se/a01-hub-signed.png`.
   - Fix: limit the label to the space left, e.g. `w-[min(9rem,calc(50vw-4rem))]`. Or flip the label side when `left + dot/2 + label > container`. Or add `overflow-x-clip` on the RiverPath wrapper.

2. **The feedback sheet hides the question and the chosen answer.** Component: `src/pages/SessionPage.tsx` `Feedback` (`fixed inset-x-0 bottom-0`).
   - Wrong-answer sheet height: 264–291 px.
     - SE: it covers 4 of the 5 tone options once "Cô Mai, pourquoi ?" is opened (sheet top at 376 of 667).
     - Landscape: 68% of the viewport (top 126 of 390); all options are hidden.
   - The page cannot be scrolled to see what lies behind the sheet.
   - Fix: add `padding-bottom` equal to the sheet height to `<main>` while the sheet is open, and scroll the selected or correct option into view. Also cap the sheet with `max-h-[70dvh] overflow-y-auto`, or render it inline in the flow in landscape (`@media (orientation: landscape) and (max-height: 500px)`).
   - Screenshots: `shots/extra-sheet-why-se.png`, `shots/land/g05-lesson-feedback-wrong.png`.

3. **Wrong tone answer shows an internal code.** Component: `Feedback` in `SessionPage.tsx`.
   - For `tone_identify`, the sheet shows "Réponse : **sac**" in serif (the raw `feedback.expected`), not "sắc — monte".
   - Cause: `expectedOption.label` is undefined for tone options.
   - Fix: when `expectedOption?.tones` exists, use `toneLabel(expectedOption.tones)`.
   - Screenshot: `shots/extra-sheet-why-se.png`.

4. **Settings page jumps while loading (CLS 0.55 guest, 0.60 signed in).** Component: `src/pages/Settings.tsx` with the lazily loaded Reminders and League sections.
   - About 1.5 s after first paint, the Rappels and Ligue sections render and push Affichage and Compte down by about 540 px. Pixel 7 at 4× CPU, measured in `cls.mjs`.
   - Fix: reserve space (render the section shells with fixed min-heights and skeletons), or wait for all async state before the first render.

5. **Signed-in hub CLS is 0.159.** Component: `src/pages/Hub.tsx`.
   - The remote greeting replaces the local one, then HubTutor, the challenge card, the league line and the assignment card insert one after another (4 shifts, 25–112 px each).
   - Fix: give fixed min-heights to the greeting and card slots, and swap text in place.

6. **First paint waits for the whole content pack.**
   - Component: `src/App.tsx` (`if (!boot) return null` until `loadPack()` has fetched and parsed `content/vi-south/v1/bundle.json`, 950 KB raw / 182 KB gzip).
   - Lighthouse mobile, cold start:

     | Page | Perf score | FCP | LCP | TBT | CLS | Accessibility score |
     |---|---|---|---|---|---|---|
     | `/bienvenue` | 77 | 3.4 s | 4.6 s | 60 ms | 0.023 | 100 |
     | `/lecon/u01.l01` | 77 | 3.3 s | 4.5 s | 10 ms | 0.001 | 95 |

   - 90% of LCP (4.1 s) is render delay. The README's "Lighthouse 91" no longer holds.
   - Initial JS+CSS is 243 KB gzip:
     - 20 files are preloaded, including NhoMat (15 KB gz), KaraokeExercise (12 KB) and use-conversation (6 KB). All three are pulled in statically by `components/exercises.tsx`.
     - The `i18n` chunk is 91 KB gz: every fr and en message module, teacher, studio and exams strings included.
   - Fix:
     - Render Welcome and the shell from a tiny `pack.json` (welcome sentence and curriculum index), and load lessons on demand.
     - `lazy()` the game, karaoke and chat exercise views.
     - Split messages per feature or per locale.

7. **Đối đáp timed question hidden while typing (landscape).** Component: `src/games/DoiDap*.tsx` with ChatView.
   - At 844×215 (keyboard open), the sticky header plus composer fill the screen. Cô Mai's question ("Em tên gì?", y=213–245) is off-screen while the 20 s timer runs.
   - Screenshot: `shots/land/k04-doidap-input.png`.
   - Fix: make the header non-sticky in short viewports (`max-height: 500px`), or keep the last tutor message pinned above the composer.

## P2: polish

- **Small grey text below AA contrast on nước, identical on WebKit and Chromium.**
  - RiverPath unit title `text-xs text-phu-sa/70`: 4.42:1 at 12 px.
  - Locked lesson titles `text-phu-sa/50`: 2.67:1 at 14 px; locked numbers `/40`: 2.13:1.
  - "voix de synthèse" `text-phu-sa/70` (AudioButton, ChatView, GameShell, ChoNoi): 4.42:1 at 14 px. This is also Lighthouse's only accessibility failure on the lesson page.
  - GamesPage "Pas encore joué" `/60`: 3.46:1.
  - Studio "À relire" / "Pas encore relu": 4.33:1 at 12 px.
  - Fix: use a solid `text-phu-sa` (10:1), or at least `/80`, for all informational text.
- **Chat placeholder clipped on 360 px.** Component: `tutor/ChatView.tsx` textarea `rows=1`. "Réponds en vietnamien…" wraps to 2 lines (scrollHeight 77 vs 49 px), so the second line is cut (`shots/galaxy/a30-conversation.png`). Fix: a shorter placeholder, or `whitespace-nowrap text-ellipsis` on the placeholder.
- **Punctuation orphaned in chat.** Tokenised tutor messages break before "?" ("không⏎?", `shots/galaxy/a30-conversation.png`). Fix: attach trailing punctuation to the previous token span, or use `white-space: nowrap` on word+punct.
- **Vietnamese inputs lack mobile keyboard hints.**
  - `#tutor-input` has `lang="vi"` but no `autocorrect="off"`, `spellcheck={false}` or `enterKeyHint="send"`; iOS with a French keyboard will "fix" Vietnamese words.
  - `acc-name` has no `autoCapitalize="words"`.
  - No input is under 16 px, so there is no iOS zoom. Email has `inputmode=email`; the class code has `autocapitalize=characters`.
- **Touch targets under 44 px.**
  - Hub pack link "Vietnamien du Sud": 235×36.
  - Chat and Đối đáp gloss word buttons: 18–90 × 32.
  - Teacher roster name sort buttons: 28×44 and 33×44.
  - Studio issue links: 21–26 px tall.
  - Fix: `min-h-11` or padding / negative margins.
  - Settings switches (56×32) are fine: `before:-inset-2` gives a 72×48 hit area.
- **Non-sticky submit buttons fall below the fold.**
  - `/compte` "Créer mon compte": y=758 on 667 (SE); not visible with the keyboard up on any phone.
  - `/classe/:code` "Rejoindre la classe": 700–756 on 740 (Galaxy), cut off.
  - `/prof/classes/:id` "Créer le devoir": y≈2480.
  - Fix: use `Screen action=` (sticky thumb-zone bar) for these forms.
- **Studio overflows at 375/360** (sw 380/376), from the tree search input in `studio/Tree.tsx` `aside`. Fix: `min-w-0 w-full` on the input.
- **Manifest.** Valid, with no CDP manifest errors; the only installability error is "in-incognito", which comes from the test harness.
  - No `id`: Chromium recommends `"/"`.
  - No `screenshots`, so there is no rich install UI on Android.
  - `orientation: "portrait"` locks the installed Android app, while landscape works in the browser; decide deliberately.
  - No `apple-mobile-web-app-title` or `apple-touch-startup-image`, so iOS gets a blank white splash.
- **iOS install hint.**
  - `InstallHint.isIos()` matches every iOS browser, but the text says "Dans Safari…". Detect `CriOS|FxiOS|EdgiOS` and tell those users to open Safari.
  - The hint sits at y≈763 of a 4700 px hub, below the fold.
- **Precache weight.** It includes unused Source Serif 4 greek, cyrillic and latin-ext subsets (about 114 KB of woff2). Import only `latin` and `vietnamese` of the variable font.
- **Audio (code review; no audio files exist in dist).**
  - `AudioButton` auto-plays from `useEffect`, not from a user gesture. That works after an in-app tap on Chromium.
  - On a cold relaunch the app jumps straight into the lesson with no gesture, so iOS blocks `play()`. The code then shows "Audio natif pas encore enregistré" (red), which is misleading.
  - Fix: catch `NotAllowedError` separately and show "Touche pour écouter".
- **Empty states.** `/jeux/karaoke_tonal` in prod only shows "Aucune courbe…" with no action, and every tone exercise shows the red missing-audio line (expected, since there are no recordings yet).

## Verified working well
- **Scrolling and layout:**
  - No horizontal scroll on any other route or device, including tablet (720 px column) and landscape.
  - Only `dvh` is used (no 100vh), and there are no double scroll containers; the teacher roster table scrolls inside its own container.
- **Thumb zone:**
  - Sticky primary buttons in the bottom zone with `pb-[max(1.25rem,env(safe-area-inset-bottom))]` on every Screen.
  - The feedback sheet also has the inset. The Continuer button is always visible (bottom 647/667 SE, 370/390 landscape).
  - The correct-answer sheet is 74 px and auto-advances after 700 ms.
- **Keyboard:** the emulated keyboard keeps the focused input and the send button visible in the chat on every phone.
- **Diacritics:**
  - The ink of the test string at 14 px is 17 px (Be Vietnam Pro) and 16 px (Source Serif 4). That needs a line-height of at least 1.21 / 1.14; body text uses 1.5–1.6.
  - No clipped text with `overflow:hidden` or `text-overflow` was found on any route. No `[lang=vi]` element has line-height below 1.25.
- **Reduced motion:** Chợ nổi boats stay still (x 20→20 px over 700 ms, vs −150→−87 without). All remaining animations run for 1 ms.
- **Service worker:** installs on Chromium and WebKit (221 precached entries) and takes control after reload. On Chromium an offline cold start renders `/bienvenue` and an uncached lesson `/lecon/…l02`. On WebKit an offline reload rendered the hub (metrics captured).
- **Android install path:** a synthetic `beforeinstallprompt` shows the "Installer" button.
- **iOS install path:** an iOS user agent shows the Safari instructions, and a standalone override hides them.
- **Theme and viewport:** theme-color `#0E5E55`; `viewport-fit=cover`.
- **Microphone:** an explanation screen appears before `getUserMedia` (`karaoke-permission`), with a fallback to a listening exercise if the mic is denied.
- **Accessibility:** Lighthouse accessibility score 100 on `/bienvenue`; labelled icon buttons; `role=radio` / `role=switch` with aria-checked.
