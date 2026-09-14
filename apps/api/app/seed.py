"""Données de démonstration : `uv run python -m app.seed` (après `alembic upgrade head`).

Crée l'utilisateur demo@parlo.local / parlo-demo-2026, avec profil et inscription à vi-south.
Idempotent : ne fait rien si l'utilisateur existe déjà.
"""

from sqlalchemy import select

from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.models import Profile, User
from app.services.auth import hash_password
from app.services.content import load_packs
from app.services.learner import create_learner

DEMO_EMAIL = "demo@parlo.local"
DEMO_PASSWORD = "parlo-demo-2026"


def seed(settings: Settings | None = None) -> bool:
    """Retourne True si l'utilisateur de démonstration a été créé."""
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)
    try:
        with make_session_factory(engine)() as db:
            if db.scalar(select(User.id).where(User.email == DEMO_EMAIL)) is not None:
                return False
            user = User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
                display_name="Démo",
                locale="fr",
                is_guest=False,
            )
            db.add(user)
            db.flush()
            create_learner(db, user, load_packs(settings.content_dir).get(settings.default_course))
            db.flush()
            profile = db.get(Profile, user.id)
            if profile is not None:
                profile.motivation = "travel"
                profile.daily_goal_min = 10
                profile.reminder_hour = 19
            db.commit()
            return True
    finally:
        engine.dispose()


if __name__ == "__main__":
    created = seed()
    print(f"{DEMO_EMAIL} / {DEMO_PASSWORD} : {'créé' if created else 'existe déjà'}")
