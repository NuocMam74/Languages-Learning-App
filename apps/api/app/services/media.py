"""Disponibilité des médias (contrat parcours §1) — miroir de `hasNativeAudio` / `hasPitchRef` (packages/core).

- `mediaIndex` : chemins relatifs des fichiers présents (`audio/…`, `pitch/…`, `img/…`), côté API calculé à partir
  de CONTENT_DIR (+ médias du studio, pas encore publiés).
- `has_native_audio(concept)` : au moins une piste `source: "native"` dont `src` est dans l'index.
- `has_pitch_ref(concept|step)` : `pitchRef` (étape) ou `pitch` (concept) présent dans l'index.
"""

from collections.abc import Collection, Mapping
from pathlib import Path
from typing import Any

from app.services.content import Pack, scan_media

TONE_STEP_TYPES = frozenset({"tone_identify", "tone_minimal_pair", "tone_produce"})
SPEECH_STEP_TYPES = frozenset({"speak_repeat", "tone_produce"})


class _AllMedia(frozenset[str]):
    """Index « tout est présent » (`mediaIndex` null côté core : fichiers de test lus sur disque)."""

    def __contains__(self, item: object) -> bool:
        return isinstance(item, str) and bool(item)


ALL_MEDIA: frozenset[str] = _AllMedia()


def media_index(pack: Pack, studio_media_dir: Path | None = None) -> frozenset[str]:
    """Index du pack publié, complété par les médias produits par le studio pour ce pack."""
    if studio_media_dir is None:
        return pack.media_index
    studio = studio_media_dir / pack.code
    return pack.media_index | scan_media(studio) if studio.is_dir() else pack.media_index


def has_native_audio(concept: Mapping[str, Any] | None, index: Collection[str]) -> bool:
    if not concept:
        return False
    return any(
        isinstance(track, dict) and track.get("source") == "native" and track.get("src") in index
        for track in concept.get("audio") or []
    )


def has_pitch_ref(item: Mapping[str, Any] | None, index: Collection[str]) -> bool:
    """`pitchRef` d'une étape ou `pitch` d'un concept présent dans l'index."""
    if not item:
        return False
    ref = item.get("pitchRef") if item.get("pitchRef") is not None else item.get("pitch")
    return isinstance(ref, str) and ref in index


def speech_reference_available(
    step: Mapping[str, Any], concepts: Mapping[str, Mapping[str, Any]], index: Collection[str]
) -> bool:
    """Référence F0 effective d'une étape orale (comme buildExercise : `step.pitchRef ?? concept.pitch`)."""
    concept = concepts.get(str(step.get("concept", "")))
    if step.get("type") == "speak_repeat" and isinstance(step.get("pitchRef"), str):
        return step["pitchRef"] in index
    return has_pitch_ref({"pitch": concept.get("pitch")} if concept else None, index)


def step_audio_concepts(step: Mapping[str, Any]) -> list[str]:
    """Concepts dont l'audio est joué par une étape tonale (toutes les cibles possibles d'une paire minimale)."""
    if step.get("type") == "tone_minimal_pair":
        return [c for c in step.get("audioConcepts") or [] if isinstance(c, str)]
    concept = step.get("concept")
    return [concept] if isinstance(concept, str) else []


def tone_step_playable(
    step: Mapping[str, Any], concepts: Mapping[str, Mapping[str, Any]], index: Collection[str]
) -> bool:
    """Étape tonale d'écoute jouable : chaque audio qu'elle peut jouer existe en natif."""
    ids = step_audio_concepts(step)
    if step.get("type") == "tone_minimal_pair" and len(ids) != len(step.get("pair") or []):
        return False  # paire sans audio pour chaque forme : synthèse vocale, jamais notée
    return bool(ids) and all(has_native_audio(concepts.get(cid), index) for cid in ids)


def exam_item_graded(
    step: Mapping[str, Any], concepts: Mapping[str, Mapping[str, Any]], index: Collection[str]
) -> bool:
    """Item d'examen noté (§1) : oral sans référence F0 et écoute tonale sans audio natif → non noté."""
    kind = step.get("type")
    if kind in SPEECH_STEP_TYPES:
        return speech_reference_available(step, concepts, index)
    if kind in TONE_STEP_TYPES:
        return tone_step_playable(step, concepts, index)
    return True
