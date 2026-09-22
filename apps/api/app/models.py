"""Modèle de données (spec §11).

Le contenu (packs, leçons, concepts) n'est pas en base : on ne stocke que des identifiants
(`vi-south`, `vi-south.u01.l01`, `c_ba`). Les tables des phases ultérieures sont déjà
présentes, minimales, pour que la migration initiale soit complète.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
)
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
    # Adresse confirmée par le lien reçu par e-mail (ou fournisseur OAuth qui l'atteste).
    email_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    # Rôles attribués (contrat Phase 4 §0) parmi reviewer, editor, teacher, admin ; `learner` est implicite.
    roles: Mapped[list[str]] = mapped_column(JSON, default=list, server_default=text("'[]'"))


class RefreshToken(Base):
    """Jeton de rafraîchissement, stocké haché (SHA-256) pour pouvoir être révoqué."""

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    # Rotation : id du jeton successeur (fenêtre de grâce de 30 s ; distingue rotation et révocation).
    replaced_by_id: Mapped[str | None] = mapped_column(String(36))


class AuthToken(Base):
    """Jeton à usage unique envoyé par e-mail (réinitialisation du mot de passe, vérification), stocké haché."""

    __tablename__ = "auth_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    purpose: Mapped[str] = mapped_column(String(16))  # password_reset | email_verify
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    motivation: Mapped[str | None] = mapped_column(String(16))
    daily_goal_min: Mapped[int] = mapped_column(Integer, default=10)
    reminder_hour: Mapped[int | None] = mapped_column(Integer)
    level_estimate: Mapped[str | None] = mapped_column(String(16))
    path_variant: Mapped[str | None] = mapped_column(String(32))
    leagues_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Vrai quand l'utilisateur a choisi explicitement (sinon la valeur suit la motivation, spec §5.3).
    leagues_enabled_explicit: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Réponses d'onboarding (contrat parcours §4).
    entourage: Mapped[str | None] = mapped_column(String(16))
    self_level: Mapped[str | None] = mapped_column(String(16))
    # Jour local du dernier rappel push envoyé : un rappel par utilisateur et par jour.
    last_reminded_on: Mapped[date | None] = mapped_column(Date)
    # Fuseau IANA (rappels push, jour local côté serveur).
    timezone: Mapped[str | None] = mapped_column(String(64))
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Point d'entrée du dernier test de placement : les leçons situées avant sont ouvertes (comme côté client).
    placement_entry_lesson_id: Mapped[str | None] = mapped_column(String(128))


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
    xp_total: Mapped[int] = mapped_column(BigInteger, default=0)
    level: Mapped[int] = mapped_column(Integer, default=1)


class LessonProgress(Base):
    __tablename__ = "lesson_progress"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    lesson_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))
    score: Mapped[float | None] = mapped_column(Float)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    # Maîtrise (contrat phase10 §3), gardée pour la restauration d'un appareil : acquise dès qu'une
    # tentative a tout réussi, jamais reperdue. Fausse pour les lignes écrites avant le contrat
    # phase25 §1 — le client la redéduit alors d'un score parfait, qui l'implique.
    mastered: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


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
    __table_args__ = (Index("ix_answers_user_id_created_at", "user_id", "created_at"),)

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
    response_ms: Mapped[int] = mapped_column(BigInteger)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class StudySession(Base):
    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_id_ended_at", "user_id", "ended_at"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sessionId client
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    xp_gained: Mapped[int] = mapped_column(BigInteger, default=0)
    items_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str | None] = mapped_column(String(16))
    planned_seconds: Mapped[int | None] = mapped_column(BigInteger)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    # Jour local de l'utilisateur (payload `localDate` de session_completed) : objectif quotidien.
    local_date: Mapped[date | None] = mapped_column(Date)


class StreakRow(Base):
    __tablename__ = "streaks"

    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True)
    current: Mapped[int] = mapped_column(Integer, default=0)
    longest: Mapped[int] = mapped_column(Integer, default=0)
    last_active_date: Mapped[date | None] = mapped_column(Date)
    freezes_available: Mapped[int] = mapped_column(Integer, default=0)
    frozen_until: Mapped[date | None] = mapped_column(Date)
    # Jour local de la déclaration du gel : seuls les jours ≥ frozen_from sont couverts.
    frozen_from: Mapped[date | None] = mapped_column(Date)


class ProcessedEvent(Base):
    """Événement brut reçu : clé d'idempotence et journal de rejeu."""

    __tablename__ = "processed_events"
    # Défis de la semaine : événements d'un type sur une période.
    __table_args__ = (Index("ix_processed_events_user_type_occurred", "user_id", "type", "occurred_at"),)

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
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    # words_theme : unité courante de l'utilisateur, figée à la première lecture du défi.
    unit_id: Mapped[str | None] = mapped_column(String(128))


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
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    # Réponses brutes soumises (audit de la notation).
    answers_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)


class Certificate(Base):
    __tablename__ = "certificates"
    __table_args__ = (Index("ix_certificates_user_id_level", "user_id", "level"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    level: Mapped[str] = mapped_column(String(4))
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    verification_code: Mapped[str] = mapped_column(String(32), unique=True)
    # Clé de stockage du PDF (disque local ou S3), pas une URL publique.
    pdf_url: Mapped[str | None] = mapped_column(String(512))
    course_id: Mapped[str | None] = mapped_column(String(64))
    attempt_id: Mapped[str | None] = mapped_column(ForeignKey("exam_attempts.id", ondelete="SET NULL"))
    # Figés à la délivrance : un certificat ne change pas si le profil change.
    display_name: Mapped[str | None] = mapped_column(String(80))
    certificate_name: Mapped[dict[str, str] | None] = mapped_column(JSON)
    scores_json: Mapped[dict[str, float] | None] = mapped_column(JSON)


class TutorMessage(Base):
    __tablename__ = "tutor_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class TutorCache(Base):
    """Réponses de Cô Mai mises en cache (salutation par utilisateur/jour, « pourquoi ? » partagé)."""

    __tablename__ = "tutor_cache"

    # SHA-256 hexadécimal de la clé logique (voir app/services/tutor.py).
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    # Null pour les entrées non personnalisées (partagées entre utilisateurs).
    user_id: Mapped[str | None] = mapped_column(user_fk(), index=True)
    locale: Mapped[str] = mapped_column(String(8))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), index=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    endpoint: Mapped[str] = mapped_column(String(1024))
    keys_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    reminder_hour: Mapped[int | None] = mapped_column(Integer)
    timezone: Mapped[str | None] = mapped_column(String(64))
    # Jour local du dernier rappel envoyé : une notification par jour au plus.
    last_notified_on: Mapped[date | None] = mapped_column(Date)


class PronunciationScore(Base):
    """Score seul, jamais l'audio (spec §14)."""

    __tablename__ = "pronunciation_scores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    concept_id: Mapped[str] = mapped_column(String(128))
    score: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class GamePlay(Base):
    """Partie de mini-jeu hors leçon (`game_played`) : progression des défis, aucune XP serveur."""

    __tablename__ = "game_plays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # id de l'événement client
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    game: Mapped[str] = mapped_column(String(32))
    correct: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int] = mapped_column(BigInteger)
    local_date: Mapped[date] = mapped_column(Date)
    played_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)


# --- Phase 3 : conversation, ligues, défis entre amis, défi express ---------------------------


class Conversation(Base):
    """Conversation avec Cô Mai (`free` ou mini-jeu `doi_dap`). Purgée avec `tutor_messages` (90 j)."""

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    course_id: Mapped[str] = mapped_column(String(64))
    mode: Mapped[str] = mapped_column(String(16))
    locale: Mapped[str] = mapped_column(String(8))
    topic_lesson_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    fluency: Mapped[int | None] = mapped_column(Integer)
    summary_json: Mapped[dict[str, str] | None] = mapped_column(JSON)


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"
    __table_args__ = (UniqueConstraint("conversation_id", "position"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    text: Mapped[str] = mapped_column(Text)
    glosses_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # Correction douce (tour `user` seulement) : {original, corrected, explanation}.
    correction_json: Mapped[dict[str, str] | None] = mapped_column(JSON)
    response_ms: Mapped[int | None] = mapped_column(BigInteger)
    # Tour `assistant` : « model » ou « fallback ».
    source: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class LeagueGroup(Base):
    """Groupe de ligue d'une semaine (lundi 00:00 UTC) dans une division 1 (entrée) à 5 (sommet)."""

    __tablename__ = "league_groups"
    __table_args__ = (UniqueConstraint("week_start", "division", "group_index"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    week_start: Mapped[date] = mapped_column(Date, index=True)
    division: Mapped[int] = mapped_column(Integer)
    group_index: Mapped[int] = mapped_column(Integer)


class LeagueMember(Base):
    __tablename__ = "league_members"

    week_start: Mapped[date] = mapped_column(Date, primary_key=True)
    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True, index=True)
    group_id: Mapped[str] = mapped_column(ForeignKey("league_groups.id", ondelete="CASCADE"), index=True)
    division: Mapped[int] = mapped_column(Integer)
    # Figés au passage de semaine : classement final et issue (promoted | relegated | stayed).
    final_xp: Mapped[int | None] = mapped_column(BigInteger)
    final_rank: Mapped[int | None] = mapped_column(Integer)
    outcome: Mapped[str | None] = mapped_column(String(16))


class FriendChallenge(Base):
    __tablename__ = "friend_challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(16))
    invite_code: Mapped[str] = mapped_column(String(8), unique=True)
    creator_id: Mapped[str] = mapped_column(user_fk(), index=True)
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime())
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class FriendChallengeParticipant(Base):
    __tablename__ = "friend_challenge_participants"

    challenge_id: Mapped[str] = mapped_column(ForeignKey("friend_challenges.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True, index=True)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ExpressScore(Base):
    """Score d'un défi express (60 s) : meilleur du jour et classement du jour par jeu."""

    __tablename__ = "express_scores"
    __table_args__ = (Index("ix_express_scores_game_local_date", "game", "local_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(user_fk(), index=True)
    game: Mapped[str] = mapped_column(String(32))
    score: Mapped[int] = mapped_column(Integer)
    correct: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    local_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


# --- Phase 4 : studio de contenu, espace enseignant -------------------------------------------


class ContentDraft(Base):
    """Brouillon d'un document de contenu (le publié reste le fichier JSON de CONTENT_DIR, ADR 0002)."""

    __tablename__ = "content_drafts"
    __table_args__ = (UniqueConstraint("pack_code", "kind", "doc_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pack_code: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))
    doc_id: Mapped[str] = mapped_column(String(128))
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ContentPublication(Base):
    __tablename__ = "content_publications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pack_code: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    message: Mapped[str] = mapped_column(Text)
    files: Mapped[list[str]] = mapped_column(JSON, default=list)
    pack_version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ContentReview(Base):
    """Verdict de relecture native (approve | changes) sur un document."""

    __tablename__ = "content_reviews"
    __table_args__ = (Index("ix_content_reviews_pack_kind_doc", "pack_code", "kind", "doc_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pack_code: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))
    doc_id: Mapped[str] = mapped_column(String(128))
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verdict: Mapped[str] = mapped_column(String(16))
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class SchoolClass(Base):
    __tablename__ = "classes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    teacher_id: Mapped[str] = mapped_column(user_fk(), index=True)
    name: Mapped[str] = mapped_column(String(80))
    pack_code: Mapped[str] = mapped_column(String(64))
    join_code: Mapped[str] = mapped_column(String(6), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ClassMember(Base):
    """Élève d'une classe ; `consent_at` = consentement explicite au partage de sa progression (§14)."""

    __tablename__ = "class_members"

    class_id: Mapped[str] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(user_fk(), primary_key=True, index=True)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    consent_at: Mapped[datetime] = mapped_column(UTCDateTime())


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    class_id: Mapped[str] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    lesson_ids: Mapped[list[str]] = mapped_column(JSON)
    unit_id: Mapped[str | None] = mapped_column(String(128))
    due_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
