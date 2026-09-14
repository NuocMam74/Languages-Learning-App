"""État d'apprentissage d'un utilisateur : inscription, leçons terminées, cartes SRS, série."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Enrollment, LessonProgress, Profile, SrsCardRow, StreakRow, User
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
