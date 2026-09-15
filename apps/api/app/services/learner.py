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
from app.services import progression
from app.services.content import Pack, course_code_of_concept
from app.services.levels import LevelInfo, level_info
from app.services.srs import SrsCard
from app.services.streak import Streak, displayed_current

LEAGUE_OPT_OUT_MOTIVATIONS = frozenset({"family", "roots"})


def create_learner(db: Session, user: User, pack: Pack | None) -> None:
    """Profil, série et inscription au pack par défaut pour un nouvel utilisateur."""
    db.add(Profile(user_id=user.id, daily_goal_min=10, leagues_enabled=True))
    db.add(StreakRow(user_id=user.id))
    if pack is not None:
        enroll(db, user.id, pack, path=None)


def enroll(db: Session, user_id: str, pack: Pack, path: str | None) -> Enrollment:
    enrollment = Enrollment(user_id=user_id, course_id=pack.code, xp_total=0, level=1)
    lesson = progression.next_lesson(pack, pack.lessons, progression.ProgressState(), path)
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


def progress_state(db: Session, user_id: str, pack: Pack) -> progression.ProgressState:
    """Ensembles `completed`/`passed` du pack : meilleurs scores + leçons sautées au placement (comme le client)."""
    rows = db.execute(
        select(LessonProgress.lesson_id, LessonProgress.score).where(
            LessonProgress.user_id == user_id,
            LessonProgress.status == "completed",
            LessonProgress.lesson_id.like(f"{pack.code}.%"),
        )
    ).all()
    profile = db.get(Profile, user_id)
    entry = profile.placement_entry_lesson_id if profile is not None else None
    return progression.progress_from(pack, {r.lesson_id: float(r.score or 0.0) for r in rows}, entry)


def unlocked_lessons(db: Session, user_id: str, pack: Pack) -> set[str]:
    """Leçons terminées + leçons sautées grâce au test de placement."""
    return set(progress_state(db, user_id, pack).completed)


def next_lesson_for(db: Session, user_id: str, pack: Pack, profile: Profile | None) -> str | None:
    lesson = progression.next_lesson(
        pack, pack.lessons, progress_state(db, user_id, pack), path_of(profile) if profile else None
    )
    return lesson.id if lesson else None


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


def streak_of(row: StreakRow) -> Streak:
    return Streak(
        current=row.current or 0,
        longest=row.longest or 0,
        last_active_date=row.last_active_date,
        freezes_available=row.freezes_available or 0,
        frozen_until=row.frozen_until,
        frozen_from=row.frozen_from,
    )


def store_streak(row: StreakRow, streak: Streak) -> None:
    row.current = streak.current
    row.longest = streak.longest
    row.last_active_date = streak.last_active_date
    row.freezes_available = streak.freezes_available
    row.frozen_until = streak.frozen_until
    row.frozen_from = streak.frozen_from


def displayed_streak(db: Session, user_id: str, today: date) -> int:
    """Série affichée le jour local `today` (0 si les jours manqués ne sont pas couverts)."""
    row = db.get(StreakRow, user_id)
    return displayed_current(streak_of(row), today) if row is not None else 0


def level_of(enrollment: Enrollment | None, pack: Pack | None) -> LevelInfo:
    return level_info(enrollment.xp_total if enrollment else 0, pack)


def add_xp(enrollment: Enrollment, xp: int) -> None:
    enrollment.xp_total = (enrollment.xp_total or 0) + xp
    enrollment.level = level_info(enrollment.xp_total, None).value


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
