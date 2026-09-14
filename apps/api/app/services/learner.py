"""État d'apprentissage d'un utilisateur : inscription, leçons terminées, cartes SRS, série."""

from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Badge,
    Enrollment,
    LessonProgress,
    Profile,
    SrsCardRow,
    StreakRow,
    StudySession,
    User,
    UserBadge,
)
from app.services.content import Pack
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


def primary_enrollment(db: Session, user_id: str) -> Enrollment | None:
    """Inscription courante : la plus récente (une seule en Phase 0)."""
    return db.scalar(
        select(Enrollment).where(Enrollment.user_id == user_id).order_by(Enrollment.started_at.desc()).limit(1)
    )


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


def user_cards(db: Session, user_id: str) -> list[SrsCard]:
    rows = db.scalars(select(SrsCardRow).where(SrsCardRow.user_id == user_id).order_by(SrsCardRow.concept_id))
    return [to_card(r) for r in rows]


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
