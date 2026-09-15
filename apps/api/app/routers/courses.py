"""`/courses` : packs disponibles et manifeste de contenu versionné."""

from fastapi import APIRouter, HTTPException, status

from app.config import Settings
from app.deps import PacksDep, SettingsDep
from app.schemas.me import CourseOut, ManifestOut
from app.services.content import Pack
from app.services.media import media_index

router = APIRouter(prefix="/courses", tags=["courses"])


def content_base_url(settings: Settings, pack: Pack) -> str:
    return settings.content_base_url.format(code=pack.code, version=pack.version)


@router.get("", response_model=list[CourseOut])
def list_courses(packs: PacksDep) -> list[CourseOut]:
    return [
        CourseOut(
            code=p.code,
            lang=p.raw["lang"],
            variant=p.raw.get("variant"),
            name=p.raw["name"],
            version=p.version,
            features=p.raw.get("features", []),
            interface_locales=p.raw.get("interfaceLocales", []),
            coming_soon=p.raw.get("comingSoon", False),
        )
        for p in packs.values()
    ]


@router.get("/{code}/manifest", response_model=ManifestOut)
def manifest(code: str, packs: PacksDep, settings: SettingsDep) -> ManifestOut:
    pack = packs.get(code)
    if pack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Cours inconnu : {code}")
    return ManifestOut(
        code=pack.code,
        version=pack.version,
        base_url=content_base_url(settings, pack),
        files=pack.files(),
        media_index=sorted(media_index(pack, settings.studio_media_dir)),
        coming_soon=pack.coming_soon,
    )
