"""Rappels Web Push (spec §5.8, contrat Phase 2 §4).

Un rappel par **utilisateur** et par jour au plus (contrat parcours §4), à `reminderHour` dans le fuseau du
**profil** (à défaut ceux de l'abonnement), seulement si aucune séance n'est terminée ce jour local. Envoyé à
l'abonnement le plus récent (le suivant si celui-ci a expiré). Textes dans la voix du professeur du pack, jamais
culpabilisants (voir FORBIDDEN_PHRASES, vérifié par les tests). Abonnements expirés (404/410) supprimés.
Un endpoint déjà associé à un autre utilisateur n'est jamais réattribué.
"""

import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Profile, PushSubscription, StudySession, User
from app.services import learner
from app.services.content import Pack

logger = logging.getLogger(__name__)

# Gabarits : {streak} = série en cours (jours). Voix de Cô Mai, tutoiement, invitation concrète.
TEMPLATES: dict[str, dict[str, list[str]]] = {
    "fr": {
        "plain": [
            "6 minutes, et tu sais commander un café ce soir.",
            "{teacher} a préparé ta séance du jour. On s'y met quand tu veux ?",
            "Quelques minutes d'oreille tonale, et le Sud se rapproche.",
            "Ta séance t'attend, courte et douce : cinq minutes suffisent.",
        ],
        "streak": [
            "Ta série de {streak} jours t'attend.",
            "{streak} jours de suite : on ajoute une petite séance aujourd'hui ?",
        ],
    },
    "en": {
        "plain": [
            "6 minutes, and you can order a coffee tonight.",
            "{teacher} has your session ready. Whenever you like?",
            "A few minutes of tone training, and the South gets closer.",
            "Your session is waiting, short and sweet: five minutes is enough.",
        ],
        "streak": [
            "Your {streak}-day streak is waiting for you.",
            "{streak} days in a row: a small session today?",
        ],
    },
}
DEFAULT_TITLE = "Parlo"

# Formulations interdites (§5.8) : culpabilisation, tristesse, compte à rebours anxiogène.
FORBIDDEN_PHRASES = (
    "tu nous manques",
    "tu me manques",
    "we miss you",
    "miss you",
    "dernière chance",
    "last chance",
    "trop tard",
    "too late",
    "tu vas perdre",
    "perdre ta série",
    "lose your streak",
    "don't break",
    "ne casse pas",
    "plus que",
    "only",
    "hours left",
    "heures restantes",
    "déçu",
    "disappointed",
    "abandonn",
    "give up",
    "😢",
    "😞",
    "😭",
    "☹",
    "🙁",
    "💔",
    "⏰",
    "⌛",
    "⏳",
)


@dataclass(frozen=True)
class PushPayload:
    title: str
    body: str
    url: str = "/"

    def to_json(self) -> str:
        return json.dumps({"title": self.title, "body": self.body, "url": self.url}, ensure_ascii=False)


def reminder_payload(
    locale: str, streak: int, local_day: date, user_id: str, teacher: str | None = "Cô Mai"
) -> PushPayload:
    lang = locale if locale in TEMPLATES else "fr"
    pool = TEMPLATES[lang]["streak"] if streak >= 2 else TEMPLATES[lang]["plain"]
    if teacher is None:  # pack sans persona : pas de gabarit parlant au nom d'un professeur
        pool = [t for t in pool if "{teacher}" not in t]
    # Choix stable pour un utilisateur et un jour (pas d'aléa : testable, pas de doublon au rejeu).
    digest = hashlib.sha256(f"{user_id}:{local_day.isoformat()}".encode()).digest()
    body = pool[digest[0] % len(pool)].format(streak=streak, teacher=teacher or "")
    return PushPayload(title=teacher or DEFAULT_TITLE, body=body)


def valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


# Envoi : (abonnement, payload JSON) → code HTTP en cas d'échec, None si envoyé.
Sender = Callable[[PushSubscription, str], int | None]


def webpush_sender(settings: Settings) -> Sender:
    def send(subscription: PushSubscription, data: str) -> int | None:
        from pywebpush import WebPushException, webpush

        try:
            webpush(
                subscription_info={"endpoint": subscription.endpoint, "keys": subscription.keys_json},
                data=data,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
                ttl=12 * 3600,
            )
        except WebPushException as exc:
            status_code: int = getattr(exc.response, "status_code", 0) or 0
            return status_code or 500
        return None

    return send


@dataclass
class ReminderReport:
    sent: int = 0
    skipped: int = 0
    deleted: int = 0
    failed: int = 0


def _has_session_on(db: Session, user_id: str, day: date) -> bool:
    return (
        db.scalar(
            select(StudySession.id)
            .where(StudySession.user_id == user_id, StudySession.local_date == day, StudySession.ended_at.is_not(None))
            .limit(1)
        )
        is not None
    )


def send_due_reminders(
    db: Session, sender: Sender, now: datetime | None = None, packs: dict[str, Pack] | None = None
) -> ReminderReport:
    now = now or datetime.now(UTC)
    report = ReminderReport()
    rows = db.execute(
        select(PushSubscription, User, Profile)
        .join(User, User.id == PushSubscription.user_id)
        .join(Profile, Profile.user_id == PushSubscription.user_id)
        .where(Profile.notifications_enabled.is_(True))
        .order_by(PushSubscription.user_id, PushSubscription.created_at.desc(), PushSubscription.id)
    ).all()
    by_user: dict[str, tuple[User, Profile, list[PushSubscription]]] = {}
    for subscription, user, profile in rows:
        by_user.setdefault(user.id, (user, profile, []))[2].append(subscription)

    for user, profile, subscriptions in by_user.values():
        latest = subscriptions[0]
        hour = profile.reminder_hour if profile.reminder_hour is not None else latest.reminder_hour
        tz_name = profile.timezone or latest.timezone or "UTC"
        try:
            local = now.astimezone(ZoneInfo(tz_name))
        except (ZoneInfoNotFoundError, ValueError):
            report.skipped += len(subscriptions)
            continue
        today = local.date()
        if hour is None or local.hour != hour or profile.last_reminded_on == today:
            report.skipped += len(subscriptions)
            continue
        if _has_session_on(db, user.id, today):
            report.skipped += len(subscriptions)
            continue
        enrollment = learner.primary_enrollment(db, user.id)
        pack = (packs or {}).get(enrollment.course_id) if enrollment else None
        teacher = pack.tutor["name"] if pack is not None and pack.tutor else ("Cô Mai" if packs is None else None)
        payload = reminder_payload(
            user.locale, learner.displayed_streak(db, user.id, today), today, user.id, teacher
        ).to_json()
        for subscription in subscriptions:  # du plus récent au plus ancien, jusqu'au premier envoi réussi
            status_code = sender(subscription, payload)
            if status_code is None:
                subscription.last_notified_on = today
                profile.last_reminded_on = today
                report.sent += 1
                break
            if status_code in (404, 410):
                db.delete(subscription)
                report.deleted += 1
                continue
            logger.warning("Push refusé (%s) pour l'abonnement %s", status_code, subscription.id)
            report.failed += 1
            break
    db.commit()
    return report


class SubscriptionOwnershipError(Exception):
    """Endpoint déjà associé à un autre utilisateur."""


def upsert_subscription(
    db: Session, user: User, endpoint: str, keys: dict[str, Any], reminder_hour: int, timezone: str
) -> PushSubscription:
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if row is not None and row.user_id != user.id:
        # Jamais de réattribution : l'autre compte doit d'abord se désabonner (déconnexion côté client).
        raise SubscriptionOwnershipError(endpoint)
    if row is None:
        row = PushSubscription(user_id=user.id, endpoint=endpoint, keys_json=keys)
        db.add(row)
    row.keys_json = keys
    row.reminder_hour = reminder_hour
    row.timezone = timezone
    return row
