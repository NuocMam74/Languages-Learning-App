"""Livraison du contenu en deux temps (audit mobile P1 #6) — miroir de `packages/core/src/content-split.ts`.

- `core.json` : pack, cursus, index des leçons (sans étapes), index compact des concepts, variantes, index des
  médias, examens, placement, jeux et tailles des unités ;
- `units/<unitId>.json` : leçons complètes, concepts introduits dans l'unité, cartes culture citées.

Même découpage, même ordre des clés et mêmes tailles (octets UTF-8 du JSON compact) que le plugin Vite :
fixture de parité `tests/fixtures/content_split_parity.json` (générée par `generate_content_split_fixture.ts`).
"""

import json
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from app.config import Settings
from app.services.content import Pack, concept_documents, lesson_documents
from app.services.media import media_index

SPLIT_FORMAT = 2


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_files(directory: Path) -> list[Any]:
    if not directory.is_dir():
        return []
    return [_read_json(p) for p in sorted(directory.rglob("*.json"))]


def build_bundle(pack: Pack, settings: Settings) -> dict[str, Any]:
    """Même forme que `readPackBundle` (scripts/lib/load-pack.ts) : fichiers + examens, placement, jeux, médias."""
    root = pack.directory
    bundle: dict[str, Any] = {
        "pack": _read_json(root / "pack.json"),
        "curriculum": _read_json(root / "curriculum.json"),
        "lessons": list(lesson_documents(pack).values()),
        "concepts": list(concept_documents(pack).values()),
        "culture": _json_files(root / "culture"),
    }
    if (root / "lexical-variants.json").is_file():
        bundle["variants"] = _read_json(root / "lexical-variants.json")
    bundle["mediaIndex"] = sorted(media_index(pack, settings.studio_media_dir))
    bundle["exams"] = _json_files(root / "exams")
    bundle["placement"] = _read_json(root / "placement.json") if (root / "placement.json").is_file() else None
    games_dir = root / "games"
    bundle["games"] = {p.stem: _read_json(p) for p in sorted(games_dir.glob("*.json"))} if games_dir.is_dir() else {}
    return bundle


def _dumps(value: Any) -> str:
    """JSON compact identique à `JSON.stringify` (ordre des clés conservé, pas d'échappement non ASCII)."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def utf8_bytes(value: Any) -> int:
    return len(_dumps(value).encode("utf-8"))


def _lesson_order(curriculum: dict[str, Any], lessons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {lesson["id"]: lesson for lesson in lessons}
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for unit in curriculum.get("units", []):
        for lesson_id in unit.get("lessons", []):
            lesson = by_id.get(lesson_id)
            if lesson is not None and lesson_id not in seen:
                seen.add(lesson_id)
                out.append(lesson)
    out.extend(lesson for lesson in lessons if lesson["id"] not in seen)
    return out


def lesson_concept_refs(lesson: dict[str, Any]) -> list[str]:
    """Ids de concepts cités par une leçon (concepts, révision, étapes), dans l'ordre — comme `lessonConceptRefs`."""
    ids: list[str] = [*lesson.get("concepts", []), *lesson.get("review", {}).get("srsIntroduce", [])]
    for step in lesson.get("steps", []):
        kind = step.get("type")
        if kind == "listen_pick_image":
            ids.append(step["concept"])
            ids.extend(step.get("distractors", []))
        elif kind in ("listen_pick_text", "listen_transcribe", "tone_identify", "tone_produce", "speak_repeat"):
            ids.append(step["concept"])
        elif kind == "speak_answer":
            ids.extend(step.get("accepted", []))
        elif kind == "speak_roleplay":
            ids.extend(prompt["concept"] for prompt in step.get("prompts", []))
        elif kind == "tone_minimal_pair":
            ids.extend(step.get("audioConcepts") or [])
        elif kind == "match_pairs":
            ids.extend(step.get("concepts", []))
        elif kind == "build_sentence":
            if step.get("audioConcept"):
                ids.append(step["audioConcept"])
        elif kind == "game":
            if isinstance(step.get("conceptPool"), list):
                ids.extend(step["conceptPool"])
    return ids


def _concept_media(concept: dict[str, Any]) -> list[str]:
    paths = [track["src"] for track in concept.get("audio", [])]
    if concept.get("pitch"):
        paths.append(concept["pitch"])
    if concept.get("image"):
        paths.append(concept["image"])
    paths.extend(example["audio"] for example in concept.get("examples") or [] if example.get("audio"))
    return paths


def _summarize_lesson(lesson: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"id": lesson["id"], "unit": lesson["unit"]}
    if lesson.get("kind"):
        out["kind"] = lesson["kind"]
    out["title"] = lesson["title"]
    out["estimatedMinutes"] = lesson["estimatedMinutes"]
    out["prerequisites"] = lesson["prerequisites"]
    out["concepts"] = lesson["concepts"]
    introduce = lesson["review"]["srsIntroduce"]
    if introduce != lesson["concepts"]:
        out["srsIntroduce"] = introduce
    return out


def _summarize_concept(concept: dict[str, Any], unit: str | None) -> dict[str, Any]:
    out: dict[str, Any] = {"id": concept["id"], "type": concept["type"], "vi": concept["vi"]}
    if concept.get("tone"):
        out["tone"] = concept["tone"]
    out["gloss"] = concept["gloss"]
    out["audio"] = concept["audio"]
    if concept.get("image"):
        out["image"] = concept["image"]
    if concept.get("pitch"):
        out["pitch"] = concept["pitch"]
    if unit:
        out["unit"] = unit
    return out


def split_pack(
    raw: dict[str, Any], media_size: Callable[[str], int] | None = None
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Découpe un bundle en (core, unités) — mêmes règles que `splitPack` côté TypeScript."""
    size = media_size or (lambda _path: 0)
    media_list = list(raw.get("mediaIndex") or [])
    present = set(media_list)
    concepts: list[dict[str, Any]] = raw.get("concepts", [])
    culture: list[dict[str, Any]] = raw.get("culture", [])
    concept_by_id = {c["id"]: c for c in concepts}
    culture_by_id = {c["id"]: c for c in culture}
    ordered = _lesson_order(raw["curriculum"], raw.get("lessons", []))

    unit_ids: list[str] = []
    for lesson in ordered:
        if lesson["unit"] not in unit_ids:
            unit_ids.append(lesson["unit"])

    concept_unit: dict[str, str] = {}
    culture_units: dict[str, list[str]] = {}
    for lesson in ordered:
        for concept_id in lesson_concept_refs(lesson):
            if concept_id in concept_by_id and concept_id not in concept_unit:
                concept_unit[concept_id] = lesson["unit"]
        for step in lesson.get("steps", []):
            if step.get("type") != "culture_card" or step.get("ref") not in culture_by_id:
                continue
            holders = culture_units.setdefault(step["ref"], [])
            if lesson["unit"] not in holders:
                holders.append(lesson["unit"])
    if unit_ids:
        last = unit_ids[-1]
        for concept in concepts:
            concept_unit.setdefault(concept["id"], last)
        for card in culture:
            culture_units.setdefault(card["id"], [last])

    units: list[dict[str, Any]] = []
    for unit in unit_ids:
        lessons = [lesson for lesson in ordered if lesson["unit"] == unit]
        media: set[str] = set()
        for lesson in lessons:
            for concept_id in lesson_concept_refs(lesson):
                concept = concept_by_id.get(concept_id)
                if concept is not None:
                    media.update(_concept_media(concept))
            for step in lesson.get("steps", []):
                if step.get("type") == "speak_repeat" and step.get("pitchRef"):
                    media.add(step["pitchRef"])
                if step.get("type") == "culture_card":
                    audio = (culture_by_id.get(step.get("ref")) or {}).get("audio")
                    if audio:
                        media.add(audio)
        units.append(
            {
                "format": SPLIT_FORMAT,
                "pack": raw["pack"]["code"],
                "version": raw["pack"]["version"],
                "unit": unit,
                "lessons": lessons,
                "concepts": [c for c in concepts if concept_unit.get(c["id"]) == unit],
                "culture": [c for c in culture if unit in culture_units.get(c["id"], [])],
                "media": sorted(p for p in media if p in present),
            }
        )

    core: dict[str, Any] = {
        "format": SPLIT_FORMAT,
        "pack": raw["pack"],
        "curriculum": raw["curriculum"],
        "lessonIndex": [_summarize_lesson(lesson) for lesson in raw.get("lessons", [])],
        "conceptIndex": [_summarize_concept(c, concept_unit.get(c["id"])) for c in concepts],
    }
    if raw.get("variants") is not None:
        core["variants"] = raw["variants"]
    core["mediaIndex"] = media_list
    core["exams"] = list(raw.get("exams") or [])
    core["placement"] = raw.get("placement")
    core["games"] = raw.get("games") if raw.get("games") is not None else {}
    core["units"] = [
        {
            "id": u["unit"],
            "bytes": utf8_bytes(u),
            "mediaBytes": sum(size(p) for p in u["media"]),
            "mediaCount": len(u["media"]),
        }
        for u in units
    ]
    return core, units


def merge_split(core: dict[str, Any], units: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Recompose le bundle (tests) : leçons et concepts dans l'ordre du core."""
    unit_list = list(units)
    lessons = {lesson["id"]: lesson for u in unit_list for lesson in u["lessons"]}
    concepts = {c["id"]: c for u in unit_list for c in u["concepts"]}
    culture: dict[str, Any] = {}
    for u in unit_list:
        for card in u["culture"]:
            culture.setdefault(card["id"], card)
    return {
        "pack": core["pack"],
        "curriculum": core["curriculum"],
        "lessons": [lessons[s["id"]] for s in core["lessonIndex"]],
        "concepts": [concepts[c["id"]] for c in core["conceptIndex"]],
        "culture": list(culture.values()),
        **({"variants": core["variants"]} if "variants" in core else {}),
        "mediaIndex": core["mediaIndex"],
        "exams": core["exams"],
        "placement": core["placement"],
        "games": core["games"],
    }


def _media_size(pack: Pack, studio_media_dir: Path | None, path: str) -> int:
    for root in (pack.directory, studio_media_dir / pack.code if studio_media_dir else None):
        if root is None:
            continue
        target = root / path
        try:
            if target.is_file():
                return target.stat().st_size
        except OSError:
            continue
    return 0


_CacheKey = tuple[Path, int, frozenset[str], Path | None]
_cache: dict[_CacheKey, tuple[dict[str, Any], dict[str, dict[str, Any]]]] = {}
_CACHE_SIZE = 8


def pack_split(pack: Pack, settings: Settings) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Core et unités de la version publiée courante, en cache par (dossier, version, médias) : une publication
    du studio (version incrémentée) ou un nouveau média invalide l'entrée dans tous les workers."""
    media = media_index(pack, settings.studio_media_dir)
    key: _CacheKey = (pack.directory, pack.version, media, settings.studio_media_dir)
    cached = _cache.get(key)
    if cached is None:
        core, units = split_pack(
            build_bundle(pack, settings), lambda path: _media_size(pack, settings.studio_media_dir, path)
        )
        if len(_cache) >= _CACHE_SIZE:
            _cache.pop(next(iter(_cache)))
        cached = _cache[key] = (core, {u["unit"]: u for u in units})
    return cached


def clear_cache() -> None:
    _cache.clear()
