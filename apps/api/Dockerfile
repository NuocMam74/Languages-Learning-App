# API Parlo — image de production/compose (contexte de build : apps/api).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

# Node 24 (studio, contrat Phase 4 §1) : l'API lance le validateur de la CI
# `npx tsx scripts/validate-content.ts --root <copie> --json` depuis STUDIO_VALIDATOR_CWD (dépôt monté + node_modules).
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# ffmpeg (studio : loudnorm, libopus, AAC, rubberband).
# WeasyPrint (certificats PDF) : Pango/HarfBuzz. Les polices du certificat (Be Vietnam Pro, Source Serif 4)
# sont embarquées dans app/assets/fonts ; fonts-noto-core sert de repli pour tout glyphe manquant.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fontconfig fonts-noto-core \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    CONTENT_DIR=/content \
    MEDIA_DIR=/data/media \
    STUDIO_MEDIA_DIR=/data/studio-media \
    STUDIO_VALIDATOR_CWD=/repo \
    PDF_RENDERER=weasyprint

WORKDIR /app

# Dépendances d'abord (couche mise en cache tant que le lockfile ne change pas).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN useradd --create-home --uid 10001 parlo \
    && mkdir -p /data/media /data/studio-media && chown -R parlo /data
USER parlo

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
