# Parlo — Gap analysis vs SPEC-parlo-vietnamien-sud.md

Audit date: 2026-09-15. Read-only. Legend: ✅ implemented & tested · 🟡 partial · ❌ missing.
Paths relative to repo root.

## Content snapshot (content/vi-south)

- 24 units, 194 lessons (each unit: 6–7 lessons + review + unit_test), 713 concepts, 119 culture cards,
  3 exams (A0 25 items: listening 8 / reading 6 / vocabulary 6 / speaking 5), placement.json 14 items,
  games/xe_om.json, lexical-variants.json, _review/doubts.json.
- Step types used: listen_pick_text 600, build_sentence 429, listen_pick_image 215, speak_repeat 160,
  tone_identify 142, culture_card 125, spot_the_south 95, tone_minimal_pair 85, game:cho_noi 72,
  tone_produce 27, game:bua_com 25, game:xe_om 6. **Zero** listen_transcribe / match_pairs / fill_gap /
  translate_* / listen_gist / speak_* (other than repeat) / dialogue_choice.
- `reviewed: true` in 0 / 1035 JSON files. `audio/` = 0 files, `pitch/` = 0 files, yet every concept
  declares `audio[]` refs (0 concepts with empty audio arrays) and one voice only (`tuan_ct_m` never used).
- content/es: 1 unit, 3 lessons, 22 concepts, 3 culture cards (ADR 0006).

## PART A — Spec coverage matrix

### §3 Experience principles
| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 3.1 | Session 5–10 min, capped | 🟡 | `packages/core/src/session.ts` caps with ±20 % tolerance; estimate uses constants (REVIEW_ITEM_SECONDS=15, lesson.estimatedMinutes), not measured durations ("durée estimée réelle" §4.2 not derived from history). |
| 3.2 | Listen/speak before read | 🟡 | Ordering is content-driven; but no audio assets → in prod TTS fallback for non-tone, silence for tone items (`apps/web/src/audio.ts:49-51`). |
| 3.3 | No lives; error re-queued | ✅ | `engine.ts:369` requeue, MAX_ATTEMPTS=2; tested engine.test.ts. |
| 3.4 | One primary action/screen | ✅ | `components/exercises.tsx` Layout sticky bottom action. |
| 3.5 | Immediate explanatory feedback | 🟡 | `SessionPage.tsx:123-149` shows explain if content has one; otherwise just "wrong" + answer (no guaranteed sentence). |
| 3.6 | Resumable exactly | ✅ | snapshot per pack (`db.ts`), `App.tsx:76` resume; e2e guest-offline. |
| 3.7 | Offline by default for downloaded lessons | 🟡 | Whole pack bundle.json precached (`vite.config.ts:43`); no per-unit download; audio not precached. |
| 3.8 | Visible progression (map, milestones, certificates) | ✅ | `RiverPath.tsx`, certificates pages. |

### §4.1 First launch
| Req | Status | Evidence / gap |
|---|---|---|
| Welcome sentence audio + translation, replay | 🟡 | `pages/Welcome.tsx` ok; `audio/welcome_mai.opus` missing → TTS (`playPath(..., true)`), likely a Northern vi-VN voice. |
| Language choice; others "coming soon" with vote/signup | 🟡 | `pages/LanguageChoice.tsx:17` hardcoded `ANNOUNCED`; interest stored only locally (`setLanguageInterest`) → no product signal reaches server. `CourseOut.coming_soon` exists server-side but unused by client. |
| Onboarding 5 questions | ✅ | `pages/Onboarding.tsx`. `entourage`, `selfLevel` never used downstream (not synced: no profile event). |
| Placement 90 s, 8 adaptive audio items | ✅ | `core/placement.ts`, `pages/Placement.tsx`, placement.test.ts. |
| First lesson before account | ✅ | `Onboarding.tsx:52-54`. |
| Account offer at end of lesson 1; email+pwd; Google/Apple; guest | 🟡 | Offer ✅ (`SessionPage.tsx:230`). **OAuth ❌**: buttons disabled "bientôt" (`pages/Account.tsx:38-47`), `/auth/oauth/{provider}` returns 501. |

### §4.2 Hub
| Req | Status | Evidence |
|---|---|---|
| Tutor greeting server-side cached 12 h | ✅ | `services/tutor.py:367` cache key per user/day/locale; `Hub.tsx:49`. Guests get local template. |
| Single "Séance du jour" + real duration | 🟡 | Button ✅; duration is a model estimate (see 3.1). |
| Streak + protection shown | ✅ | `Hub.tsx:97-99`. |
| Path map, current unit expanded, next greyed | ✅ | `RiverPath.tsx`. |
| Weekly challenge + league | ✅ | `ChallengeCard`, `LeagueHubLine`. |
| Review access "12 mots à revoir" | ✅ | `Hub.tsx:132`. |

### §4.3 Session anatomy
| Block | Status | Evidence |
|---|---|---|
| Warm-up 3 mastered | ✅ | `session.ts:49-57`. |
| Spaced review due, varied formats | ✅ | `core/review.ts` format selection. |
| New 3–6 items audio-first | 🟡 | Lesson-driven; audio missing in prod. |
| Practice (game / tutor dialogue / oral) | 🟡 | Only if the lesson contains a `game` step; SessionBlock has no dedicated practice planning (`session.ts:18-22`). |
| Recap: "what you can say more than yesterday", XP, streak, next step | ✅ | `SessionPage.tsx:156-242`. |

### §4.4 Exercise types (engine = `packages/core/src/engine.ts`, UI = `apps/web/src/components/exercises.tsx`)
| Type | Schema | Engine | UI | Status |
|---|---|---|---|---|
| listen_pick_image | ✅ | ✅ | ✅ | ✅ |
| listen_pick_text (tonal minimal-pair traps) | ✅ | ✅ | ✅ | ✅ (`review.ts` tonal distractors) |
| listen_transcribe (+ vi keyboard) | ✅ lesson.schema.json:93 | ❌ → `unsupported` (engine.ts:215) | ❌ placeholder "pas encore disponible" | ❌ |
| listen_gist | ❌ | ❌ | ❌ | ❌ (no `dialogues/` in content either) |
| speak_repeat | ✅ | ✅ | ✅ KaraokeExercise | 🟡 ungraded in prod (no pitch refs; derive-from-audio is DEV only, `karaoke/reference.ts:36`) |
| speak_answer | ❌ | ❌ | ❌ | ❌ |
| speak_roleplay | ❌ | ❌ | ❌ (Đối đáp game partially covers) | ❌ |
| tone_identify (contours graph) | ✅ | ✅ | 🟡 labels only, no contour graphic in option buttons (`exercises.tsx:154-155`) | 🟡 |
| tone_minimal_pair | ✅ | ✅ | ✅ | ✅ (hỏi/ngã guard `content-checks.ts:168-171`) |
| tone_produce | ✅ | ✅ | ✅ | 🟡 same pitch-ref gap |
| match_pairs | ✅ | ❌ | ❌ | ❌ |
| build_sentence | ✅ | ✅ | ✅ | ✅ |
| fill_gap | ✅ | ❌ | ❌ | ❌ |
| translate_to_vi / translate_to_fr | ✅ | ❌ | ❌ | ❌ |
| spot_the_south | ✅ | ✅ | ✅ | ✅ |
| culture_card (≤60 words + audio + question) | ✅ | ✅ | ✅ | 🟡 60-word limit not validated (content-checks.ts:131) |
| dialogue_choice | ❌ | ❌ | ❌ | ❌ |
Note: validator (`content-checks.ts:197-222`) and studio (`studio/templates.ts:10-19`, `StepForm.tsx:73-169`) **accept** the 5 engine-unsupported types → an editor can publish steps that learners see as "not available" and that are silently ungraded.

### §4.5 Feedback loop
| Req | Status | Evidence |
|---|---|---|
| Correct: short sound, animated +XP, no interstitial | 🟡 | 700 ms banner (`SessionPage.tsx:15,120`); no sound, no per-item XP animation. |
| Wrong: content explanation, audio replays, requeue end of session, back tomorrow | 🟡 | Explanation ✅ when present; **audio does not replay**; requeue ✅; "tomorrow" via FSRS again ✅. |
| 3 consecutive errors → Cô Mai micro-explanation + easier exercise | 🟡 | Nudge text only (`engine.ts:362`, `SessionPage.tsx:78-80`); no easier exercise substitution. |

### §5.1 Progression
| Req | Status | Evidence |
|---|---|---|
| XP 10 new / 5 review / +20 session / challenge bonus | ✅ | `core/progress.ts:9-11`, `challenges.py:221`. Server trusts client `xpGained` (≤100 000/session) — see Part B. |
| Profile levels 1–50 named (river/market theme) | ❌ | `Enrollment.level` created =1 and never updated (`services/learner.py:37`); no level names anywhere. |
| Streak: day with ≥1 finished session | ✅ | `core/streak.ts`, `services/streak.py` (unit-tested each side; not in parity fixtures). Displayed streak never decays (Part B). |
| Freeze credit every 10 days, max 2, auto-consumed | ✅ | `streak.ts:18-19,61-63,69-74`. |
| "Je pars quelques jours" freeze | 🟡 | ✅ `Hub.tsx:166`; bug: retroactive (Part B). |
| Daily goal chosen, editable, gauge | ✅ | `Settings.tsx:123`, `Hub.tsx:102-117`. |

### §5.2 Challenges
| Req | Status | Evidence |
|---|---|---|
| Weekly thematic challenge, progress bar, badge | ✅ | `core/challenges.ts`, `services/challenges.py` (claim → `challenge_<kind>` badge). |
| Express 60 s, score, replayable, shareable image | ✅ | `social/ExpressPages.tsx`, `express-image.ts`. |
| Friends challenge, invite link, 7-day comparison | ✅ | `routers/social.py`, `FriendsPages.tsx`. |

### §5.3 Leagues
| Req | Status | Evidence |
|---|---|---|
| 30/group, weekly XP ranking, 5 divisions, promo/relegation | ✅ | `services/leagues.py:31-35`. |
| Toggle in settings; off by default for family | ✅ | `leagues/league-store.ts:15`, `services/learner.py:25`. (Also "roots".) |

### §5.4 Badges
| Req | Status | Evidence |
|---|---|---|
| Assiduity 7/30/100/365 | 🟡 | only `streak_7`, `streak_30` (`core/badges.ts:10`). 100, 365 ❌. |
| "Oreille tonale" 95 % on 50 tone items | ✅ | `badges.ts:24-26,72-75`. |
| "Sans accent du Nord" | ❌ | none. |
| "500 mots" | ❌ | `words_50` only. |
| Culture: finish a culture unit, listen to 20 dialogues | ❌ | none (no dialogues content). |
| Drawn icons, no emoji | ✅ | `components/BadgeIcon.tsx`. |

### §5.5 Certificates
| Req | Status | Evidence |
|---|---|---|
| A0 Bén rễ / A1 Mở lời / A2 Trò chuyện | ✅ | `content/vi-south/exams/a0..a2.json`. |
| 25 items, 15 min, 4 skills incl. graded speaking, 75 %, 1 try / 48 h | 🟡 | Implemented (`core/exams.ts`, `services/exams.py`, `routers/exams.py`). **Blocking in prod**: speaking items need a pitch reference; none exist → score null → item false (`exams.ts:175-176`), skill ≥ 0.5 required (`exams.ts:205`) → nobody can pass. |
| Server PDF: name, date, level, per-skill score, unique code, `/verifier/{code}` | ✅ | `services/pdf.py`, `routers/exams.py:206-228`, `CertificatePages.tsx`; test_certificates_pdf.py. |
| Square share image | ✅ | `certificates/share-image.ts`. |
| Free mock exam anytime with gaps | ✅ | `ExamPages.tsx` MockExamPage; e2e phase2-exams. |

### §5.6 Games
| Game | Status | Evidence |
|---|---|---|
| Chợ nổi | ✅ | `core/games/cho-noi.ts`, `web/games/ChoNoi.tsx`. |
| Karaoké tonal | 🟡 | F0 YIN + DTW + plot ✅ (`core/pitch/*`, `karaoke/*`, karaoke.spec.ts); no reference curves in content → unusable in prod. |
| Xe ôm | ✅ | `XeOm.tsx`; data import hardcoded to vi-south (`games/xe-om-data.ts:11-13`). |
| Bữa cơm | ✅ | `BuaCom.tsx`. |
| Đối đáp | ✅ | `DoiDap.tsx`, conversation mode `doi_dap`. |
| Nhớ mặt 4×4 | ✅ | `NhoMat.tsx`. |
| reduced-motion, no engine | ✅ | `games/platform.ts`. |

### §5.7 Cô Mai
| Capability / guardrail | Status | Evidence |
|---|---|---|
| Daily greeting contextualised | ✅ | `services/tutor.py` greeting. |
| "Cô Mai, pourquoi ?" on each correction | ✅ | `SessionPage.tsx:135`, `/tutor/why`; shared cache. Guests/offline: canned text. |
| Free guided conversation text+voice, known vocab +15 % glossed, soft correction | ✅ | `services/conversation.py:62,275-282`; `tutor/ChatView.tsx`, `speech.ts`. |
| Weekly debrief | ✅ | `services/debrief.py`, `DebriefPage.tsx`. |
| Path adaptation proposals (insert unit) | ❌ | no code (grep "propos/insert/adapt" none); `curriculum.paths.*.extraUnits` never populated. |
| Server-only model call, auth, rate-limited | ✅ | `routers/tutor.py`, `services/rate_limit.py` (see Part B for per-process limiter). |
| System prompt constraints | ✅ | `tutor.py:85-104`. |
| Per-user daily budget + graceful degrade | ✅ | `TUTOR_DAILY_QUOTA`, `_greeting_fallback(... quota_exceeded)`. "voici la fiche de grammaire" link ❌. |
| Aggressive cache of non-personalised | ✅ | why cache keyed by pack/version/step/answer. |
| South-lint on output, regenerate once, then canned | ✅ | `tutor.py:229-259`, `conversation.py:267`. |

### §5.8 Notifications
| Req | Status | Evidence |
|---|---|---|
| ≤1/day at chosen hour, Cô Mai voice, non-guilt | 🟡 | `services/push.py:177` dedupe is **per subscription** (`last_notified_on`) → one per device, not per user. Onboarding "matin/midi/soir" → hour mapping ok. |
| Web Push VAPID; iOS install explanation first | ✅ | `sw.ts:94-128`, `notifications/push.ts`, `InstallHint.tsx`. |

### §6 Pedagogy
| Req | Status | Evidence |
|---|---|---|
| 6 blocks / 24 units / ~200 lessons | ✅ (structure) | 194 lessons, all `reviewed:false`. |
| Unit = 6–10 lessons + review + unit test gating next | ✅ | curriculum stats above. |
| Personalised paths (family unit at pos 3; travel: market/transport/restaurant up + "urgences" module; work: formal register) | 🟡 | Only tag boost sort (`session.ts:91-114`, curriculum `paths` with boostTags). No `extraUnits` (urgences module ❌), no example variation per profile. |
| FSRS ts-fsrs client, state persisted server | ✅ | `core/srs.ts`, `services/srs.py`, events. |
| Card per concept, multiple formats | ✅ | |
| Rating from time + correctness + format | ✅ | `srs.ts:108-141`. |
| Per-session review cap, overflow to tomorrow | ✅ | `session.ts:68-75`. |

### §7 Southern contract
| Req | Status | Evidence |
|---|---|---|
| 6 written / 5 heard; never oppose hỏi–ngã | ✅ | `pack.json` heardClasses; `content-checks.ts:168-171`. |
| Southern contours displayed | 🟡 | depends on pitch refs (none). |
| Bloc 0 comparative North/South audio (d/gi/v, s/x, tr/ch, r, finals) | ❌ | no audio; no step type or schema field for paired N/S audio. |
| Lexical variants table as data + consultable sheet | 🟡 | `lexical-variants.json` ✅, spot_the_south ✅; no learner-facing "fiche" page (routes in `App.tsx` have none). |
| Native audio pipeline wav→LUFS→opus+m4a | ✅ tooling | `scripts/audio/process.ts`, `docs/AUDIO.md`; 0 recordings. |
| TTS fallback only, never for tones; runtime voice check; `audio.source`; TTS marker | 🟡 | `audio.ts:33-51` voice pick by name hint only (no rejection of Northern voice); marker ✅ `AudioButton.tsx:52`. In DEV TTS allowed for tones. |
| Two speeds (pitch-preserving slow file) | 🟡 | playback supports `speed: slow` files; none exist; pipeline time-stretch in scripts/audio. |
| Two voices (f + m, Saigon + delta) | 🟡 | declared in pack.json; content references only `mai_hcm_f`. No voice alternation logic in UI. |
| Telex/VNI taught in bloc 1 with in-app keyboard | ❌ (learner) | `studio/telex.ts` exists for editors only; no learner input exercise. |

### §8 Technical differentiators
| Req | Status | Evidence |
|---|---|---|
| Manifest, maskable icons, standalone, theme | ✅ | `vite.config.ts:19-35`. |
| Install help iOS/Android | ✅ | `InstallHint.tsx`. |
| SW: precache shell, lesson content SWR, audio dedicated cache quota + LRU | 🟡 | `sw.ts:64-78` audio CacheFirst maxEntries 2000 / 90 d / purgeOnQuotaError; content JSON is precached bundle, and the client reads IndexedDB copy first. |
| Explicit unit download "Disponible hors ligne" + size | ❌ | no code. |
| IndexedDB/Dexie content, SRS, outbox | ✅ | `db.ts` v1→v3 migrations, multi-pack.test.ts. |
| Timestamped events, reconnect sync, conflict rule | 🟡 | push-only. **No pull of SRS cards / lesson progress / profile** → new device / reinstall / "erase this device" = empty path (`sync.ts:114-168` only totals/badges/activity). |
| Guest → account migration | ✅ | `account.ts:52-53` (see Part B for account switching leak). |
| Karaoke F0/YIN/DTW/normalisation/score/100 % local/mic fallback | ✅ algorithm | `core/pitch/*` tested; reference data missing. |
| Telex+VNI live, diacritic bar, NFC both sides | 🟡 | studio only; NFC ✅ `core/text.ts`, `services/text.py`. |
| Tolerant comparison + tone-only message | ✅ | `text.ts:89-109`; used by build_sentence & choice near-miss. |
| south-lint package; CI blocking | ✅ | `packages/south-lint`, `scripts/south-lint-content.ts`, ci.yml. |
| south-lint runtime on tutor | ✅ | Python port `apps/api/app/south_lint.py`, cases.json parity. |

### §9 Content-driven
| Req | Status | Evidence |
|---|---|---|
| Pack layout (pack, curriculum, concepts, lessons, dialogues, culture, variants, audio, pitch, schema) | 🟡 | `dialogues/` ❌; audio/pitch empty. |
| Engine unaware of language | 🟡 | engine ok via features; but tutor persona, xe_om loader, text.ts `toLocaleLowerCase("vi")`, schema field `vi`, Tone enum are Vietnamese (Part C). |
| `features` activates modules | ✅ | `types.ts:117-156`, content-checks. |

### §10 Stack
| Item | Status | Evidence |
|---|---|---|
| React 19, TS strict, Vite, Tailwind v4, React Router, Zustand, Dexie, vite-plugin-pwa, Vitest/TL, Playwright | ✅ | `apps/web/package.json`. |
| Radix primitives | ❌ | not a dependency. |
| TanStack Query | ❌ | not a dependency (ADR 0001 claims it). |
| Motion | ❌ | CSS keyframes instead (acceptable but deviates). |
| FastAPI/Pydantic2/SQLAlchemy2/Alembic/Postgres/argon2/JWT+httpOnly refresh | ✅ | pyproject, `services/auth.py`. |
| OAuth Google/Apple | ❌ | |
| S3/R2 media | 🟡 | `services/storage.py` (boto3) for studio audio. |
| PDF WeasyPrint | ✅ | `services/pdf.py`. |
| Anthropic proxy, SSE, quotas | ✅ | `tutor_llm.py`, `routers/tutor.py:123`. |
| APScheduler jobs | 🟡 | challenges, leagues, push scheduled (`scheduler.py`); tutor 90-day purge **not scheduled** (manual `maintenance purge-tutor`). |
| CDN versioned content `/content/vi-south/v3/` | 🟡 | URL scheme ✅; but version is baked into the web build (`__PACKS__`, `content.ts:22`); `/courses/{code}/manifest` never called by client. |
| CI lint/types/tests/schema/south-lint/build/Lighthouse | ✅ | `.github/workflows/ci.yml`. |
| Sentry front+back | ❌ | none. |
| Product event log in Postgres | ✅ | `processed_events` payloads. |

### §11 Data model — ✅ essentially all tables present (`apps/api/app/models.py`, migrations 0001–0005) plus extras (drafts, classes, leagues, friends). Gaps: `enrollments.level` unused; `certificates.pdf_url` generated on demand.

### §12 API
| Route | Status |
|---|---|
| /auth/register, login, refresh (+logout) | ✅ |
| /auth/oauth/{provider} | ❌ |
| GET /me, PATCH /me/profile | ✅ |
| GET /courses, /courses/{code}/manifest | ✅ (manifest unused by client) |
| GET /me/session/next | ✅ (client plans locally) |
| POST /me/events idempotent | ✅ |
| GET /me/srs/due | ✅ (unused by client) |
| POST /me/lessons/{id}/complete | 🟡 replaced by `lesson_completed` event (acceptable) |
| /challenges/current, claim | ✅ |
| /leagues/me | ✅ |
| /exams/{id}/start, /exams/attempts/{id}/submit | ✅ |
| /certificates/{id}.pdf, /verify/{code} | ✅ |
| /tutor/message SSE, /tutor/greeting | ✅ (as /tutor/conversations/{id}/messages, /tutor/greeting, /tutor/why) |
| /push/subscribe | ✅ |
| Rate limit /tutor/*, /auth/* | 🟡 see Part B |
| GDPR export / delete account | ❌ |

### §13 Design & a11y
| Req | Status | Evidence |
|---|---|---|
| Palette 6 named colours | ✅ | `app.css:12-19` (+ `ngoc-sang` helper). |
| Be Vietnam Pro + Source Serif 4, line-height ≥1.5 body | ✅ | `app.css`. Test-string verification: not automated. |
| 480/720 px column, bottom actions | ✅ | |
| River path SVG | ✅ | `RiverPath.tsx`. |
| AA contrast, focus visible, 44 px targets, reduced motion | ✅ | `app.css:56-80`, min-h-11; Lighthouse a11y 100 per README. |
| Captions on all audio / silent mode | 🟡 | transcripts only when silent mode on (`AudioButton.tsx:54`). |

### §14 Compliance
| Req | Status | Evidence |
|---|---|---|
| Minimisation, no audio upload | ✅ | pitch local; `pronunciation_scores` score only. |
| Explicit analytics consent | ❌ | no analytics, no consent UI. |
| Plausible / cookie-less analytics | ❌ | |
| Export & deletion from settings (server-side) | ❌ | Settings export/erase = **this device only** (`i18n/messages/settings.ts:20-23`); no API route. |
| EU hosting | ❓ | infra not in repo. |
| Mic permission explanation "never uploaded" | ✅ | karaoke i18n. |
| Min age 13/16 at signup | 🟡 | client checkbox only (`Account.tsx:70,143`); not sent/enforced server-side, no country logic. |
| No social chat in MVP | ✅ | |

### §15 Phases
| Phase item | Status |
|---|---|
| P0 acceptance: guest finishes lesson offline, persists after restart | ✅ `e2e/guest-offline.spec.ts` |
| P1 6 exercise types | ✅ |
| P1 units 1–4 ≈30 lessons ≈150 concepts, working audio | 🟡 structure ✅, audio ❌ |
| P1 onboarding+placement+hub+session+SRS | ✅ |
| P1 streak, XP, daily goal, 6 badges | ✅ |
| P1 Chợ nổi, tutor greeting + why | ✅ |
| P1 acceptance: 7 days real use, Lighthouse ≥90, iOS/Android install | 🟡 Lighthouse in CI; real-device items unverifiable |
| P2 karaoke, Xe ôm, Bữa cơm, weekly challenges, push, freeze, exams A0/A1 + PDF + verify, units 5–11 | ✅ code / 🟡 data |
| P2 acceptance: pass A0 & download verifiable diploma | 🟡 only with mocked speech scores; impossible with shipped content |
| P2 acceptance: pronunciation stable (<10 pts) | ✅ synthetic (karaoke.spec.ts) |
| P3 free conversation, debrief, leagues, friends, share, units 12–24, A2, 2nd pack | ✅ |
| P3 subscription [À ARBITRER] | 🟡 `docs/decisions/abonnement.md`, nothing coded |
| P4 content studio (edit, record audio, F0, publish) | ✅ code; publish does not reach clients (Part B) |
| P4 teacher/class space | ✅ |

### §16 Deliverables
| Item | Status |
|---|---|
| ADRs (5+) | ✅ 6 ADRs |
| Monorepo + CI | ✅ |
| JSON schemas + validator + 3 template lessons | ✅ |
| core with unit tests | ✅ |
| API then PWA | ✅ |
| CONTENT.md for native reviewer | ✅ |
| README one-command docker compose + seed | 🟡 two commands (`up` then `exec seed`) |
| Demo page per exercise component | ✅ DEV-only `/demo` |
| No `any`, strict TS | ✅ (not exhaustively verified) |

## PART B — Correctness, security, privacy, performance

Legend: [V] re-read and confirmed by lead auditor; [A] reported by sub-audit with file:line (spot-checked where noted).
Tests run: packages/core vitest 239/239 pass; pytest test_core_parity + test_challenges 103/103 pass; parity fixtures regenerate byte-identical.

### P0
1. [V] Permanent sync lockout after resuming an old session (Postgres). `apps/web/src/learner.ts:218` resumes a snapshot of any age; `learner.ts:363` sends `durationMs = now - startedAt` uncapped (only daily-goal seconds capped at :372). `apps/api/app/schemas/events.py:95` `duration_ms: NonNegative` (no max) -> `services/events.py:373` -> `models.py:178` `Integer` (int4 ~ 24.9 days). DataError is not `EventRejectedError` (`events.py:105`) -> whole batch 500 -> `sync.ts:93-97` retries the same batch forever; nothing behind it syncs, `/me` never pulled. Same unbounded pattern: `game_played.duration_ms` (models.py:357), `response_ms`.
2. [V] Progress not restorable from server. Sync is push-only: `sync.ts:136-168` applies only XP/streak/badges/activity; no client call to `/me/srs/due`; no endpoint for lesson progress or per-pack profile. New phone / reinstall / storage eviction / Settings "Effacer les données de cet appareil" => lesson 1, no SRS (copy at `i18n/messages/settings.ts:23` implies server keeps it). Later `srs_card_updated` from the fresh device are dropped by `merge_cards` (`events.py:282-283`) => server/client schedules diverge.
3. [V, deployment-conditional] Public default JWT secret, no startup guard: `apps/api/app/config.py:22`; same default in docker-compose => forged tokens for any user/admin.

### P1
4. [V] Shared `/tutor/why` cache poisoning: key at `services/tutor.py:502` omits client-supplied `expected`, which is injected into the prompt (`tutor.py:475`) and never validated; stored without TTL (`:517`).
5. [V] Client-controlled XP; finished session rewritable: `schemas/events.py:93` (<=100 000); `events.py:370-378` overwrites `ended_at`/`xp_gained` before `if already_completed: return`; league XP summed from sessions (`services/leagues.py:62-66`).
6. [A, trust line V] Certificates scriptable: speaking score trusted (`services/exams.py:198-199`), seed returned (`routers/exams.py:94`), exam JSON public; exam unlock via forged `placement_completed` (`events.py:211-230`).
7. [V] Cancelling vacation freeze is rejected then resurrected: `learner.ts:462` sends `frozenUntil = lastActiveDate` -> `events.py:186-187` rejects -> `sync.ts:145` keeps latest non-null.
8. [V] Studio publish never reaches learners; grading/lint desync. Web version baked at build (`apps/web/src/content.ts:22` `__PACKS__`, `vite.config.ts:9`); manifest endpoint unused; exams (`exams/exam-files.ts:10`), placement, Xe om (`games/xe-om-data.ts:12`) bundled as JS. `services/studio.py:425-428` clears 3 caches in one worker only; stale `tutor.system_prompt`/`_linter` (`tutor.py:122,131`), `conversation_system_prompt` (`conversation.py:90`), `engine._variants` (`engine.py:80`), static mount (`main.py:80-87`). Server rebuilds exam items from new content vs client's old => option ids differ => correct answers graded wrong; `routers/exams.py:127` overwrites shared `Exam.spec_json` on every start.
9. [A] Refresh-token reuse => global logout (multi-tab, dropped response): `services/auth.py:84-86` `revoke_all`, no grace; client de-dup per tab only (`api.ts:180-198`); 5xx/429 on refresh treated as denied (`api.ts:184-187`).
10. [A] Rate limit keyed on proxy IP, in-memory per process: `deps.py:85-86`, uvicorn `--proxy-headers` without `--forwarded-allow-ips`; all users share 20/min per path -> `/auth/refresh` 429 -> logouts; keys never evicted (`rate_limit.py:23`), unbounded via `/auth/oauth/<random>`.
11. [V] GDPR gaps: no server export/delete route; Settings acts on device only; tutor 90-day purge not scheduled (`scheduler.py:44-69`, manual `maintenance purge-tutor`); `processed_events.payload_json`, `refresh_tokens` never purged; no analytics consent; age gate client-only (`pages/Account.tsx:70`).
12. [V] Account switching leaks data: `account.ts:73-80` signOut deletes only the account key; next `signIn` `flush({force:true})` (`account.ts:70`) uploads previous user's pending events into the new account, which also sees previous local progress.
13. [V] Engine-unsupported step types accepted by validator and studio: `core/content-checks.ts:197-222`, `studio/templates.ts:10-19` -> `engine.ts:215` `unsupported` -> "Cet exercice n'est pas encore disponible", ungraded.
14. [A, needs DevTools] Audio likely never cached offline: `sw.ts:69-78` CacheFirst + RangeRequestsPlugin while `new Audio()` sends Range requests (206 not cached).
15. [V] Shipped content cannot deliver the core promise in prod: 0 audio / 0 pitch; tone exercises silent (`audio.ts:49-51`); speak_repeat/tone_produce ungraded (`karaoke/reference.ts:36` DEV-only derivation); certification unpassable (`core/exams.ts:175-176,205`). Add a production gate in `content:validate --production` for tonal steps without native audio/pitch.
16. [V] `services/certificates.py:65-67` looks up existing certificate by user+level, not course: passing `es` A0 returns the vi-south certificate.

### P2
17. [V] Retroactive streak repair via freeze: `core/streak.ts:54-58` / `services/streak.py:42-46`.
18. [A] Displayed streak never decays after missed days (`Hub.tsx:97`, `/me`).
19. [A/V] Streak scope: client per pack (`packs/active.ts:47`), server per user; `sync.ts:146-154`.
20. [A] `local_date` never checked vs `occurred_at` (`events.py:374,390`) -> streak/freeze/challenge farming.
21. [A] Exam 48 h lock only at start; concurrent starts/submits -> extra attempts, duplicate certificates (no unique index).
22. [A] Push: profile reminder hour/timezone ignored (`push.py:177` uses subscription fields); 1/day per subscription not per user; `/push/subscribe` reassigns existing endpoint (`push.py:201-206`); duplicate sends with 2 schedulers.
23. [A] League standings include opted-out users (`leagues.py:84-88`).
24. [A] UTC week boundaries for challenges (`challenges.py:57`, `challenges.ts:113-115`); UTC fallback date `learner.py:196`.
25. [A] Races -> 500: processed_events check-then-insert (`events.py:87-91`); conversation position max+1 (`conversation.py:668,699-708`).
26. [A] No rate limit on `/classes/join/{code}` (6 chars), friend join, `/verify/{code}`.
27. [A] Studio: sync IO in `async def upload_audio` (`routers/studio.py:229-253`); size check after spooling; editor can save `"reviewed": true`; no per-pack role scoping.
28. [A] Performance: classes dashboard 5 queries/student + 30 days of answers in Python (`services/classes.py:212-227`); league rollover per-user queries inside first `/leagues/me` of week (`leagues.py:158-160,194-195`); push & friends N+1. Missing indexes: `sessions(user_id, ended_at)`, `answers(user_id, created_at)`, unique `certificates(user_id, course_id, level)`.
29. [A] SW `skipWaiting()+clientsClaim()` (`sw.ts:56-57`), lazy chunks, no chunk-load recovery or update prompt.
30. [A] Outbox unbounded (guests); no poison quarantine for batch-level failures.
31. [A] No body-size limit; `concept_ids` uncapped; register 409 enumerates emails; tutor quota check-then-call.
32. [V] Push dedupe per device; notification copy hardcoded to Cô Mai (`push.py:26-53`).

### Parity coverage (TS vs Python)
| Area | TS | PY | Parity-tested | Mismatch |
|---|---|---|---|---|
| seeded random / shuffle | engine.ts | engine.py | yes | no |
| text normalize/compare | text.ts | text.py | yes (kind only) | no |
| exam exercises + grading | engine.ts/exams.ts | engine.py/exams.py | yes (A0 x 3 seeds) | empty-section edge (TS fails, PY passes) |
| planner | session.ts | planner.py | yes (360 cases) | no |
| nextLesson | session.ts | planner.py | no | none by reading |
| challenge rotation | challenges.ts | challenges.py | yes | no |
| challenge progress | challenges.ts | challenges.py | no | streak_days optimistic merge undercounts |
| streak | streak.ts | streak.py | no | identical incl. shared bug |
| SRS merge/due | srs.ts | srs.py | no | no |
| badges | badges.ts | badges.py (catalog) | no | server unit_1_done hardcoded vi-south.u01 |
| levels 1-50 | — | — | — | not implemented |

### Checked OK
Ownership on exam submit, certificate PDF, conversations, teacher routes, leave class; roles re-read per request; argon2 + dummy hash; hashed rotating refresh tokens, httpOnly/Secure/SameSite=Lax cookie on /auth; no email in leagues/classes/friends/verify responses; studio path traversal guarded; ffmpeg arg lists; WeasyPrint escaping; events idempotent by PK, batch <=500, +24 h skew; south-lint regenerate-once-then-fallback in tutor and conversation; Dexie v1->v3 migrations additive; `localDay()` uses local getters; engine/text/planner/merge ports identical.

## PART C — Multi-language readiness

### Already generic (keep)
`pack.features` gating (`core/types.ts:117-156`, `content-checks.ts:91-128`), per-pack local data scoping (`db.ts` v3, `packs/active.ts`), TTS voice by `pack.lang` + accent hints (`audio.ts:33-47`), exams/placement discovered by glob, `leagueDivisions` from pack, `/courses` generic, `badgeCodesFor(pack)`, CI lint only for `lexical_variants` packs.

### Hardcoded Vietnamese assumptions (counts over packages/, apps/web/src, apps/api/app, content/schema, scripts)
`.vi` 116 lines/39 files; `"vi"` 91/42; `viText` 22/8; `Cô Mai` 97/38; tone names 112/27; literal `lang="vi"` 24-26 sites; `vi-VN` 5/2; `dir=` 0; `pack.direction` never read.

| Category | Location | Assumption |
|---|---|---|
| Schema | `content/schema/common.schema.json:17,21` (`tone` enum, `viText`), `concept.schema.json` (`vi` required, `ipaSouth`, `northernEquivalent`), `culture`/`pack.welcome`/`game-xe-om` `vi`, `lexical-variants.schema.json` south/north, `pack.schema.json` script enum lacks `thai`, `features.diacritic_keyboard` unused | Vietnamese field names, closed Tone enum |
| Text | `core/text.ts:11-56` tone marks, `toLocaleLowerCase("vi")`, space-split syllables; `engine.ts:225,259` join with " "; `content-checks.ts:57`, `placement.ts:196`, `review.ts:80`; Python `services/text.py`, `engine.py:217` | Latin script with spaces |
| Lint | `packages/south-lint/src/index.ts:46-52`, `apps/api/app/south_lint.py:56-74` tokenize `[\p{L}\p{M}]+`; `scripts/lib/south-lint-pack.ts:15,45` `VI_KEYS` | space-delimited words; key `vi` = content |
| Tones/pitch | `core/pitch/score.ts:186-241` diagnoseTone switch over 6 VN tones; `scripts/audio/process.ts:85`; i18n `base.ts:84-88` | VN tone inventory |
| Speech | `apps/web/src/tutor/speech.ts:54` `rec.lang="vi-VN"`, `:98-104` South voice regex; `ChatView.tsx:14-15` `VI_ONLY` regex | vi-VN |
| Fonts/direction | `app.css:3-8,21-22,33-36,51` Be Vietnam Pro latin+vietnamese subsets, VN line-heights; `ui.tsx:32-35` `<Vi>` sets lang not dir; 24 literal `lang="vi"`; `share-image.ts:16,34`; `pdf.py` fonts; `index.html`, `vite.config.ts:20-22` manifest "vietnamien du Sud" | Latin glyphs, LTR |
| Input | `studio/telex.ts`, `fields.tsx:65-79`, `DocumentEditor.tsx` Telex for every pack | Telex |
| Persona | `services/tutor.py:85-104,128,259-287,313`; `conversation.py:71,78-87,222-226,555` (only language gate); `debrief.py:173`; `push.py:26-53`; web `i18n/messages/tutor.ts`, route `/co-mai` | Cô Mai for every pack — `tutor.py:375` has no language gate: an `es` learner gets the Southern Vietnamese persona |
| Certificates | `pdf.py:37-72` title "Chứng chỉ tiếng Việt miền Nam", mottos; `exam-files.ts:43` "A0 Bén rễ" split; i18n `exams.ts:60,72,102`; `certificates.py:65-67` course bug | VN branding |
| Games | `games/xe-om-data.ts:11-13` vi-south loader table; `GamesPage.tsx:31-38` ungated list incl. karaoke; game names VN words; `validate-content.ts:137` | VN-only data |
| Copy | `i18n/messages/base.ts:5,10,16,60` ("le vietnamien s'écrit en lettres latines", "Pourquoi le vietnamien ?", "À Saïgon"); `LanguageChoice.tsx:17` ANNOUNCED hardcoded | VN copy |
| API/config | `config.py:38 default_course="vi-south"`, `learner.py:44 DEFAULT_PACK`, `badges.py:34 vi-south.u01`, audio scripts default `--pack vi-south`; ~85 test refs | default pack |
| RTL effort | web: `pl-` 40, `pr-` 24, `border-l/r` ~40, `text-left/right` 24, `left-/right-` 11, `ml-` 6, logical utilities 2; ~22 canvas `fillText`/`textAlign`; SVG karaoke/xe-om/river | Physical CSS |

### What Thai would need
1. Schema: `script: "thai"`; `target` field (alias `vi`), `romanization`, `ipa`; per-concept `tones[]` (Thai tone derives from consonant class + syllable type, cannot be computed from marks); `Tone` as pack-declared strings validated against `toneSystem.written`.
2. TextProfile per script: segmentation (`Intl.Segmenter("th")` client; content-provided tokens to avoid TS/Python segmenter divergence), joiner "" for build_sentence, `stripTones` U+0E48–0E4B, explicit `syllableCount`.
3. Pitch: pack-declared tone shapes/labels replacing `diagnoseTone` switch; Thai `heardClasses`.
4. Fonts: Noto Sans/Serif Thai loaded per `pack.script`, line-height ~1.7, no italics; PDF font + shaping.
5. Input: OS keyboard for learners; gate Telex by `pack.inputMethod`.
6. Speech: `pack.bcp47` (`th-TH`) used by speech.ts and TTS.
7. Tutor persona per pack (`content/th/tutor.json`), lint optional.
8. New pedagogy: script/reading track (consonant classes) — new step type(s).

### What Arabic would need
1. Same schema rename; optional `vocalized` + `romanization`; choose variety via `variant`.
2. Normalization policy (alef forms, ى/ي, ة/ه, tatweel, optional harakat); space segmentation OK but clitics affect token design.
3. Direction: `<Vi>` and every target-text site get `dir` from pack + `unicode-bidi: isolate`; build_sentence row RTL; chat input `dir="auto"`; canvas `ctx.direction`; SVG anchors. Full logical-CSS migration only needed for an RTL interface locale.
4. Fonts: Noto Naskh/Sans Arabic, line-height ~1.8; PDF shaping (WeasyPrint OK; fpdf2 needs harfbuzz).
5. `features: []` (no tones) — already exercised by `es`, but Games/karaoke must be gated.
6. Script track (letters, positional forms).

### Incremental plan (non-breaking)
Step 0 — fix leaks (days): gate tutor greeting/why/debrief and push copy on a pack persona; `certificates.py` lookup by course; `badges.py` first unit of pack; gate `GamesPage`/`HubTutor`/Telex by features; glob loader for xe_om; data-driven `comingSoon` list (pack stubs with `comingSoon: true` already supported by `/courses`) + server-side interest signal.
Step 1 — pack.json v2 additive fields (optional, defaults = current vi behaviour): `bcp47`, `inputMethod`, `tutor` (or `tutor.json`), `certificate` {title, subtitle, mottos}, `games` allow-list, `toneSystem.labels/shapes`, `fonts` {ui, target, lineHeight}; add `thai` to script enum.
Step 2 — content schema v2 with alias: accept `target` OR `vi` (JSON Schema `oneOf`/`anyOf`), `ipa` OR `ipaSouth`, `variantEquivalent` OR `northernEquivalent`; loaders (`scripts/lib/load-pack.ts` `toRaw`, `apps/api/app/services/content.py`) normalise to `target`; core types expose `target` with deprecated `vi` getter during migration; codemod `.vi` -> `.target` (≈116 sites); a one-shot script rewrites content files; studio writes `target`. Remove alias after one release.
Step 3 — TextProfile in core + Python mirror, selected by `pack.script`; parity fixtures extended with a Thai and an Arabic mini-pack under `packages/core/src/testing/` (tests stop defaulting to vi-south).
Step 4 — TargetText component: lang+dir+font from pack; replace 24 literal `lang="vi"`; per-script CSS chunks; canvas/SVG direction.
Step 5 — generalize south-lint to `variant-lint` (preferred/avoid, pack-provided tokens), keep `lexical-variants.json` compatible.
Step 6 — delivery: client polls `/courses/{code}/manifest` (or a `content-version.json`) and refetches bundle.json when version > stored; move exams/placement/games data into the bundle; clear all server content caches (or version-key them) on publish, across workers.
Content onboarding checklist per new pack: pack.json (script, direction, bcp47, voices, features, toneSystem, leagueDivisions, welcome, tutor, certificate, games, fonts); curriculum with `<code>.uNN` ids, concept ids prefixed; only engine-supported step types; native audio + pitch refs for tonal packs (production gate); optional placement/exams/games/variants; i18n `language.name.<code>`; persona prompt + fallbacks + push copy reviewed; fonts verified with a per-script test string; `content:validate --production` + lint; native reviewer sign-off (`reviewed: true`).