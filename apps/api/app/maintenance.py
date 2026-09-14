"""Tâches de maintenance à planifier (cron, tâche planifiée du conteneur…).

uv run python -m app.maintenance purge-tutor     # quotidien : tutor_messages > TUTOR_RETENTION_DAYS, cache expiré
"""

import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.services.tutor import purge_tutor_data


def main(argv: list[str]) -> int:
    if argv[1:] != ["purge-tutor"]:
        print(__doc__)
        return 2
    settings = get_settings()
    engine = make_engine(settings.database_url)
    try:
        with make_session_factory(engine)() as db:
            messages, cache = purge_tutor_data(db, retention_days=settings.tutor_retention_days)
    finally:
        engine.dispose()
    print(f"tutor_messages supprimés : {messages} ; entrées de cache expirées supprimées : {cache}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
