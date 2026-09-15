"""Schémas de `/me`, du profil, des cartes SRS et du plan de séance."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import Field

from app.schemas import CamelModel

Motivation = Literal["family", "travel", "work", "roots", "curiosity"]
DailyGoal = Literal[5, 10, 15, 20]


class UserOut(CamelModel):
    id: str
    email: str | None
    display_name: str
    locale: str
    created_at: datetime
    is_guest: bool


class ProfileOut(CamelModel):
    motivation: Motivation | None
    daily_goal_min: int
    reminder_hour: int | None
    level_estimate: str | None
    path_variant: str | None
    leagues_enabled: bool
    timezone: str | None
    notifications_enabled: bool


class EnrollmentOut(CamelModel):
    course_code: str
    started_at: datetime
    xp_total: int
    level: int
    current_lesson_id: str | None


class StreakOut(CamelModel):
    current: int
    longest: int
    last_active_date: date | None
    freezes_available: int
    frozen_until: date | None


class BadgeOut(CamelModel):
    code: str
    earned_at: datetime


class DailyGoalOut(CamelModel):
    target_min: int
    # Minutes de séances terminées ce jour local (1 décimale).
    done_today_min: float
    # Jour local retenu : paramètre `localDate`, sinon jour de la dernière séance récente, sinon date UTC.
    local_date: date


class MeOut(CamelModel):
    user: UserOut
    profile: ProfileOut
    # Inscription du pack courant (dernier `pack_switched`, sinon vi-south).
    enrollment: EnrollmentOut | None
    # Toutes les inscriptions (une par pack), par date d'inscription.
    enrollments: list[EnrollmentOut]
    streak: StreakOut
    # Estimation 0–3 issue du test de placement (null tant qu'il n'a pas été passé).
    level_estimate: int | None
    badges: list[BadgeOut]
    daily_goal: DailyGoalOut


class ProfilePatch(CamelModel):
    motivation: Motivation | None = None
    daily_goal_min: DailyGoal | None = None
    reminder_hour: Annotated[int, Field(ge=0, le=23)] | None = None
    path_variant: Annotated[str, Field(min_length=1, max_length=32)] | None = None
    leagues_enabled: bool | None = None
    # Fuseau IANA (ex. « Europe/Paris ») ; null efface.
    timezone: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    notifications_enabled: bool | None = None


class SrsCardOut(CamelModel):
    """Forme `SrsCard` de packages/core/src/srs.ts."""

    concept_id: str
    due: datetime
    stability: float
    difficulty: float
    scheduled_days: float
    learning_steps: int
    reps: int
    lapses: int
    state: str
    last_review: datetime | None


class SessionPlanOut(CamelModel):
    """Forme `SessionPlan` de packages/core/src/session.ts (+ contexte)."""

    course_code: str
    target_minutes: int
    blocks: list[dict[str, Any]]
    estimated_seconds: int | float


class CourseOut(CamelModel):
    code: str
    lang: str
    variant: str | None
    name: dict[str, str]
    version: int
    features: list[str]
    interface_locales: list[str]
    coming_soon: bool


class ManifestOut(CamelModel):
    code: str
    version: int
    base_url: str
    files: list[str]
