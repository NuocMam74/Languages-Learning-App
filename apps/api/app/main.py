"""Point d'entrée FastAPI : `uvicorn app.main:app`."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.routers import auth, courses, me
from app.services.content import load_packs
from app.services.rate_limit import InMemorySlidingWindow


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Parlo API", version="0.1.0")

    engine = make_engine(settings.database_url)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.state.auth_rate_limiter = InMemorySlidingWindow(settings.auth_rate_limit, settings.auth_rate_window_seconds)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,  # cookie de refresh
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(courses.router)

    @app.get("/healthz", tags=["ops"])
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    if settings.serve_content:
        # Développement : sert le contenu aux URLs du manifeste (en prod : CDN).
        for pack in load_packs(settings.content_dir).values():
            app.mount(
                f"/content/{pack.code}/v{pack.version}",
                StaticFiles(directory=pack.directory),
                name=f"content-{pack.code}",
            )

    return app


app = create_app()
