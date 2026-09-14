"""`/me/*` : profil, événements hors ligne, cartes dues, plan de séance. JWT obligatoire."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbDep, PacksDep
from app.models import Enrollment, Profile, User
from app.schemas.events import EventBatch, EventBatchResult
from app.schemas.me import (
    EnrollmentOut,
    MeOut,
    ProfileOut,
    ProfilePatch,
    SessionPlanOut,
    SrsCardOut,
    StreakOut,
    UserOut,
)
from app.services import learner
from app.services.events import process_batch
from app.services.planner import next_lesson, plan_session

router = APIRouter(prefix="/me", tags=["me"])


def _profile(db: Session, user: User) -> Profile:
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id, daily_goal_min=10, leagues_enabled=True)
        db.add(profile)
        db.flush()
    return profile


def _profile_out(p: Profile) -> ProfileOut:
    return ProfileOut(
        motivation=p.motivation,  # type: ignore[arg-type]
        daily_goal_min=p.daily_goal_min,
        reminder_hour=p.reminder_hour,
        level_estimate=p.level_estimate,
        path_variant=p.path_variant,
        leagues_enabled=p.leagues_enabled,
    )


def _enrollment_out(e: Enrollment | None) -> EnrollmentOut | None:
    if e is None:
        return None
    return EnrollmentOut(
        course_code=e.course_id,
        started_at=e.started_at,
        xp_total=e.xp_total,
        level=e.level,
        current_lesson_id=e.current_lesson_id,
    )


@router.get("", response_model=MeOut)
def get_me(user: CurrentUser, db: DbDep) -> MeOut:
    profile = _profile(db, user)
    streak = learner.get_streak(db, user.id)
    db.commit()
    return MeOut(
        user=UserOut(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            locale=user.locale,
            created_at=user.created_at,
            is_guest=user.is_guest,
        ),
        profile=_profile_out(profile),
        enrollment=_enrollment_out(learner.primary_enrollment(db, user.id)),
        streak=StreakOut(
            current=streak.current,
            longest=streak.longest,
            last_active_date=streak.last_active_date,
            freezes_available=streak.freezes_available,
            frozen_until=streak.frozen_until,
        ),
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
    if "motivation" in fields:
        profile.motivation = body.motivation
        # Ligue désactivée par défaut pour « famille » et « racines » (spec §5.3).
        if "leagues_enabled" not in fields:
            profile.leagues_enabled = body.motivation not in learner.LEAGUE_OPT_OUT_MOTIVATIONS
    if "leagues_enabled" in fields:
        if body.leagues_enabled is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="leaguesEnabled ne peut pas être null")
        profile.leagues_enabled = body.leagues_enabled

    db.commit()
    return _profile_out(profile)


@router.post("/events", response_model=EventBatchResult)
def post_events(body: EventBatch, user: CurrentUser, db: DbDep, packs: PacksDep) -> EventBatchResult:
    return process_batch(db, user.id, body.events, packs)


@router.get("/srs/due", response_model=list[SrsCardOut])
def srs_due(user: CurrentUser, db: DbDep, limit: Annotated[int, Query(ge=1, le=500)] = 50) -> list[SrsCardOut]:
    rows = learner.due_cards(db, user.id, datetime.now(UTC), limit)
    return [
        SrsCardOut(
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
        for r in rows
    ]


@router.get("/session/next", response_model=SessionPlanOut)
def session_next(user: CurrentUser, db: DbDep, packs: PacksDep) -> SessionPlanOut:
    profile = _profile(db, user)
    enrollment = learner.primary_enrollment(db, user.id)
    pack = packs.get(enrollment.course_id) if enrollment else None
    if enrollment is None or pack is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Aucune inscription à un cours disponible")
    lesson = next_lesson(pack, pack.lessons, learner.completed_lessons(db, user.id), learner.path_of(profile))
    plan = plan_session(profile.daily_goal_min, learner.user_cards(db, user.id), lesson, datetime.now(UTC))
    db.commit()
    return SessionPlanOut(
        course_code=pack.code,
        target_minutes=profile.daily_goal_min,
        blocks=plan.blocks,
        estimated_seconds=plan.estimated_seconds,
    )
