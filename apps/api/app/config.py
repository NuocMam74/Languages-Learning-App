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

    # Préfixe sous lequel un proxy expose l'API (ex. « /api ») : FastAPI `root_path` et chemin du cookie.
    root_path: str = ""

    # Professeur IA (Cô Mai). Sans clé, les endpoints /tutor/* répondent avec des messages préécrits.
    anthropic_api_key: str | None = None
    tutor_model: str = "claude-sonnet-4-6"
    # Appels au modèle par utilisateur et par jour UTC (une régénération « garde du Sud » compte).
    tutor_daily_quota: int = 30
    # Requêtes /tutor/* par utilisateur sur la fenêtre glissante.
    tutor_rate_limit: int = 10
    tutor_rate_window_seconds: int = 60
    tutor_timeout_seconds: float = 15.0
    tutor_retention_days: int = 90

    # --- Phase 2 ---------------------------------------------------------------------------
    # URL publique de la PWA : lien de vérification imprimé sur les certificats ({PUBLIC_WEB_URL}/verifier/{code}).
    public_web_url: str = "http://localhost:5173"
    # Stockage des certificats PDF : « local » (MEDIA_DIR) ou « s3 » (compatible S3, boto3).
    storage_backend: str = "local"
    media_dir: Path = API_DIR / "media"
    s3_bucket: str | None = None
    s3_prefix: str = "certificates/"
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    # Rendu PDF : « auto » (WeasyPrint si ses bibliothèques système sont présentes, sinon fpdf2),
    # « weasyprint » ou « fpdf2 ».
    pdf_renderer: str = "auto"
    # Tâches planifiées (défi de la semaine le lundi 00:00 UTC, rappels push horaires).
    # Un seul processus doit les activer.
    scheduler_enabled: bool = False
    # Web Push (VAPID) : `uv run python -m app.maintenance vapid-keys` pour générer une paire.
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:contact@parlo.app"

    # --- Phase 4 : studio de contenu -----------------------------------------------------------
    # Publication (écriture des fichiers dans CONTENT_DIR) : désactivée par défaut, à n'activer que sur une
    # instance qui travaille sur un dépôt (l'équipe relit le diff et committe).
    studio_publish_enabled: bool = False
    # Médias produits par le studio (audio traité, courbes F0) avant publication : <dir>/<pack>/audio|pitch.
    studio_media_dir: Path = API_DIR / "studio-media"
    # Validateur de la CI + garde du Sud, lancé depuis STUDIO_VALIDATOR_CWD ; `--root <dir> --json` est ajouté.
    studio_validator_cmd: str = "npx tsx scripts/validate-content.ts --with-south-lint"
    studio_validator_cwd: Path = REPO_ROOT
    studio_validator_timeout_seconds: float = 180.0
    # Taille maximale d'un enregistrement téléversé (octets).
    studio_audio_max_bytes: int = 20 * 1024 * 1024

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def normalized_root_path(self) -> str:
        """`/api` (sans barre finale) ou chaîne vide."""
        path = self.root_path.strip().rstrip("/")
        return f"/{path.lstrip('/')}" if path else ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
