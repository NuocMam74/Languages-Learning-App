"""Tâches planifiées (APScheduler), démarrées avec l'application si `SCHEDULER_ENABLED=true`.

- lundi 00:00 UTC : défi de la semaine ;
- toutes les heures (minute 0) : rappels push.
Un seul processus doit activer le planificateur (sinon rappels en double) : en production, un conteneur
dédié ou un seul worker uvicorn avec `SCHEDULER_ENABLED=true`.
"""

import logging
from datetime import UTC, datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.services import challenges, push

logger = logging.getLogger(__name__)


def generate_weekly_challenge(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as db:
        challenge = challenges.ensure_week_challenge(db, datetime.now(UTC))
        db.commit()
        logger.info("Défi de la semaine : %s (%s)", challenge.kind, challenge.id)


def send_push_reminders(session_factory: sessionmaker[Session], settings: Settings) -> None:
    if not settings.vapid_private_key:
        return
    with session_factory() as db:
        report = push.send_due_reminders(db, push.webpush_sender(settings))
        logger.info("Rappels push : %s", report)


def start_scheduler(settings: Settings, session_factory: sessionmaker[Session]) -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=UTC)
    scheduler.add_job(
        generate_weekly_challenge,
        CronTrigger(day_of_week="mon", hour=0, minute=0, timezone=UTC),
        args=[session_factory],
        id="weekly_challenge",
        misfire_grace_time=3600,
        coalesce=True,
    )
    scheduler.add_job(
        send_push_reminders,
        CronTrigger(minute=0, timezone=UTC),
        args=[session_factory, settings],
        id="push_reminders",
        misfire_grace_time=900,
        coalesce=True,
    )
    scheduler.start()
    return scheduler
