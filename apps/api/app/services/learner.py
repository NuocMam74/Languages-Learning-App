"""État d'apprentissage d'un utilisateur : inscription, leçons terminées, cartes SRS, série."""

from collections.abc import Iterable
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Badge,
    Enrollment,
    LessonProgress,
    ProcessedEvent,
    Profile,
    SrsCardRow,
    StreakRow,
    StudySession,
    User,
    UserBadge,
)
from app.services.content import Pack, course_code_of_concept
from app.services.planner import next_lesson
from app.services.srs import SrsCard

LEAGUE_OPT_OUT_MOTIVATIONS = frozenset({"family", "roots"})


def create_learner(db: Session, user: User, pack: Pack | None) -> None:
    """Profil, série et inscription au pack par défaut pour un nouvel utilisateur."""
    db.add(Profile(user_id=user.id, daily_goal_min=10, leagues_enabled=True))
    db.add(StreakRow(user_id=user.id))
    if pack is not None:
        enroll(db, user.id, pack, path=None)


def enroll(db: Session, user_id: str, pack: Pack, path: str | None) -> Enrollment:
    enrollment = Enrollment(user_id=user_id, course_id=pack.code, xp_total=0, level=1)
    lesson = next_lesson(pack, pack.lessons, set(), path)
    enrollment.current_lesson_id = lesson.id if lesson else None
    db.add(enrollment)
    return enrollment


DEFAULT_PACK = "vi-south"


def current_pack_code(db: Session, user_id: str) -> str | None:
    """Pack choisi par le dernier `pack_switched` (par `occurredAt`), ou None."""
    payload = db.scalar(
        select(ProcessedEvent.payload_json)
        .where(ProcessedEvent.user_id == user_id, ProcessedEvent.type == "pack_switched")
        .order_by(ProcessedEvent.occurred_at.desc(), ProcessedEvent.id.desc())
        .limit(1)
    )
    code = (payload or {}).get("payload", {}).get("toPack")
    return code if isinstance(code, str) else None


def enrollments(db: Session, user_id: str) -> list[Enrollment]:
    return list(
        db.scalars(
            select(Enrollment)
            .where(Enrollment.user_id == user_id)
            .order_by(Enrollment.started_at, Enrollment.course_id)
        )
    )


def primary_enrollment(db: Session, user_id: str) -> Enrollment | None:
    """Inscription courante (plusieurs packs, contrat Phase 3 §5).

    Pack du dernier `pack_switched` s'il est suivi, sinon `vi-south`, sinon l'inscription la plus récente.
    """
    rows = {e.course_id: e for e in enrollments(db, user_id)}
    if not rows:
        return None
    for code in (current_pack_code(db, user_id), DEFAULT_PACK):
        if code is not None and code in rows:
            return rows[code]
    return max(rows.values(), key=lambda e: e.started_at)


def path_of(profile: Profile) -> str | None:
    """Parcours effectif : choix explicite, sinon la motivation déclarée (mêmes clés que curriculum.paths)."""
    return profile.path_variant or profile.motivation


def completed_lessons(db: Session, user_id: str) -> set[str]:
    return set(
        db.scalars(
            select(LessonProgress.lesson_id).where(
                LessonProgress.user_id == user_id, LessonProgress.status == "completed"
            )
        )
    )


def lessons_before(pack: Pack, lesson_id: str) -> list[str]:
    """Leçons situées avant `lesson_id` dans l'ordre du cursus — portage de `lessonsBefore` (placement.ts)."""
    ordered = [lid for unit in pack.units for lid in unit.lessons]
    try:
        idx = ordered.index(lesson_id)
    except ValueError:
        return []
    return ordered[:idx]


def unlocked_lessons(db: Session, user_id: str, pack: Pack) -> set[str]:
    """Leçons terminées + sautées grâce au test de placement : sert aux prérequis (comme `planning` du client)."""
    unlocked = completed_lessons(db, user_id)
    profile = db.get(Profile, user_id)
    if profile is not None and profile.placement_entry_lesson_id:
        unlocked.update(lessons_before(pack, profile.placement_entry_lesson_id))
    return unlocked


def to_card(row: SrsCardRow) -> SrsCard:
    return SrsCard(
        concept_id=row.concept_id,
        due=row.due_at,
        stability=row.stability,
        difficulty=row.difficulty,
        scheduled_days=row.scheduled_days,
        learning_steps=row.learning_steps,
        reps=row.reps,
        lapses=row.lapses,
        state=row.state,  # type: ignore[arg-type]
        last_review=row.last_review,
    )


def user_cards(db: Session, user_id: str, pack_code: str | None = None, codes: Iterable[str] = ()) -> list[SrsCard]:
    """Cartes SRS de l'utilisateur ; avec `pack_code`, seulement celles des concepts de ce pack."""
    rows = db.scalars(select(SrsCardRow).where(SrsCardRow.user_id == user_id).order_by(SrsCardRow.concept_id))
    codes = list(codes)
    return [
        to_card(r)
        for r in rows
        if pack_code is None or course_code_of_concept(r.concept_id, codes, DEFAULT_PACK) == pack_code
    ]


def due_cards(db: Session, user_id: str, now: datetime, limit: int) -> list[SrsCardRow]:
    return list(
        db.scalars(
            select(SrsCardRow)
            .where(SrsCardRow.user_id == user_id, SrsCardRow.state != "new", SrsCardRow.due_at <= now)
            .order_by(SrsCardRow.due_at, SrsCardRow.concept_id)
            .limit(limit)
        )
    )


def get_streak(db: Session, user_id: str) -> StreakRow:
    row = db.get(StreakRow, user_id)
    if row is None:
        row = StreakRow(user_id=user_id, current=0, longest=0, freezes_available=0)
        db.add(row)
    return row


def level_estimate(profile: Profile) -> int | None:
    try:
        return int(profile.level_estimate) if profile.level_estimate is not None else None
    except ValueError:
        return None


def user_badges(db: Session, user_id: str) -> list[tuple[str, datetime]]:
    rows = db.execute(
        select(Badge.code, UserBadge.earned_at)
        .join(Badge, Badge.id == UserBadge.badge_id)
        .where(UserBadge.user_id == user_id)
        .order_by(UserBadge.earned_at, Badge.code)
    )
    return [(code, earned_at) for code, earned_at in rows]


# Au-delà, le dernier jour local connu n'est plus « aujourd'hui » (fuseaux de -12 h à +14 h).
_LOCAL_DATE_FRESHNESS = timedelta(hours=14)


def current_local_date(db: Session, user_id: str, now: datetime, requested: date | None = None) -> date:
    """Jour local de l'utilisateur : fourni par le client, sinon déduit de la dernière séance terminée."""
    if requested is not None:
        return requested
    latest = db.execute(
        select(StudySession.local_date, StudySession.ended_at)
        .where(StudySession.user_id == user_id, StudySession.local_date.is_not(None))
        .order_by(StudySession.ended_at.desc())
        .limit(1)
    ).first()
    if latest is not None and latest.ended_at is not None and now - latest.ended_at < _LOCAL_DATE_FRESHNESS:
        local: date = latest.local_date
        return local
    return now.date()


def minutes_done_on(db: Session, user_id: str, local_date: date) -> float:
    total_ms = db.scalar(
        select(func.coalesce(func.sum(StudySession.duration_ms), 0)).where(
            StudySession.user_id == user_id, StudySession.local_date == local_date
        )
    )
    return round(int(total_ms or 0) / 60_000, 1)
