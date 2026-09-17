"""`/content/{code}/…` : contenu servi par l'API (développement, ou sans CDN) — contrat parcours §1 et §6.

Contrairement à un montage statique figé au démarrage, ces routes lisent la version **publiée courante** :
après une publication du studio, `latest.json`, `core.json`, les unités et `bundle.json` reflètent la nouvelle
version dans tous les workers. Mêmes fichiers que le plugin Vite (`apps/web/vite-plugin-content.ts`) :
- `latest.json` : `{code, version}` ;
- `v{version}/core.json` : hub et planification (index des leçons et concepts, examens, placement, jeux, tailles) ;
- `v{version}/units/{unitId}.json` : leçons complètes d'une unité (à la demande, hors ligne explicite) ;
- `v{version}/bundle.json` : tout le JSON du pack (anciens clients, gardé une version) ;
- `v{version}/<chemin>` : fichiers du pack (médias).
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse

from app.deps import PacksDep, SettingsDep
from app.services.content import Pack
from app.services.content_split import build_bundle, pack_split

__all__ = ["build_bundle", "router"]

router = APIRouter(prefix="/content", tags=["content"], include_in_schema=False)

_NO_CACHE = {"Cache-Control": "no-cache"}


def _pack(packs: dict[str, Pack], code: str) -> Pack:
    pack = packs.get(code)
    if pack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="unknown_course")
    return pack


def _current(packs: dict[str, Pack], code: str, version: int) -> Pack:
    pack = _pack(packs, code)
    if version != pack.version:
        # Une version périmée n'est plus construite : le client relit latest.json.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="stale_version")
    return pack


@router.get("/{code}/latest.json")
def latest(code: str, packs: PacksDep) -> JSONResponse:
    pack = _pack(packs, code)
    return JSONResponse({"code": pack.code, "version": pack.version}, headers=_NO_CACHE)


@router.get("/{code}/v{version}/bundle.json")
def bundle(code: str, version: int, packs: PacksDep, settings: SettingsDep) -> JSONResponse:
    pack = _current(packs, code, version)
    return JSONResponse(build_bundle(pack, settings), headers=_NO_CACHE)


@router.get("/{code}/v{version}/core.json")
def core(code: str, version: int, packs: PacksDep, settings: SettingsDep) -> JSONResponse:
    pack = _current(packs, code, version)
    return JSONResponse(pack_split(pack, settings)[0], headers=_NO_CACHE)


@router.get("/{code}/v{version}/units/{unit_id}.json")
def unit(code: str, version: int, unit_id: str, packs: PacksDep, settings: SettingsDep) -> JSONResponse:
    pack = _current(packs, code, version)
    found = pack_split(pack, settings)[1].get(unit_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="unknown_unit")
    return JSONResponse(found, headers=_NO_CACHE)


@router.get("/{code}/v{version}/{path:path}")
def pack_file(code: str, version: int, path: str, packs: PacksDep) -> FileResponse:
    pack = _pack(packs, code)
    root = pack.directory.resolve()
    target = (root / path).resolve()
    parts = Path(path).parts
    if (
        not target.is_relative_to(root)
        or not target.is_file()
        or not parts
        or parts[0].startswith("_")
        or target.suffix.lower() == ".wav"
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    return FileResponse(target)
