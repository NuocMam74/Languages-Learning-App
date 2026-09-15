"""`/me/*` : profil, état restaurable, événements hors ligne, cartes dues, plan de séance, RGPD. JWT obligatoire."""

import logging
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbDep, PacksDep, SettingsDep, StorageDep, user_roles
from app.models import Enrollment, LessonProgress, Profile, SrsCardRow, User
from app.routers.auth import clear_refresh_cookie
from app.schemas.events import EventBatch, EventBatchResult
from app.schemas.me import (
    BadgeOut,
    DailyGoalOut,
    DeleteMeIn,
    EnrollmentOut,
    LessonProgressOut,
    LevelOut,
    MeOut,
    PlacementOut,
    ProfileOut,
    ProfilePatch,
    SessionPlanOut,
    SrsCardOut,
    StateOut,
    StreakOut,
    UserOut,
)
from app.services import account, learner
from app.services import auth as auth_service
from app.services.content import Pack, course_code_of_concept, course_code_of_lesson
from app.services.events import process_batch
from app.services.levels import LevelInfo
from app.services.planner import plan_session
from app.services.push import valid_timezone

router = APIRouter(prefix="/me", tags=["me"])
logger = logging.getLogger(__name__)

LocalDateQuery = Annotated[
    date | None, Query(alias="localDate", description="Jour local du client (AAAA-MM-JJ), pour l'objectif et la série")
]


def _profile(db: Session, user: User) -> Profile:
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id, daily_goal_min=10, leagues_enabled=True)
        db.add(profile)
        db.flush()
    return profile


def _profile_out(p: Profile, user: User) -> ProfileOut:
    return ProfileOut(
        motivation=p.motivation,  # type: ignore[arg-type]
        daily_goal_min=p.daily_goal_min,
        reminder_hour=p.reminder_hour,
        level_estimate=p.level_estimate,
        path_variant=p.path_variant,
        leagues_enabled=p.leagues_enabled,
        timezone=p.timezone,
        notifications_enabled=bool(p.notifications_enabled),
        entourage=p.entourage,  # type: ignore[arg-type]
        self_level=p.self_level,  # type: ignore[arg-type]
        interface_locale=user.locale,
    )


def _enrollment_out(e: Enrollment | None) -> EnrollmentOut | None:
    if e is None:
        return None
    return EnrollmentOut(
        course_code=e.course_id,
        started_at=e.started_at,
        xp_total=e.xp_total,
        level=learner.level_of(e, None).value,
        current_lesson_id=e.current_lesson_id,
    )


def _level_out(info: LevelInfo) -> LevelOut:
    return LevelOut(value=info.value, name=info.name, xp_into_level=info.xp_into_level, xp_for_next=info.xp_for_next)


def _streak_out(db: Session, user_id: str, today: date) -> StreakOut:
    row = learner.get_streak(db, user_id)
    streak = learner.streak_of(row)
    return StreakOut(
        current=learner.displayed_current(streak, today),
        longest=streak.longest,
        last_active_date=streak.last_active_date,
        freezes_available=streak.freezes_available,
        frozen_until=streak.frozen_until,
        frozen_from=streak.frozen_from,
    )


def _badges(db: Session, user_id: str) -> list[BadgeOut]:
    """Badges d'apprentissage et de défis (`challenge_*`, décernés par le serveur)."""
    return [BadgeOut(code=code, earned_at=at) for code, at in learner.user_badges(db, user_id)]


@router.get("", response_model=MeOut)
def get_me(user: CurrentUser, db: DbDep, packs: PacksDep, local_date: LocalDateQuery = None) -> MeOut:
    profile = _profile(db, user)
    learner.get_streak(db, user.id)
    db.commit()
    today = learner.current_local_date(db, user.id, datetime.now(UTC), local_date)
    primary = learner.primary_enrollment(db, user.id)
    return MeOut(
        user=UserOut(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            locale=user.locale,
            created_at=user.created_at,
            is_guest=user.is_guest,
            email_verified=user.email_verified_at is not None,
        ),
        profile=_profile_out(profile, user),
        enrollment=_enrollment_out(primary),
        enrollments=[out for e in learner.enrollments(db, user.id) if (out := _enrollment_out(e)) is not None],
        streak=_streak_out(db, user.id, today),
        level_estimate=learner.level_estimate(profile),
        badges=_badges(db, user.id),
        daily_goal=DailyGoalOut(
            target_min=profile.daily_goal_min,
            done_today_min=learner.minutes_done_on(db, user.id, today),
            local_date=today,
        ),
        roles=user_roles(user),
        level=_level_out(learner.level_of(primary, packs.get(primary.course_id) if primary else None)),
    )


def _state_pack(db: Session, user: User, packs: dict[str, Pack], code: str | None) -> Pack:
    if code is None:
        enrollment = learner.primary_enrollment(db, user.id)
        code = enrollment.course_id if enrollment else learner.DEFAULT_PACK
    pack = packs.get(code)
    if pack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Cours inconnu : {code}")
    return pack


@router.get("/state", response_model=StateOut)
def get_state(
    user: CurrentUser,
    db: DbDep,
    packs: PacksDep,
    pack_code: Annotated[str | None, Query(alias="pack", max_length=64)] = None,
    local_date: LocalDateQuery = None,
) -> StateOut:
    """Restauration d'un appareil : profil, placement, progression, cartes, badges, série, XP et niveau du pack."""
    pack = _state_pack(db, user, packs, pack_code)
    profile = _profile(db, user)
    learner.get_streak(db, user.id)
    db.commit()
    today = learner.current_local_date(db, user.id, datetime.now(UTC), local_date)

    placement = None
    entry = profile.placement_entry_lesson_id
    estimate = learner.level_estimate(profile)
    if entry and estimate is not None and course_code_of_lesson(entry) == pack.code:
        placement = PlacementOut(level_estimate=estimate, entry_lesson_id=entry)

    progress = db.scalars(
        select(LessonProgress)
        .where(
            LessonProgress.user_id == user.id,
            LessonProgress.status == "completed",
            LessonProgress.lesson_id.like(f"{pack.code}.%"),
        )
        .order_by(LessonProgress.lesson_id)
    )
    cards = [
        r
        for r in db.scalars(select(SrsCardRow).where(SrsCardRow.user_id == user.id).order_by(SrsCardRow.concept_id))
        if course_code_of_concept(r.concept_id, packs.keys(), learner.DEFAULT_PACK) == pack.code
    ]
    enrollment = db.get(Enrollment, (user.id, pack.code))
    return StateOut(
        profile=_profile_out(profile, user),
        placement=placement,
        lesson_progress=[
            LessonProgressOut(
                lesson_id=p.lesson_id,
                best_score=float(p.score or 0.0),
                attempts=p.attempts,
                completed_at=p.completed_at,
            )
            for p in progress
        ],
        srs_cards=[_card_out(r) for r in cards],
        badges=_badges(db, user.id),
        streak=_streak_out(db, user.id, today),
        xp_total=enrollment.xp_total if enrollment else 0,
        level=_level_out(learner.level_of(enrollment, pack)),
        enrolled=enrollment is not None,
    )


@router.patch("/profile", response_model=ProfileOut)
def patch_profile(body: ProfilePatch, user: CurrentUser, db: DbDep, packs: PacksDep) -> ProfileOut:
    profile = _profile(db, user)
    fields = body.model_fields_set

    if "daily_goal_min" in fields:
        if body.daily_goal_min is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="dailyGoalMin ne peut pas être null")
        profile.daily_goal_min = body.daily_goal_min
    if "reminder_hour" in fields:
        profile.reminder_hour = body.reminder_hour
    if "path_variant" in fields:
        enrollment = learner.primary_enrollment(db, user.id)
        pack = packs.get(enrollment.course_id) if enrollment else None
        if body.path_variant is not None and pack is not None and body.path_variant not in pack.paths:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Parcours inconnu : {body.path_variant}")
        profile.path_variant = body.path_variant
    if "leagues_enabled" in fields:
        if body.leagues_enabled is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="leaguesEnabled ne peut pas être null")
        profile.leagues_enabled = body.leagues_enabled
        profile.leagues_enabled_explicit = True
    if "motivation" in fields:
        profile.motivation = body.motivation
        # Ligue désactivée par défaut pour « famille » et « racines » (spec §5.3), même quand le profil arrive
        # après l'inscription : la motivation décide tant que l'utilisateur n'a pas choisi explicitement.
        if not profile.leagues_enabled_explicit:
            profile.leagues_enabled = body.motivation not in learner.LEAGUE_OPT_OUT_MOTIVATIONS
    if "timezone" in fields:
        if body.timezone is not None and not valid_timezone(body.timezone):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Fuseau inconnu : {body.timezone}")
        profile.timezone = body.timezone
    if "notifications_enabled" in fields:
        if body.notifications_enabled is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, detail="notificationsEnabled ne peut pas être null"
            )
        profile.notifications_enabled = body.notifications_enabled
    if "entourage" in fields:
        profile.entourage = body.entourage
    if "self_level" in fields:
        profile.self_level = body.self_level
    if "interface_locale" in fields and body.interface_locale is not None:
        user.locale = body.interface_locale

    db.commit()
    return _profile_out(profile, user)


@router.post("/events", response_model=EventBatchResult)
def post_events(body: EventBatch, user: CurrentUser, db: DbDep, packs: PacksDep) -> EventBatchResult | JSONResponse:
    try:
        return process_batch(db, user.id, body.events, packs)
    except Exception:
        # Échec au niveau du lot (ex. validation finale) : 500 JSON, le client scinde le lot et réessaie (§4).
        logger.exception("Lot d'événements en échec pour %s", user.id)
        db.rollback()
        return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "server_error"})


def _card_out(r: SrsCardRow) -> SrsCardOut:
    return SrsCardOut(
        concept_id=r.concept_id,
        due=r.due_at,
        stability=r.stability,
        difficulty=r.difficulty,
        scheduled_days=r.scheduled_days,
        learning_steps=r.learning_steps,
        reps=r.reps,
        lapses=r.lapses,
        state=r.state,
        last_review=r.last_review,
    )


@router.get("/srs/due", response_model=list[SrsCardOut])
def srs_due(user: CurrentUser, db: DbDep, limit: Annotated[int, Query(ge=1, le=500)] = 50) -> list[SrsCardOut]:
    return [_card_out(r) for r in learner.due_cards(db, user.id, datetime.now(UTC), limit)]


@router.get("/session/next", response_model=SessionPlanOut)
def session_next(
    user: CurrentUser,
    db: DbDep,
    packs: PacksDep,
    pack_code: Annotated[
        str | None, Query(alias="pack", max_length=64, description="Code du pack (défaut : courant)")
    ] = None,
) -> SessionPlanOut:
    profile = _profile(db, user)
    if pack_code is not None:
        pack = packs.get(pack_code)
        if pack is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Cours inconnu : {pack_code}")
        enrollment = db.get(Enrollment, (user.id, pack.code))
        if enrollment is None:
            # Pack choisi avant la synchronisation de `pack_switched` : inscription à la volée.
            enrollment = learner.enroll(db, user.id, pack, path=None)
            db.flush()
    else:
        enrollment = learner.primary_enrollment(db, user.id)
        pack = packs.get(enrollment.course_id) if enrollment else None
    if enrollment is None or pack is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Aucune inscription à un cours disponible")
    lesson_id = learner.next_lesson_for(db, user.id, pack, profile)
    lesson = pack.lessons.get(lesson_id) if lesson_id else None
    cards = learner.user_cards(db, user.id, pack.code, packs.keys())
    plan = plan_session(profile.daily_goal_min, cards, lesson, datetime.now(UTC))
    db.commit()
    return SessionPlanOut(
        course_code=pack.code,
        target_minutes=profile.daily_goal_min,
        blocks=plan.blocks,
        estimated_seconds=plan.estimated_seconds,
    )


# --- RGPD ---------------------------------------------------------------------------------------


@router.get("/export")
def export_me(user: CurrentUser, db: DbDep) -> JSONResponse:
    data: dict[str, Any] = account.export_user(db, user)
    return JSONResponse(
        data,
        headers={
            "Content-Disposition": 'attachment; filename="parlo-export.json"',
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(body: DeleteMeIn, user: CurrentUser, db: DbDep, settings: SettingsDep, storage: StorageDep) -> Response:
    if user.password_hash is not None:
        if body.password is None or not auth_service.verify_password(user.password_hash, body.password):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="invalid_password")
    elif body.confirm != account.DELETE_CONFIRMATION:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="confirmation_required")
    account.delete_user(db, storage, user)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, settings)
    return response
