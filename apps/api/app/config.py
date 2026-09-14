"""Configuration de l'API, lue depuis l'environnement (et `.env` s'il existe)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", API_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = f"sqlite:///{(API_DIR / 'parlo.db').as_posix()}"

    # Secret de signature des JWT : à fournir impérativement hors développement.
    jwt_secret: str = "dev-insecure-change-me-dev-insecure-change-me"  # noqa: S105  (dev uniquement)
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_days: int = 30
    refresh_cookie_name: str = "parlo_refresh"
    # Désactivable uniquement pour un développement local en http sans proxy.
    cookie_secure: bool = True

    # Nombre de requêtes autorisées par IP et par route /auth/* sur la fenêtre glissante.
    auth_rate_limit: int = 20
    auth_rate_window_seconds: int = 60

    content_dir: Path = REPO_ROOT / "content"
    # Gabarit d'URL du contenu ; {code} et {version} sont substitués.
    content_base_url: str = "/content/{code}/v{version}/"
    # Monte le dossier de contenu en fichiers statiques (développement).
    serve_content: bool = True
    default_course: str = "vi-south"

    # Liste séparée par des virgules.
    cors_origins: str = "http://localhost:5173"

    # Professeur IA (Phase 1) : lus ici pour que la configuration soit complète dès maintenant.
    anthropic_api_key: str | None = None
    tutor_model: str = "claude-sonnet-4-6"
    tutor_daily_quota: int = 30

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
