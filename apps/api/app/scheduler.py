"""Tâches planifiées (APScheduler), démarrées avec l'application si `SCHEDULER_ENABLED=true`.

- lundi 00:00 UTC : défi de la semaine, passage de semaine des ligues ;
- toutes les heures (minute 0) : rappels push ;
- chaque jour 03:30 UTC : purge des données de Cô Mai de plus de TUTOR_RETENTION_DAYS jours (90 par défaut)
  et des entrées de cache expirées.
Un seul processus doit activer le planificateur (sinon rappels en double) : en production, un conteneur
dédié ou un seul worker uvicorn avec `SCHEDULER_ENABLED=true`.
"""

import logging
from datetime import UTC, datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.services import challenges, leagues, push, tutor
from app.services.content import load_packs

logger = logging.getLogger(__name__)


def generate_weekly_challenge(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as db:
        challenge = challenges.ensure_week_challenge(db, datetime.now(UTC))
        db.commit()
        logger.info("Défi de la semaine : %s (%s)", challenge.kind, challenge.id)


def rollover_leagues(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as db:
        placed = leagues.rollover(db, datetime.now(UTC))
        db.commit()
        logger.info("Ligues : %d membre(s) placé(s)", placed)


def send_push_reminders(session_factory: sessionmaker[Session], settings: Settings) -> None:
    if not settings.vapid_private_key:
        return
    with session_factory() as db:
        report = push.send_due_reminders(db, push.webpush_sender(settings), packs=load_packs(settings.content_dir))
        logger.info("Rappels push : %s", report)


def purge_tutor(session_factory: sessionmaker[Session], settings: Settings) -> None:
    with session_factory() as db:
        messages, cache = tutor.purge_tutor_data(db, retention_days=settings.tutor_retention_days)
        logger.info("Purge Cô Mai : %d message(s), %d entrée(s) de cache", messages, cache)


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
        rollover_leagues,
        CronTrigger(day_of_week="mon", hour=0, minute=0, timezone=UTC),
        args=[session_factory],
        id="leagues_rollover",
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
    scheduler.add_job(
        purge_tutor,
        CronTrigger(hour=3, minute=30, timezone=UTC),
        args=[session_factory, settings],
        id="tutor_purge",
        misfire_grace_time=6 * 3600,
        coalesce=True,
    )
    scheduler.start()
    return scheduler
