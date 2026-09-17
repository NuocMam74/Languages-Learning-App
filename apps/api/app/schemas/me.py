"""Schémas de `/me`, du profil, des cartes SRS et du plan de séance."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field

from app.schemas import CamelModel

Motivation = Literal["family", "travel", "work", "roots", "curiosity"]
DailyGoal = Literal[5, 10, 15, 20]
Entourage = Literal["nobody", "partner", "parents", "colleagues"]
SelfLevel = Literal["none", "words", "understand", "speak"]
InterfaceLocale = Literal["fr", "en"]


class UserOut(CamelModel):
    id: str
    email: str | None
    display_name: str
    locale: str
    created_at: datetime
    is_guest: bool
    # Adresse confirmée (lien reçu par e-mail ou fournisseur OAuth qui l'atteste).
    email_verified: bool


class ProfileOut(CamelModel):
    motivation: Motivation | None
    daily_goal_min: int
    reminder_hour: int | None
    level_estimate: str | None
    path_variant: str | None
    leagues_enabled: bool
    timezone: str | None
    notifications_enabled: bool
    entourage: Entourage | None
    self_level: SelfLevel | None
    interface_locale: str


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
    # Jour local de la déclaration du gel (seuls les jours ≥ frozenFrom sont couverts).
    frozen_from: date | None


class LevelOut(CamelModel):
    """Niveau de profil 1–50 (contrat parcours §3)."""

    value: int
    name: dict[str, str]
    xp_into_level: int
    xp_for_next: int


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
    # Contrat Phase 4 §0 : `learner` (implicite) puis reviewer | editor | teacher | admin.
    roles: list[str]
    # Niveau de profil du pack courant (XP de son inscription).
    level: LevelOut


class ProfilePatch(CamelModel):
    # Champs inconnus ignorés : un client plus récent ne doit pas voir sa synchronisation du profil refusée.
    model_config = ConfigDict(extra="ignore")

    motivation: Motivation | None = None
    daily_goal_min: DailyGoal | None = None
    reminder_hour: Annotated[int, Field(ge=0, le=23)] | None = None
    path_variant: Annotated[str, Field(min_length=1, max_length=32)] | None = None
    leagues_enabled: bool | None = None
    # Fuseau IANA (ex. « Europe/Paris ») ; null efface.
    timezone: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    notifications_enabled: bool | None = None
    entourage: Entourage | None = None
    self_level: SelfLevel | None = None
    interface_locale: InterfaceLocale | None = None
    # Nom affiché : vit sur l'utilisateur, pas sur le profil ; accepté ici car le client synchronise tout ensemble.
    display_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None


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


class PlacementOut(CamelModel):
    level_estimate: int
    entry_lesson_id: str


class LessonProgressOut(CamelModel):
    lesson_id: str
    best_score: float
    attempts: int
    completed_at: datetime | None


class StateOut(CamelModel):
    """`GET /me/state?pack=` : restauration d'un appareil (contrat parcours §4)."""

    profile: ProfileOut
    placement: PlacementOut | None
    lesson_progress: list[LessonProgressOut]
    srs_cards: list[SrsCardOut]
    badges: list[BadgeOut]
    streak: StreakOut
    xp_total: int
    level: LevelOut
    # Le compte est inscrit à ce pack : onboarding et placement ne sont pas reproposés.
    enrolled: bool


class DeleteMeIn(CamelModel):
    """Mot de passe (compte e-mail) ou `confirm: "SUPPRIMER"` (compte sans mot de passe, OAuth)."""

    password: Annotated[str, Field(min_length=1, max_length=256)] | None = None
    confirm: Annotated[str, Field(max_length=32)] | None = None


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
    # Médias présents (contrat parcours §1).
    media_index: list[str]
    coming_soon: bool
