"""Modèle de données (spec §11).

Le contenu (packs, leçons, concepts) n'est pas en base : on ne stocke que des identifiants
(`vi-south`, `vi-south.u01.l01`, `c_ba`). Les tables des phases ultérieures sont déjà
présentes, minimales, pour que la migration initiale soit complète.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


def user_fk() -> ForeignKey:
    return ForeignKey("users.id", ondelete="CASCADE")


# --- Comptes -------------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(80))
    locale: Mapped[str] = mapped_column(String(8), default="fr")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False)
    apple_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)


class RefreshToken(Base):
    """Jeton de rafraîchissement, stocké haché (SHA-256) pour pouvoir être révoqué."""

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    motivation: Mapped[str | None] = mapped_column(String(16))
    daily_goal_min: Mapped[int] = mapped_column(Integer, default=10)
    reminder_hour: Mapped[int | None] = mapped_column(Integer)
    level_estimate: Mapped[str | None] = mapped_column(String(16))
    path_variant: Mapped[str | None] = mapped_column(String(32))
    leagues_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


# --- Parcours ------------------------------------------------------------------------------


class Course(Base):
    """Publication d'un pack (métadonnées seules). Le pack fait foi sur disque/CDN."""

    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # code du pack, ex. « vi-south »
    lang_code: Mapped[str] = mapped_column(String(16))
    variant: Mapped[str | None] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Enrollment(Base):
    __tablename__ = "enrollments"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    # Code du pack ; volontairement sans clé étrangère : le contenu vit hors base.
    course_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    current_lesson_id: Mapped[str | None] = mapped_column(String(128))
    xp_total: Mapped[int] = mapped_column(Integer, default=0)
    level: Mapped[int] = mapped_column(Integer, default=1)


class LessonProgress(Base):
    __tablename__ = "lesson_progress"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))
    score: Mapped[float | None] = mapped_column(Float)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class SrsCardRow(Base):
    __tablename__ = "srs_cards"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    concept_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    stability: Mapped[float] = mapped_column(Float)
    difficulty: Mapped[float] = mapped_column(Float)
    due_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    reps: Mapped[int] = mapped_column(Integer)
    lapses: Mapped[int] = mapped_column(Integer)
    last_review: Mapped[datetime | None] = mapped_column(UTCDateTime())
    state: Mapped[str] = mapped_column(String(16))
    scheduled_days: Mapped[float] = mapped_column(Float, default=0)
    learning_steps: Mapped[int] = mapped_column(Integer, default=0)


class Answer(Base):
    """Journal des réponses, en ajout seul (ADR 0003). `id` = id de l'événement client."""

    __tablename__ = "answers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    session_id: Mapped[str | None] = mapped_column(String(64), index=True)
    lesson_id: Mapped[str | None] = mapped_column(String(128))
    step_index: Mapped[int] = mapped_column(Integer)
    exercise_type: Mapped[str] = mapped_column(String(32))
    # Premier concept (colonne de la spec) ; la liste complète est dans `concept_ids`.
    concept_id: Mapped[str | None] = mapped_column(String(128), index=True)
    concept_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    correct: Mapped[bool] = mapped_column(Boolean)
    near_miss: Mapped[bool] = mapped_column(Boolean, default=False)
    response_ms: Mapped[int] = mapped_column(Integer)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class StudySession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sessionId client
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    xp_gained: Mapped[int] = mapped_column(Integer, default=0)
    items_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str | None] = mapped_column(String(16))
    planned_seconds: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class StreakRow(Base):
    __tablename__ = "streaks"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    current: Mapped[int] = mapped_column(Integer, default=0)
    longest: Mapped[int] = mapped_column(Integer, default=0)
    last_active_date: Mapped[date | None] = mapped_column(Date)
    freezes_available: Mapped[int] = mapped_column(Integer, default=0)
    frozen_until: Mapped[date | None] = mapped_column(Date)


class ProcessedEvent(Base):
    """Événement brut reçu : clé d'idempotence et journal de rejeu."""

    __tablename__ = "processed_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    type: Mapped[str] = mapped_column(String(32))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime())
    received_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON)


# --- Phases ultérieures (minimal) ----------------------------------------------------------


class Challenge(Base):
    __tablename__ = "challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(32))
    period_start: Mapped[datetime] = mapped_column(UTCDateTime())
    period_end: Mapped[datetime] = mapped_column(UTCDateTime())
    spec_json: Mapped[dict[str, Any]] = mapped_column(JSON)


class ChallengeProgress(Base):
    __tablename__ = "challenge_progress"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    challenge_id: Mapped[str] = mapped_column(ForeignKey("challenges.id", ondelete="CASCADE"), primary_key=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Badge(Base):
    __tablename__ = "badges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    family: Mapped[str] = mapped_column(String(16))
    criteria_json: Mapped[dict[str, Any]] = mapped_column(JSON)


class UserBadge(Base):
    __tablename__ = "user_badges"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    badge_id: Mapped[str] = mapped_column(ForeignKey("badges.id", ondelete="CASCADE"), primary_key=True)
    earned_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(String(64))
    level: Mapped[str] = mapped_column(String(4))
    spec_json: Mapped[dict[str, Any]] = mapped_column(JSON)


class ExamAttempt(Base):
    __tablename__ = "exam_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    exam_id: Mapped[str] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    score_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    passed: Mapped[bool | None] = mapped_column(Boolean)


class Certificate(Base):
    __tablename__ = "certificates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    level: Mapped[str] = mapped_column(String(4))
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    verification_code: Mapped[str] = mapped_column(String(32), unique=True)
    pdf_url: Mapped[str | None] = mapped_column(String(512))


class TutorMessage(Base):
    __tablename__ = "tutor_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    endpoint: Mapped[str] = mapped_column(String(1024))
    keys_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class PronunciationScore(Base):
    """Score seul, jamais l'audio (spec §14)."""

    __tablename__ = "pronunciation_scores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    concept_id: Mapped[str] = mapped_column(String(128))
    score: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
