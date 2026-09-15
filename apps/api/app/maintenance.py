"""Tâches de maintenance à planifier (cron, tâche planifiée du conteneur…).

uv run python -m app.maintenance purge-tutor     # quotidien : tutor_messages > TUTOR_RETENTION_DAYS, cache expiré
uv run python -m app.maintenance vapid-keys      # une fois : paire de clés VAPID pour Web Push (à mettre dans .env)
uv run python -m app.maintenance push-reminders  # sans planificateur intégré : à lancer toutes les heures
uv run python -m app.maintenance weekly-challenge  # sans planificateur intégré : chaque lundi 00:00 UTC
uv run python -m app.maintenance leagues-rollover  # sans planificateur intégré : lundi 00:00 UTC (idempotent)
uv run python -m app.maintenance grant-role <email> <role>   # reviewer | editor | teacher | admin
uv run python -m app.maintenance revoke-role <email> <role>
"""

import base64
import sys
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import get_settings
from app.db import make_engine, make_session_factory


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def vapid_keys() -> tuple[str, str]:
    """(clé publique, clé privée) au format base64url attendu par le navigateur et pywebpush."""
    private = ec.generate_private_key(ec.SECP256R1())
    public = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64url(public), _b64url(private.private_numbers().private_value.to_bytes(32, "big"))


def change_role(session_factory: Any, email: str, role: str, grant: bool) -> str:
    """Ajoute ou retire un rôle ; renvoie un message. Lève ValueError (email ou rôle inconnu)."""
    from sqlalchemy import select

    from app.deps import GRANTABLE_ROLES
    from app.models import User

    if role not in GRANTABLE_ROLES:
        raise ValueError(f"Rôle inconnu : {role} (attendu : {', '.join(GRANTABLE_ROLES)})")
    with session_factory() as db:
        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            raise ValueError(f"Aucun compte avec l'email {email}")
        roles = set(user.roles or [])
        if grant:
            roles.add(role)
        else:
            roles.discard(role)
        user.roles = [r for r in GRANTABLE_ROLES if r in roles]
        db.commit()
        return f"{user.email} : rôles = {', '.join(['learner', *user.roles])}"


def main(argv: list[str]) -> int:
    command = argv[1:]
    if len(command) == 3 and command[0] in ("grant-role", "revoke-role"):
        settings = get_settings()
        engine = make_engine(settings.database_url)
        try:
            print(change_role(make_session_factory(engine), command[1], command[2], command[0] == "grant-role"))
        except ValueError as exc:
            print(exc)
            return 1
        finally:
            engine.dispose()
        return 0
    if command == ["vapid-keys"]:
        public, private = vapid_keys()
        print(f"VAPID_PUBLIC_KEY={public}")
        print(f"VAPID_PRIVATE_KEY={private}")
        return 0
    if command not in (["purge-tutor"], ["push-reminders"], ["weekly-challenge"], ["leagues-rollover"]):
        print(__doc__)
        return 2
    settings = get_settings()
    engine = make_engine(settings.database_url)
    try:
        session_factory = make_session_factory(engine)
        if command == ["purge-tutor"]:
            from app.services.tutor import purge_tutor_data

            with session_factory() as db:
                messages, cache = purge_tutor_data(db, retention_days=settings.tutor_retention_days)
            print(f"tutor_messages supprimés : {messages} ; entrées de cache expirées supprimées : {cache}")
        elif command == ["push-reminders"]:
            from app.scheduler import send_push_reminders

            send_push_reminders(session_factory, settings)
        elif command == ["leagues-rollover"]:
            from app.scheduler import rollover_leagues

            rollover_leagues(session_factory)
        else:
            from app.scheduler import generate_weekly_challenge

            generate_weekly_challenge(session_factory)
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
