# API Parlo — image de production/compose (contexte de build : apps/api).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

# WeasyPrint (certificats PDF) : Pango/HarfBuzz. Les polices du certificat (Be Vietnam Pro, Source Serif 4)
# sont embarquées dans app/assets/fonts ; fonts-noto-core sert de repli pour tout glyphe manquant.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fontconfig fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    CONTENT_DIR=/content \
    MEDIA_DIR=/data/media \
    PDF_RENDERER=weasyprint

WORKDIR /app

# Dépendances d'abord (couche mise en cache tant que le lockfile ne change pas).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN useradd --create-home --uid 10001 parlo \
    && mkdir -p /data/media && chown -R parlo /data
USER parlo

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
