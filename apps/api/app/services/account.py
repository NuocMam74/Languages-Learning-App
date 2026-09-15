"""RGPD (spec §14, contrat parcours §4) : export complet des données d'un compte et suppression effective."""

import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Answer,
    Badge,
    Certificate,
    ChallengeProgress,
    ClassMember,
    Conversation,
    ConversationTurn,
    Enrollment,
    ExamAttempt,
    ExpressScore,
    FriendChallengeParticipant,
    GamePlay,
    LeagueMember,
    LessonProgress,
    ProcessedEvent,
    Profile,
    PronunciationScore,
    PushSubscription,
    SrsCardRow,
    StreakRow,
    StudySession,
    TutorMessage,
    User,
    UserBadge,
)
from app.services.storage import FileStorage

logger = logging.getLogger(__name__)
DELETE_CONFIRMATION = "SUPPRIMER"


def _value(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    return v


def _row(obj: Any, exclude: tuple[str, ...] = ()) -> dict[str, Any]:
    return {
        column.key: _value(getattr(obj, column.key))
        for column in obj.__table__.columns
        if column.key not in exclude and column.key != "user_id"
    }


def _rows(db: Session, model: Any, user_id: str, *order: Any, exclude: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    query = select(model).where(model.user_id == user_id)
    if order:
        query = query.order_by(*order)
    return [_row(r, exclude) for r in db.scalars(query)]


def export_user(db: Session, user: User) -> dict[str, Any]:
    """Toutes les données personnelles du compte, en JSON (jamais les hachages de mots de passe ni les jetons)."""
    user_id = user.id
    profile = db.get(Profile, user_id)
    streak = db.get(StreakRow, user_id)
    conversations = []
    for conv in db.scalars(
        select(Conversation).where(Conversation.user_id == user_id).order_by(Conversation.created_at)
    ):
        turns = db.scalars(
            select(ConversationTurn)
            .where(ConversationTurn.conversation_id == conv.id)
            .order_by(ConversationTurn.position)
        )
        conversations.append({**_row(conv), "turns": [_row(t, ("conversation_id",)) for t in turns]})
    badges = [
        {"code": code, "earnedAt": _value(at)}
        for code, at in db.execute(
            select(Badge.code, UserBadge.earned_at)
            .join(Badge, Badge.id == UserBadge.badge_id)
            .where(UserBadge.user_id == user_id)
            .order_by(UserBadge.earned_at)
        )
    ]
    return {
        "exportedAt": _value(datetime.now().astimezone()),
        "user": {
            "id": user.id,
            "email": user.email,
            "displayName": user.display_name,
            "locale": user.locale,
            "createdAt": _value(user.created_at),
            "emailVerified": user.email_verified_at is not None,
            "linkedProviders": [p for p, sub in (("google", user.google_sub), ("apple", user.apple_sub)) if sub],
            "roles": list(user.roles or []),
        },
        "profile": _row(profile) if profile else None,
        "streak": _row(streak) if streak else None,
        "enrollments": _rows(db, Enrollment, user_id, Enrollment.started_at),
        "lessonProgress": _rows(db, LessonProgress, user_id, LessonProgress.lesson_id),
        "srsCards": _rows(db, SrsCardRow, user_id, SrsCardRow.concept_id),
        "badges": badges,
        "sessions": _rows(db, StudySession, user_id, StudySession.started_at),
        "answers": _rows(db, Answer, user_id, Answer.created_at),
        "events": _rows(db, ProcessedEvent, user_id, ProcessedEvent.occurred_at),
        "pronunciationScores": _rows(db, PronunciationScore, user_id, PronunciationScore.created_at),
        "gamePlays": _rows(db, GamePlay, user_id, GamePlay.played_at),
        "conversations": conversations,
        "tutorMessages": _rows(db, TutorMessage, user_id, TutorMessage.created_at),
        "examAttempts": _rows(db, ExamAttempt, user_id, ExamAttempt.started_at),
        "certificates": _rows(db, Certificate, user_id, Certificate.issued_at, exclude=("pdf_url",)),
        "challengeProgress": _rows(db, ChallengeProgress, user_id),
        "leagueMemberships": _rows(db, LeagueMember, user_id, LeagueMember.week_start),
        "friendChallenges": _rows(db, FriendChallengeParticipant, user_id),
        "expressScores": _rows(db, ExpressScore, user_id, ExpressScore.created_at),
        "classMemberships": _rows(db, ClassMember, user_id),
        "pushSubscriptions": _rows(db, PushSubscription, user_id, exclude=("keys_json",)),
    }


def delete_user(db: Session, storage: FileStorage, user: User) -> None:
    """Suppression effective : fichiers de certificats puis ligne `users` (cascade des clés étrangères)."""
    keys = [k for k in db.scalars(select(Certificate.pdf_url).where(Certificate.user_id == user.id)) if k]
    user_id = user.id
    db.expunge(user)
    db.execute(delete(User).where(User.id == user_id))
    db.commit()
    for key in keys:
        try:
            storage.delete(key)
        except Exception:  # fichier déjà absent ou stockage indisponible : la donnée en base est supprimée
            logger.warning("Suppression du PDF %s impossible", key)
