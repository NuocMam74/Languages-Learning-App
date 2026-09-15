"""Moteur d'exercices côté serveur — portage fidèle de `buildExercise`/`evaluate` (packages/core/src/engine.ts).

Sert à la notation des examens : le serveur reconstruit chaque exercice avec la même graine que le client
(mêmes identifiants d'options, même ordre) puis rejoue `evaluate` sur la réponse brute. Parité vérifiée par
`tests/test_core_parity.py` sur des fixtures produites par le code TypeScript.
"""

import json
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.services.content import Pack, concept_documents, lesson_document
from app.services.text import compare_answer, heard_class_of, normalize_answer, tone_of

SPEAK_PASS_SCORE = 60
GAME_PASS_RATIO = 0.7

_MASK = 0xFFFFFFFF


class ContentError(Exception):
    """Contenu incohérent (concept, variante ou étape introuvable)."""


# --- Aléa déterministe ------------------------------------------------------------------------


def _imul(a: int, b: int) -> int:
    """`Math.imul` sur des entiers 32 bits (motif binaire non signé)."""
    return ((a & _MASK) * (b & _MASK)) & _MASK


def _utf16_units(text: str) -> list[int]:
    """Unités UTF-16 (équivalent de `charCodeAt`)."""
    data = text.encode("utf-16-le")
    return [int.from_bytes(data[i : i + 2], "little") for i in range(0, len(data), 2)]


def seeded_random(seed: str) -> Callable[[], float]:
    units = _utf16_units(seed)
    h = (1779033703 ^ len(units)) & _MASK
    for unit in units:
        h = _imul(h ^ unit, 3432918353)
        h = ((h << 13) | (h >> 19)) & _MASK
    state = h

    def rand() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & _MASK
        t = state
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & _MASK)) & _MASK
        return ((t ^ (t >> 14)) & _MASK) / 4294967296

    return rand


def shuffle[T](items: Sequence[T], rand: Callable[[], float]) -> list[T]:
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = math.floor(rand() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


# --- Contenu ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class ContentIndex:
    concepts: dict[str, dict[str, Any]]
    variants: list[dict[str, Any]]
    heard_classes: list[list[str]] | None


@lru_cache(maxsize=16)
def _variants(directory: Path, version: int) -> list[dict[str, Any]]:
    """Variantes lexicales en cache par (dossier, version du pack) : une publication les invalide partout."""
    path = directory / "lexical-variants.json"
    if not path.is_file():
        return []
    entries: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8")).get("entries", [])
    return entries


def content_index(pack: Pack) -> ContentIndex:
    tone_system = pack.raw.get("toneSystem") or {}
    return ContentIndex(
        concepts=concept_documents(pack),
        variants=_variants(pack.directory, pack.version),
        heard_classes=tone_system.get("heardClasses"),
    )


# --- Exercices --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Option:
    id: str
    text: str | None = None
    tones: tuple[str, ...] | None = None


@dataclass(frozen=True)
class Exercise:
    type: str
    concept_ids: list[str]
    options: list[Option] = field(default_factory=list)
    answer_id: str | None = None
    target: str | None = None
    tokens: list[Option] = field(default_factory=list)
    expected_text: str = ""

    @property
    def is_choice(self) -> bool:
        return self.answer_id is not None


@dataclass(frozen=True)
class Evaluation:
    correct: bool
    near_miss: bool
    graded: bool


def _concept(content: ContentIndex, concept_id: str) -> dict[str, Any]:
    concept = content.concepts.get(concept_id)
    if concept is None:
        raise ContentError(f"Concept inconnu : {concept_id}")
    return concept


def build_exercise(
    content: ContentIndex,
    lesson_id: str,
    lesson_concepts: Sequence[str],
    steps: Sequence[dict[str, Any]],
    step_index: int,
    seed: str,
) -> Exercise:
    """`buildExercise(content, lesson, stepIndex, seed)` : graine `${seed}:${lesson.id}:${stepIndex}`."""
    if step_index < 0 or step_index >= len(steps):
        raise ContentError(f"Étape {step_index} absente de {lesson_id}")
    rand = seeded_random(f"{seed}:{lesson_id}:{step_index}")
    return _build_from_step(content, lesson_concepts, steps[step_index], rand)


def _build_from_step(
    content: ContentIndex, lesson_concepts: Sequence[str], step: dict[str, Any], rand: Callable[[], float]
) -> Exercise:
    kind = step["type"]
    match kind:
        case "listen_pick_image":
            audio = _concept(content, step["concept"])
            all_concepts = [_concept(content, cid) for cid in [step["concept"], *step["distractors"]]]
            options = [Option(id=c["id"], text=c["vi"]) for c in shuffle(all_concepts, rand)]
            return Exercise(kind, [audio["id"]], options, answer_id=audio["id"])

        case "listen_pick_text":
            audio = _concept(content, step["concept"])
            texts = shuffle([audio["vi"], *step["distractors"]], rand)
            options = [Option(id=f"t{i}", text=text) for i, text in enumerate(texts)]
            answer = next((o.id for o in options if o.text == audio["vi"]), "")
            return Exercise(kind, [audio["id"]], options, answer_id=answer)

        case "tone_identify":
            audio = _concept(content, step["concept"])
            if not content.heard_classes:
                raise ContentError("tone_identify sans toneSystem dans le pack")
            tone = audio.get("tone") or tone_of(audio["vi"])
            answer_class = heard_class_of(tone, content.heard_classes)
            options = [Option(id=f"tone{i}", tones=tuple(cls)) for i, cls in enumerate(content.heard_classes)]
            return Exercise(kind, [audio["id"]], options, answer_id=f"tone{answer_class}")

        case "tone_minimal_pair":
            pair: list[str] = step["pair"]
            target_index = math.floor(rand() * len(pair))
            audio_concepts: list[str] = step.get("audioConcepts") or []
            audio_id = audio_concepts[target_index] if target_index < len(audio_concepts) else None
            audio = _concept(content, audio_id) if audio_id else None
            options = [Option(id=f"p{i}", text=text) for i, text in enumerate(pair)]
            return Exercise(kind, [audio["id"]] if audio else [], options, answer_id=f"p{target_index}")

        case "spot_the_south":
            entry = next((e for e in content.variants if e["id"] == step["variant"]), None)
            if entry is None:
                raise ContentError(f"Variante inconnue : {step['variant']}")
            south = (entry.get("south") or [""])[0]
            north = (entry.get("north") or [""])[0]
            options = shuffle([Option(id="south", text=south), Option(id="north", text=north)], rand)
            return Exercise(kind, [], options, answer_id="south")

        case "build_sentence":
            tokens = shuffle([Option(id=f"k{i}", text=text) for i, text in enumerate(step["tokens"])], rand)
            audio = _concept(content, step["audioConcept"]) if step.get("audioConcept") else None
            concept_ids = [audio["id"]] if audio else _concepts_in_text(content, lesson_concepts, step["target"])
            return Exercise(kind, concept_ids, target=step["target"], tokens=tokens, expected_text=step["target"])

        case "speak_repeat" | "tone_produce":
            concept = _concept(content, step["concept"])
            return Exercise(kind, [concept["id"]], expected_text=concept["vi"])

        case _:
            # culture_card, game et les types non gérés par core ne figurent pas dans les examens.
            return Exercise("unsupported", [])


def _concepts_in_text(content: ContentIndex, lesson_concepts: Sequence[str], text: str) -> list[str]:
    haystack = f" {normalize_answer(text)} "
    return [
        cid
        for cid in lesson_concepts
        if cid in content.concepts and f" {normalize_answer(content.concepts[cid]['vi'])} " in haystack
    ]


def evaluate(exercise: Exercise, response: dict[str, Any]) -> Evaluation:
    """`evaluate(exercise, response)` ; `response` suit `ExerciseResponse` (JSON du client)."""
    kind = response.get("kind")
    if kind == "skip":
        return Evaluation(correct=False, near_miss=False, graded=False)

    if exercise.is_choice:
        if kind != "choice":
            return Evaluation(correct=False, near_miss=False, graded=False)
        option_id = response.get("optionId")
        expected = next((o for o in exercise.options if o.id == exercise.answer_id), None)
        chosen = next((o for o in exercise.options if o.id == option_id), None)
        correct = option_id == exercise.answer_id
        near_miss = (
            not correct
            and chosen is not None
            and chosen.text is not None
            and expected is not None
            and expected.text is not None
            and compare_answer(chosen.text, [expected.text]) == "tone_only"
        )
        return Evaluation(correct=correct, near_miss=near_miss, graded=True)

    if exercise.type == "build_sentence":
        if kind != "tokens":
            return Evaluation(correct=False, near_miss=False, graded=False)
        by_id = {t.id: t.text or "" for t in exercise.tokens}
        ids = response.get("optionIds") or []
        sentence = " ".join(by_id.get(i, "") if isinstance(i, str) else "" for i in ids)
        match = compare_answer(sentence, [exercise.target or ""])
        return Evaluation(correct=match == "correct", near_miss=match == "tone_only", graded=True)

    if exercise.type in ("speak_repeat", "tone_produce"):
        if kind != "speech":
            return Evaluation(correct=False, near_miss=False, graded=False)
        score = response.get("score")
        if score is None:
            return Evaluation(correct=True, near_miss=False, graded=False)
        correct = score >= SPEAK_PASS_SCORE
        return Evaluation(correct=correct, near_miss=not correct and score >= SPEAK_PASS_SCORE - 15, graded=True)

    return Evaluation(correct=True, near_miss=False, graded=False)


def lesson_concepts_for_units(pack: Pack, unit_ids: Sequence[str]) -> list[str]:
    """Concepts des leçons des unités données (dans l'ordre donné, puis du cursus), sans doublon — `examConcepts`."""
    seen: dict[str, None] = {}
    units = {u.id: u for u in pack.units}
    for unit_id in unit_ids:
        unit = units.get(unit_id)
        for lesson_id in unit.lessons if unit else ():
            doc = lesson_document(pack, lesson_id)
            for cid in (doc or {}).get("concepts", []):
                seen.setdefault(cid, None)
    return list(seen)
