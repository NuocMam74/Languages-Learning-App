"""Point d'entrée FastAPI : `uvicorn app.main:app`."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.routers import admin, auth, challenges, classes, courses, exams, leagues, me, push, social, studio, tutor
from app.services.content import load_packs
from app.services.pdf import make_renderer
from app.services.rate_limit import InMemorySlidingWindow
from app.services.storage import make_storage
from app.services.studio import make_validator
from app.services.tutor_llm import AnthropicTutorLLM, TutorLLM


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        scheduler = None
        if settings.scheduler_enabled:
            from app.scheduler import start_scheduler

            scheduler = start_scheduler(settings, app.state.session_factory)
        try:
            yield
        finally:
            if scheduler is not None:
                scheduler.shutdown(wait=False)

    app = FastAPI(title="Parlo API", version="0.4.0", root_path=settings.normalized_root_path, lifespan=lifespan)

    engine = make_engine(settings.database_url)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.state.auth_rate_limiter = InMemorySlidingWindow(settings.auth_rate_limit, settings.auth_rate_window_seconds)
    app.state.tutor_rate_limiter = InMemorySlidingWindow(settings.tutor_rate_limit, settings.tutor_rate_window_seconds)
    # Sans clé : pas de client, les endpoints /tutor/* servent les messages préécrits.
    tutor_llm: TutorLLM | None = None
    if settings.anthropic_api_key:
        tutor_llm = AnthropicTutorLLM(settings.anthropic_api_key, settings.tutor_model, settings.tutor_timeout_seconds)
    app.state.tutor_llm = tutor_llm
    app.state.pdf_renderer = make_renderer(settings.pdf_renderer)
    app.state.storage = make_storage(settings)
    # Validateur de contenu du studio (remplaçable en test).
    app.state.content_validator = make_validator(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,  # cookie de refresh
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(courses.router)
    app.include_router(tutor.router)
    app.include_router(exams.router)
    app.include_router(social.router)
    app.include_router(challenges.router)
    app.include_router(leagues.router)
    app.include_router(push.router)
    app.include_router(admin.router)
    app.include_router(studio.router)
    app.include_router(classes.router)

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
