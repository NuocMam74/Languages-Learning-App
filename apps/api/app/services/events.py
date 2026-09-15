"""Application d'un lot d'événements hors ligne (ADR 0004).

- Idempotent sur l'id d'événement : un id déjà traité est rapporté « accepté » sans être réappliqué.
- Événement daté de plus de 24 h dans le futur : rejeté (horloge aberrante).
- Lot traité par `occurredAt` croissant, dans une seule transaction.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Answer,
    Enrollment,
    GamePlay,
    LessonProgress,
    ProcessedEvent,
    Profile,
    PronunciationScore,
    SrsCardRow,
    StudySession,
    UserBadge,
)
from app.schemas.events import (
    AnswerSubmitted,
    BadgeEarned,
    ConversationTurnEvent,
    EventBatchResult,
    GamePlayed,
    LessonCompleted,
    PackSwitched,
    ParloEvent,
    PlacementCompleted,
    PronunciationScored,
    RejectedEvent,
    SessionCompleted,
    SessionStarted,
    SrsCardIn,
    SrsCardUpdated,
    StreakFrozen,
    event_adapter,
)
from app.services import learner
from app.services.badges import ensure_badge
from app.services.content import Pack, course_code_of_concept, course_code_of_lesson
from app.services.planner import next_lesson
from app.services.srs import SrsCard, merge_cards
from app.services.streak import Streak, record_activity

MAX_CLOCK_SKEW = timedelta(hours=24)
# « Je pars quelques jours » : gel de série limité à 14 jours après le jour local de la demande.
MAX_FREEZE_DAYS = 14


class EventRejectedError(Exception):
    """Refus métier d'un événement (rapporté dans `rejected`, sans annuler le lot)."""


def _format_validation_error(exc: ValidationError) -> str:
    first = exc.errors()[0]
    loc = ".".join(str(p) for p in first["loc"])
    return f"invalid: {loc}: {first['msg']}" if loc else f"invalid: {first['msg']}"


def process_batch(
    db: Session,
    user_id: str,
    raw_events: list[dict[str, Any]],
    packs: dict[str, Pack],
    now: datetime | None = None,
) -> EventBatchResult:
    now = now or datetime.now(UTC)
    accepted: list[str] = []
    rejected: list[RejectedEvent] = []

    valid: list[tuple[ParloEvent, dict[str, Any]]] = []
    for raw in raw_events:
        try:
            valid.append((event_adapter.validate_python(raw), raw))
        except ValidationError as exc:
            rejected.append(RejectedEvent(id=str(raw.get("id", "")), reason=_format_validation_error(exc)))

    ids = [str(ev.id) for ev, _ in valid]
    existing = {
        row.id: row.user_id
        for row in db.execute(select(ProcessedEvent.id, ProcessedEvent.user_id).where(ProcessedEvent.id.in_(ids)))
    }

    for event, raw in sorted(valid, key=lambda item: (item[0].occurred_at, str(item[0].id))):
        event_id = str(event.id)
        if event_id in existing:
            if existing[event_id] == user_id:
                accepted.append(event_id)
            else:
                rejected.append(RejectedEvent(id=event_id, reason="id_conflict"))
            continue
        if event.occurred_at > now + MAX_CLOCK_SKEW:
            rejected.append(RejectedEvent(id=event_id, reason="occurred_at_in_future"))
            continue
        try:
            _apply(db, user_id, event, packs, now)
        except EventRejectedError as exc:
            rejected.append(RejectedEvent(id=event_id, reason=str(exc)))
            continue
        db.add(
            ProcessedEvent(
                id=event_id,
                user_id=user_id,
                type=event.type,
                occurred_at=event.occurred_at,
                received_at=now,
                payload_json=raw,
            )
        )
        existing[event_id] = user_id  # doublon à l'intérieur du même lot
        accepted.append(event_id)
        db.flush()

    db.commit()
    return EventBatchResult(accepted=accepted, rejected=rejected)


def _apply(db: Session, user_id: str, event: ParloEvent, packs: dict[str, Pack], now: datetime) -> None:
    match event:
        case AnswerSubmitted():
            _apply_answer(db, user_id, event)
        case SrsCardUpdated():
            _apply_srs(db, user_id, event.payload.card)
        case LessonCompleted():
            _apply_lesson_completed(db, user_id, event, packs)
        case SessionStarted():
            _apply_session_started(db, user_id, event)
        case SessionCompleted():
            _apply_session_completed(db, user_id, event, packs)
        case PlacementCompleted():
            _apply_placement_completed(db, user_id, event, packs)
        case BadgeEarned():
            _apply_badge_earned(db, user_id, event)
        case PronunciationScored():
            _apply_pronunciation_scored(db, user_id, event)
        case StreakFrozen():
            _apply_streak_frozen(db, user_id, event)
        case GamePlayed():
            _apply_game_played(db, user_id, event)
        case ConversationTurnEvent():
            pass  # journalisé dans processed_events : statistiques et défi « parole » (1 tour = 20 s)
        case PackSwitched():
            _apply_pack_switched(db, user_id, event, packs)


def _apply_pack_switched(db: Session, user_id: str, event: PackSwitched, packs: dict[str, Pack]) -> None:
    # Le pack courant est lu depuis le dernier `pack_switched` journalisé (learner.primary_enrollment).
    _enrollment_for(db, user_id, _pack_for(packs, event.payload.to_pack))


def _session_pack(db: Session, user_id: str, session_id: str, packs: dict[str, Pack]) -> Pack | None:
    """Pack d'une séance d'après ses réponses (id de leçon, sinon préfixe des concepts)."""
    rows = db.execute(
        select(Answer.lesson_id, Answer.concept_id).where(Answer.user_id == user_id, Answer.session_id == session_id)
    ).all()
    for lesson_id, _ in rows:
        if lesson_id and course_code_of_lesson(lesson_id) in packs:
            return packs[course_code_of_lesson(lesson_id)]
    for _, concept_id in rows:
        if concept_id:
            code = course_code_of_concept(concept_id, packs.keys(), learner.DEFAULT_PACK)
            if code in packs:
                return packs[code]
    return None


def _apply_pronunciation_scored(db: Session, user_id: str, event: PronunciationScored) -> None:
    p = event.payload
    db.add(
        PronunciationScore(
            id=str(event.id), user_id=user_id, concept_id=p.concept_id, score=p.score, created_at=event.occurred_at
        )
    )


def _apply_streak_frozen(db: Session, user_id: str, event: StreakFrozen) -> None:
    p = event.payload
    if p.frozen_until < p.local_date:
        raise EventRejectedError("invalid: payload.frozenUntil: before localDate")
    if p.frozen_until > p.local_date + timedelta(days=MAX_FREEZE_DAYS):
        raise EventRejectedError(f"invalid: payload.frozenUntil: more than {MAX_FREEZE_DAYS} days after localDate")
    learner.get_streak(db, user_id).frozen_until = p.frozen_until


def _apply_game_played(db: Session, user_id: str, event: GamePlayed) -> None:
    p = event.payload
    if p.correct > p.total:
        raise EventRejectedError("invalid: payload.correct: greater than total")
    db.add(
        GamePlay(
            id=str(event.id),
            user_id=user_id,
            game=p.game,
            correct=p.correct,
            total=p.total,
            duration_ms=round(p.duration_ms),
            local_date=p.local_date,
            played_at=event.occurred_at,
        )
    )


def _apply_placement_completed(db: Session, user_id: str, event: PlacementCompleted, packs: dict[str, Pack]) -> None:
    p = event.payload
    pack = _pack_for(packs, course_code_of_lesson(p.entry_lesson_id))
    if p.entry_lesson_id not in pack.lessons:
        raise EventRejectedError("unknown_lesson")
    if p.correct > p.total:
        raise EventRejectedError("invalid: payload.correct: greater than total")

    profile = db.get(Profile, user_id)
    if profile is None:
        profile = Profile(user_id=user_id, daily_goal_min=10, leagues_enabled=True)
        db.add(profile)
    profile.level_estimate = str(p.level_estimate)
    profile.placement_entry_lesson_id = p.entry_lesson_id
    db.flush()

    # Comme le client : les leçons situées avant le point d'entrée sont ouvertes (prérequis remplis).
    enrollment = _enrollment_for(db, user_id, pack)
    lesson = next_lesson(pack, pack.lessons, learner.unlocked_lessons(db, user_id, pack), learner.path_of(profile))
    enrollment.current_lesson_id = lesson.id if lesson else None


def _apply_badge_earned(db: Session, user_id: str, event: BadgeEarned) -> None:
    badge = ensure_badge(db, event.payload.badge_code)
    if badge is None:
        raise EventRejectedError("unknown_badge")
    row = db.get(UserBadge, (user_id, badge.id))
    if row is None:
        db.add(UserBadge(user_id=user_id, badge_id=badge.id, earned_at=event.occurred_at))
    elif event.occurred_at < row.earned_at:
        row.earned_at = event.occurred_at  # même badge renvoyé : on garde la première obtention


def _apply_answer(db: Session, user_id: str, event: AnswerSubmitted) -> None:
    p = event.payload
    db.add(
        Answer(
            id=str(event.id),
            user_id=user_id,
            session_id=p.session_id,
            lesson_id=p.lesson_id,
            step_index=p.step_index,
            exercise_type=p.exercise_type,
            concept_id=p.concept_ids[0] if p.concept_ids else None,
            concept_ids=list(p.concept_ids),
            correct=p.correct,
            near_miss=p.near_miss,
            response_ms=round(p.response_ms),
            attempt=p.attempt,
            created_at=event.occurred_at,
        )
    )


def _apply_srs(db: Session, user_id: str, card_in: SrsCardIn) -> None:
    incoming = SrsCard(
        concept_id=card_in.concept_id,
        due=card_in.due.astimezone(UTC),
        stability=card_in.stability,
        difficulty=card_in.difficulty,
        scheduled_days=card_in.scheduled_days,
        learning_steps=card_in.learning_steps,
        reps=card_in.reps,
        lapses=card_in.lapses,
        state=card_in.state,
        last_review=card_in.last_review.astimezone(UTC) if card_in.last_review else None,
    )
    row = db.get(SrsCardRow, (user_id, card_in.concept_id))
    if row is None:
        row = SrsCardRow(user_id=user_id, concept_id=card_in.concept_id)
        db.add(row)
    elif merge_cards(learner.to_card(row), incoming) is not incoming:
        return  # l'état stocké est plus avancé : jamais de régression
    row.due_at = incoming.due
    row.stability = incoming.stability
    row.difficulty = incoming.difficulty
    row.scheduled_days = incoming.scheduled_days
    row.learning_steps = incoming.learning_steps
    row.reps = incoming.reps
    row.lapses = incoming.lapses
    row.state = incoming.state
    row.last_review = incoming.last_review


def _pack_for(packs: dict[str, Pack], code: str) -> Pack:
    pack = packs.get(code)
    if pack is None:
        raise EventRejectedError("unknown_course")
    return pack


def _enrollment_for(db: Session, user_id: str, pack: Pack) -> Enrollment:
    enrollment = db.get(Enrollment, (user_id, pack.code))
    if enrollment is None:
        enrollment = learner.enroll(db, user_id, pack, path=None)
        db.flush()
    return enrollment


def _apply_lesson_completed(db: Session, user_id: str, event: LessonCompleted, packs: dict[str, Pack]) -> None:
    p = event.payload
    pack = _pack_for(packs, course_code_of_lesson(p.lesson_id))
    if p.lesson_id not in pack.lessons:
        raise EventRejectedError("unknown_lesson")

    progress = db.get(LessonProgress, (user_id, p.lesson_id))
    if progress is None:
        progress = LessonProgress(user_id=user_id, lesson_id=p.lesson_id, attempts=0)
        db.add(progress)
    progress.status = "completed"
    progress.attempts = (progress.attempts or 0) + 1
    progress.score = p.score if progress.score is None else max(progress.score, p.score)
    progress.completed_at = (
        event.occurred_at if progress.completed_at is None else min(progress.completed_at, event.occurred_at)
    )
    db.flush()

    profile = db.get(Profile, user_id)
    path = learner.path_of(profile) if profile else None
    enrollment = _enrollment_for(db, user_id, pack)
    lesson = next_lesson(pack, pack.lessons, learner.unlocked_lessons(db, user_id, pack), path)
    enrollment.current_lesson_id = lesson.id if lesson else None


def _session_row(db: Session, user_id: str, session_id: str) -> StudySession:
    row = db.get(StudySession, session_id)
    if row is None:
        row = StudySession(id=session_id, user_id=user_id, xp_gained=0, items_count=0)
        db.add(row)
    elif row.user_id != user_id:
        raise EventRejectedError("session_conflict")
    return row


def _apply_session_started(db: Session, user_id: str, event: SessionStarted) -> None:
    p = event.payload
    row = _session_row(db, user_id, p.session_id)
    row.started_at = event.occurred_at
    row.source = p.source
    row.planned_seconds = round(p.planned_seconds)


def _apply_session_completed(db: Session, user_id: str, event: SessionCompleted, packs: dict[str, Pack]) -> None:
    p = event.payload
    # Vérifications avant toute écriture : un refus ne doit rien laisser derrière lui.
    existing = db.get(StudySession, p.session_id)
    if existing is not None and existing.user_id != user_id:
        raise EventRejectedError("session_conflict")
    # XP portée par l'inscription du pack de la séance (réponses), sinon par l'inscription courante.
    session_pack = _session_pack(db, user_id, p.session_id, packs)
    enrollment = _enrollment_for(db, user_id, session_pack) if session_pack else learner.primary_enrollment(db, user_id)
    default = packs.get(learner.DEFAULT_PACK) or next(iter(packs.values()), None)
    if enrollment is None and default is None:
        raise EventRejectedError("no_enrollment")

    if enrollment is None and default is not None:
        enrollment = _enrollment_for(db, user_id, default)
    row = _session_row(db, user_id, p.session_id)
    already_completed = row.ended_at is not None
    row.ended_at = event.occurred_at
    row.xp_gained = p.xp_gained
    row.items_count = p.items_count
    row.duration_ms = round(p.duration_ms)
    row.local_date = p.local_date
    if row.started_at is None:
        row.started_at = event.occurred_at - timedelta(milliseconds=p.duration_ms)
    if already_completed:
        return  # même séance renvoyée sous un autre id d'événement : pas de double XP

    enrollment.xp_total += p.xp_gained

    streak_row = learner.get_streak(db, user_id)
    updated = record_activity(
        Streak(
            current=streak_row.current,
            longest=streak_row.longest,
            last_active_date=streak_row.last_active_date,
            freezes_available=streak_row.freezes_available,
            frozen_until=streak_row.frozen_until,
        ),
        p.local_date,
    )
    streak_row.current = updated.current
    streak_row.longest = updated.longest
    streak_row.last_active_date = updated.last_active_date
    streak_row.freezes_available = updated.freezes_available
    streak_row.frozen_until = updated.frozen_until
