"""Petits packs de contenu synthétiques (écrits en dossier temporaire) pour les règles du contrat parcours."""

import json
from pathlib import Path
from typing import Any

from app.services.content import Pack, _load_pack


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def build_pack(
    root: Path,
    units: list[dict[str, Any]],
    *,
    code: str = "tp",
    paths: dict[str, list[str]] | None = None,
    pack_extra: dict[str, Any] | None = None,
    lesson_prereqs: dict[str, list[str]] | None = None,
) -> Pack:
    """`units` : [{"n": 1, "lessons": 3, "tags": [...], "requires": [...] | absent, "test": True}].

    Leçons `<code>.uNN.lMM` ; la dernière est un test d'unité si `test` (défaut vrai). Par défaut chaque leçon
    requiert la précédente de son unité, et la première requiert le test de l'unité précédente (inter-unités).
    """
    directory = root / code
    write_json(
        directory / "pack.json",
        {"code": code, "lang": "xx", "name": {"fr": "Test", "en": "Test"}, "version": 1, "features": []}
        | (pack_extra or {}),
    )
    curriculum_units = []
    previous_last: str | None = None
    for spec in units:
        unit_id = f"{code}.u{spec['n']:02d}"
        count = spec.get("lessons", 2)
        ids = [f"{unit_id}.l{i + 1:02d}" for i in range(count)]
        entry: dict[str, Any] = {
            "id": unit_id,
            "title": {"fr": unit_id, "en": unit_id},
            "status": spec.get("status", "available"),
            "tags": spec.get("tags", ["core"]),
            "lessons": ids,
        }
        if "requires" in spec:
            entry["requires"] = [f"{code}.u{n:02d}" for n in spec["requires"]]
        curriculum_units.append(entry)
        for i, lesson_id in enumerate(ids):
            is_test = spec.get("test", True) and i == count - 1
            prereqs = [ids[i - 1]] if i > 0 else ([previous_last] if previous_last else [])
            if lesson_prereqs and lesson_id in lesson_prereqs:
                prereqs = lesson_prereqs[lesson_id]
            write_json(
                directory / "lessons" / f"u{spec['n']:02d}" / f"l{i + 1:02d}.json",
                {
                    "id": lesson_id,
                    "unit": unit_id,
                    "kind": "unit_test" if is_test else "lesson",
                    "title": {"fr": lesson_id, "en": lesson_id},
                    "estimatedMinutes": 5,
                    "prerequisites": prereqs,
                    "concepts": [],
                    "steps": [],
                    "review": {"srsIntroduce": []},
                },
            )
        previous_last = ids[-1]
    write_json(
        directory / "curriculum.json",
        {
            "pack": code,
            "blocks": [],
            "units": curriculum_units,
            "paths": {name: {"boostTags": tags} for name, tags in (paths or {}).items()},
        },
    )
    return _load_pack(directory)
