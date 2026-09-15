"""Texte vietnamien — portage fidèle de `packages/core/src/text.ts` (normalisation, tons, comparaison).

Marques de ton (combinantes, après décomposition NFD) :
  U+0300 huyền · U+0301 sắc · U+0309 hỏi · U+0303 ngã · U+0323 nặng
"""

import re
import unicodedata
from collections.abc import Sequence
from typing import Literal

Tone = Literal["ngang", "huyen", "sac", "hoi", "nga", "nang"]

TONE_MARKS: dict[str, Tone] = {
    "\u0300": "huyen",
    "\u0301": "sac",
    "\u0309": "hoi",
    "\u0303": "nga",
    "\u0323": "nang",
}

_WHITESPACE_RE = re.compile(r"\s+")

MatchKind = Literal["correct", "tone_only", "diacritics_only", "wrong"]


def _is_punctuation_or_symbol(ch: str) -> bool:
    return unicodedata.category(ch)[0] in ("P", "S")


def normalize_answer(text: str) -> str:
    """NFC, minuscules, ponctuation et symboles → espace, espaces réduits. Les diacritiques restent."""
    lowered = unicodedata.normalize("NFC", text).lower()
    spaced = "".join(" " if _is_punctuation_or_symbol(ch) else ch for ch in lowered)
    return _WHITESPACE_RE.sub(" ", spaced).strip()


def strip_tones(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return unicodedata.normalize("NFC", "".join(ch for ch in decomposed if ch not in TONE_MARKS))


def strip_diacritics(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    bare = "".join(ch for ch in decomposed if unicodedata.category(ch)[0] != "M")
    return bare.replace("đ", "d").replace("Đ", "D")


def tone_of(syllable: str) -> Tone:
    for ch in unicodedata.normalize("NFD", syllable):
        tone = TONE_MARKS.get(ch)
        if tone:
            return tone
    return "ngang"


def heard_class_of(tone: str, heard_classes: Sequence[Sequence[str]]) -> int:
    for i, cls in enumerate(heard_classes):
        if tone in cls:
            return i
    return -1


def compare_answer(given: str, accepted: Sequence[str]) -> MatchKind:
    """Nature de la correspondance (le détail `expected`/`positions` n'est pas utile côté serveur)."""
    g = normalize_answer(given)
    forms = [normalize_answer(a) for a in accepted]
    if g in forms:
        return "correct"
    if any(strip_tones(form) == strip_tones(g) for form in forms):
        return "tone_only"
    if any(strip_diacritics(form) == strip_diacritics(g) for form in forms):
        return "diacritics_only"
    return "wrong"
