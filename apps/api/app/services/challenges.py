"""Défi de la semaine (spec §5.2, contrat Phase 2 §3) — mêmes règles que packages/core/src/challenges.ts.

- Un défi par semaine UTC (lundi 00:00 → lundi suivant). Type et objectif : rotation de `localChallengeSpec`
  (semaine = ⌊lundi en ms / 7 j⌋ mod 5), pour que l'invité et le compte voient le même défi. Identifiant
  déterministe (création concurrente sans doublon). Créé par la tâche planifiée du lundi, ou à la première
  lecture si le planificateur est désactivé.
- Progression recalculée depuis les événements reçus dont `occurredAt` est dans la période (`challengeProgress`) :
  words_theme : mots (concepts `word` de `review.srsIntroduce`) des leçons de l'unité terminées dans la période ;
  streak_days : plus longue suite de `localDate` de `session_completed` ;
  speaking_minutes : ⌊`pronunciation_scored` × 10 s / 60⌋ ;
  lessons : `lesson_completed` ; game_score : `game_played` avec correct/total ≥ 0,7.
- words_theme : unité = première unité publiée non terminée, figée pour l'utilisateur à la première lecture.
- Réclamation : +50 XP et badge `challenge_<kind>`.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Challenge, ChallengeProgress, GamePlay, ProcessedEvent, PronunciationScore, UserBadge
from app.services import learner
from app.services.badges import ensure_badge
from app.services.content import Pack, concept_documents, course_code_of_lesson, lesson_document
from app.services.engine import GAME_PASS_RATIO

CLAIM_XP = 50
SPEAKING_SECONDS_PER_ITEM = 10
_NAMESPACE = uuid.UUID("0c6d1b0e-7f55-4b8a-9d3e-7061726c6f02")
_WEEK = timedelta(days=7)


@dataclass(frozen=True)
class ChallengeDef:
    kind: str
    target: int
    title: dict[str, str]


# Même ordre et mêmes objectifs que LOCAL_ROTATION (challenges.ts).
ROTATION: tuple[ChallengeDef, ...] = (
    ChallengeDef("lessons", 5, {"fr": "Terminer 5 leçons", "en": "Complete 5 lessons"}),
    ChallengeDef("streak_days", 5, {"fr": "5 jours de suite", "en": "5 days in a row"}),
    ChallengeDef("words_theme", 10, {"fr": "10 mots nouveaux de ton unité", "en": "10 new words from your unit"}),
    ChallengeDef("game_score", 3, {"fr": "Réussir 3 parties", "en": "Win 3 games"}),
    ChallengeDef("speaking_minutes", 5, {"fr": "5 minutes de parole", "en": "5 minutes of speaking"}),
)


def week_start(now: datetime) -> datetime:
    day = now.astimezone(UTC).date()
    return datetime.combine(day - timedelta(days=day.weekday()), time(0), tzinfo=UTC)


def definition_for_week(period_start: datetime) -> ChallengeDef:
    weeks = int(period_start.timestamp() * 1000) // (7 * 86_400_000)
    return ROTATION[weeks % len(ROTATION)]


def challenge_id(period_start: datetime) -> str:
    return str(uuid.uuid5(_NAMESPACE, period_start.date().isoformat()))


def ensure_week_challenge(db: Session, now: datetime) -> Challenge:
    start = week_start(now)
    cid = challenge_id(start)
    row = db.get(Challenge, cid)
    if row is not None:
        return row
    definition = definition_for_week(start)
    row = Challenge(
        id=cid,
        kind=definition.kind,
        period_start=start,
        period_end=start + _WEEK,
        spec_json={"target": definition.target, "title": definition.title, "badgeCode": f"challenge_{definition.kind}"},
    )
    try:
        with db.begin_nested():
            db.add(row)
    except IntegrityError:  # créé en parallèle (tâche planifiée ou autre requête)
        existing = db.get(Challenge, cid)
        if existing is None:
            raise
        return existing
    return row


# --- Progression ----------------------------------------------------------------------------


def current_unit(db: Session, user_id: str, packs: dict[str, Pack]) -> str | None:
    """Première unité publiée dont une leçon n'est pas terminée (comme `localChallengeSpec`)."""
    enrollment = learner.primary_enrollment(db, user_id)
    pack = packs.get(enrollment.course_id) if enrollment else None
    if pack is None:
        return None
    completed = learner.completed_lessons(db, user_id)
    unit = next((u for u in pack.units if u.status == "available" and any(i not in completed for i in u.lessons)), None)
    return unit.id if unit else None


def unit_words(pack: Pack, unit_id: str) -> dict[str, list[str]]:
    """Mots (concepts `word`) introduits par chaque leçon de l'unité."""
    concepts = concept_documents(pack)
    unit = next((u for u in pack.units if u.id == unit_id), None)
    return {
        lesson_id: [
            c
            for c in ((lesson_document(pack, lesson_id) or {}).get("review") or {}).get("srsIntroduce", [])
            if concepts.get(c, {}).get("type") == "word"
        ]
        for lesson_id in (unit.lessons if unit else ())
    }


def _payloads(db: Session, user_id: str, type_: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(ProcessedEvent.payload_json).where(
            ProcessedEvent.user_id == user_id,
            ProcessedEvent.type == type_,
            ProcessedEvent.occurred_at >= start,
            ProcessedEvent.occurred_at < end,
        )
    )
    return [raw.get("payload", {}) for raw in rows]


def longest_run(days: set[date]) -> int:
    best = 0
    for day in days:
        if day - timedelta(days=1) in days:
            continue
        length = 1
        while day + timedelta(days=length) in days:
            length += 1
        best = max(best, length)
    return best


def compute_progress(db: Session, user_id: str, challenge: Challenge, pack: Pack | None, unit_id: str | None) -> int:
    start, end = challenge.period_start, challenge.period_end
    match challenge.kind:
        case "words_theme":
            if pack is None or unit_id is None:
                return 0
            words = unit_words(pack, unit_id)
            learned = {
                c
                for p in _payloads(db, user_id, "lesson_completed", start, end)
                for c in words.get(p.get("lessonId"), [])
            }
            return len(learned)
        case "streak_days":
            days = set()
            for p in _payloads(db, user_id, "session_completed", start, end):
                try:
                    days.add(date.fromisoformat(p["localDate"]))
                except (KeyError, TypeError, ValueError):
                    continue
            return longest_run(days)
        case "speaking_minutes":
            items = db.scalar(
                select(func.count()).where(
                    PronunciationScore.user_id == user_id,
                    PronunciationScore.created_at >= start,
                    PronunciationScore.created_at < end,
                )
            )
            return int(items or 0) * SPEAKING_SECONDS_PER_ITEM // 60
        case "lessons":
            return len(_payloads(db, user_id, "lesson_completed", start, end))
        case "game_score":
            plays = db.scalars(
                select(GamePlay).where(
                    GamePlay.user_id == user_id, GamePlay.played_at >= start, GamePlay.played_at < end
                )
            )
            return sum(1 for p in plays if p.total > 0 and p.correct / p.total >= GAME_PASS_RATIO)
    return 0


def refresh_progress(
    db: Session, user_id: str, challenge: Challenge, packs: dict[str, Pack], now: datetime
) -> ChallengeProgress:
    row = db.get(ChallengeProgress, (user_id, challenge.id))
    if row is None:
        row = ChallengeProgress(user_id=user_id, challenge_id=challenge.id, progress=0)
        db.add(row)
    if challenge.kind == "words_theme" and row.unit_id is None:
        row.unit_id = current_unit(db, user_id, packs)
    pack = packs.get(course_code_of_lesson(row.unit_id)) if row.unit_id else None
    target = int(challenge.spec_json.get("target", 0))
    # Progression plafonnée à l'objectif (comme optimisticProgress) ; un défi terminé le reste.
    row.progress = min(target, compute_progress(db, user_id, challenge, pack, row.unit_id))
    if row.completed_at is None and target > 0 and row.progress >= target:
        row.completed_at = now
    return row


class ClaimError(Exception):
    pass


def claim(db: Session, user_id: str, challenge: Challenge, packs: dict[str, Pack], now: datetime) -> ChallengeProgress:
    row = refresh_progress(db, user_id, challenge, packs, now)
    if row.completed_at is None:
        raise ClaimError("not_completed")
    if row.claimed_at is not None:
        raise ClaimError("already_claimed")
    row.claimed_at = now
    enrollment = learner.primary_enrollment(db, user_id)
    if enrollment is not None:
        enrollment.xp_total += CLAIM_XP
    badge = ensure_badge(db, f"challenge_{challenge.kind}", server_awarded=True)
    if badge is not None and db.get(UserBadge, (user_id, badge.id)) is None:
        db.add(UserBadge(user_id=user_id, badge_id=badge.id, earned_at=now))
    return row
