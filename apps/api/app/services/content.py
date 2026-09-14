"""Lecture des packs de contenu statiques depuis `CONTENT_DIR` (le contenu n'est pas en base, spec §11)."""

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

# Fichiers jamais publiés (sources audio lourdes, ADR 0002).
_EXCLUDED_SUFFIXES = {".wav"}


@dataclass(frozen=True)
class Lesson:
    id: str
    unit: str
    estimated_minutes: float
    prerequisites: tuple[str, ...]


@dataclass(frozen=True)
class Unit:
    id: str
    status: str
    tags: tuple[str, ...]
    lessons: tuple[str, ...]


@dataclass(frozen=True)
class Pack:
    code: str
    version: int
    raw: dict[str, Any]
    directory: Path
    units: tuple[Unit, ...]
    paths: dict[str, tuple[str, ...]]
    lessons: dict[str, Lesson] = field(default_factory=dict)

    def files(self) -> list[str]:
        """Chemins relatifs (POSIX) de tous les fichiers publiables du pack, triés."""
        return sorted(
            p.relative_to(self.directory).as_posix()
            for p in self.directory.rglob("*")
            if p.is_file() and p.suffix.lower() not in _EXCLUDED_SUFFIXES
        )


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_pack(directory: Path) -> Pack:
    raw = _read_json(directory / "pack.json")
    curriculum = _read_json(directory / "curriculum.json")
    units = tuple(
        Unit(
            id=u["id"],
            status=u["status"],
            tags=tuple(u.get("tags", [])),
            lessons=tuple(u["lessons"]),
        )
        for u in curriculum["units"]
    )
    paths = {name: tuple(p.get("boostTags", [])) for name, p in curriculum.get("paths", {}).items()}
    lessons: dict[str, Lesson] = {}
    for lesson_file in sorted((directory / "lessons").rglob("*.json")):
        data = _read_json(lesson_file)
        lessons[data["id"]] = Lesson(
            id=data["id"],
            unit=data["unit"],
            estimated_minutes=data["estimatedMinutes"],
            prerequisites=tuple(data.get("prerequisites", [])),
        )
    return Pack(
        code=raw["code"],
        version=raw["version"],
        raw=raw,
        directory=directory,
        units=units,
        paths=paths,
        lessons=lessons,
    )


@lru_cache
def load_packs(content_dir: Path) -> dict[str, Pack]:
    """Packs présents dans `content_dir` (un sous-dossier contenant `pack.json`), mis en cache."""
    packs: dict[str, Pack] = {}
    if not content_dir.is_dir():
        return packs
    for child in sorted(content_dir.iterdir()):
        if (child / "pack.json").is_file():
            pack = _load_pack(child)
            packs[pack.code] = pack
    return packs


def course_code_of_lesson(lesson_id: str) -> str:
    """Les ids de leçon sont préfixés par le code du pack : `vi-south.u01.l01` → `vi-south`."""
    return lesson_id.split(".", 1)[0]


# --- Lecture détaillée (professeur IA) -----------------------------------------------------


@lru_cache(maxsize=256)
def _lesson_documents(directory: Path) -> dict[str, dict[str, Any]]:
    docs: dict[str, dict[str, Any]] = {}
    for lesson_file in sorted((directory / "lessons").rglob("*.json")):
        data = _read_json(lesson_file)
        docs[data["id"]] = data
    return docs


@lru_cache(maxsize=16)
def _concept_documents(directory: Path) -> dict[str, dict[str, Any]]:
    docs: dict[str, dict[str, Any]] = {}
    concepts_dir = directory / "concepts"
    if concepts_dir.is_dir():
        for concept_file in sorted(concepts_dir.rglob("*.json")):
            data = _read_json(concept_file)
            docs[data["id"]] = data
    return docs


def lesson_document(pack: Pack, lesson_id: str) -> dict[str, Any] | None:
    """JSON complet d'une leçon (titre, objectif, étapes), ou None."""
    return _lesson_documents(pack.directory).get(lesson_id)


def concept_documents(pack: Pack) -> dict[str, dict[str, Any]]:
    """Concepts du pack indexés par id (forme `vi`, glose, note, ton…)."""
    return _concept_documents(pack.directory)


def localized(value: Any, locale: str) -> str | None:
    """Texte localisé `{fr, en}` : langue demandée, sinon français, sinon première valeur."""
    if isinstance(value, str):
        return value
    if not isinstance(value, dict) or not value:
        return None
    for key in (locale, "fr"):
        text = value.get(key)
        if isinstance(text, str) and text:
            return text
    first = next((v for v in value.values() if isinstance(v, str) and v), None)
    return first
