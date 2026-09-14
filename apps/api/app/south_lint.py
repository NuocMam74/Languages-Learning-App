"""Garde du Sud — portage Python de `packages/south-lint/src/index.ts` (spec §8.5, ADR 0005).

Repère dans un texte vietnamien les formes lexicales du Nord déclarées dans `lexical-variants.json`.
Correspondance par syllabes entières (« bố » ne matche pas « bốn »), insensible à la casse,
sur texte normalisé NFC. Une occurrence couverte par une expression d'exception (« công bố ») est ignorée.

Les deux implémentations doivent passer les mêmes cas : `packages/south-lint/cases.json`.
Note : les décalages sont en points de code (Python) ; ils coïncident avec les unités UTF-16
du TypeScript pour tout texte vietnamien (plan multilingue de base).
"""

import json
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

Severity = Literal["error", "warning", "none"]


@dataclass(frozen=True)
class LexicalVariantEntry:
    id: str
    south: tuple[str, ...]
    north: tuple[str, ...]
    severity: Severity
    exceptions: tuple[str, ...] = ()


@dataclass(frozen=True)
class SouthLintFinding:
    entry_id: str
    # Forme telle qu'elle apparaît dans le texte (NFC).
    found: str
    suggestions: tuple[str, ...]
    severity: Literal["error", "warning"]
    start: int
    end: int


@dataclass(frozen=True)
class _Syllable:
    text: str
    start: int
    end: int


@dataclass(frozen=True)
class _Pattern:
    entry: LexicalVariantEntry
    north: tuple[str, ...]
    exceptions: tuple[tuple[str, ...], ...]


def _is_syllable_char(ch: str) -> bool:
    # Équivalent de la classe [\p{L}\p{M}] du TypeScript.
    return unicodedata.category(ch)[0] in ("L", "M")


def tokenize(text: str) -> list[_Syllable]:
    nfc = unicodedata.normalize("NFC", text)
    out: list[_Syllable] = []
    start: int | None = None
    for i, ch in enumerate(nfc):
        if _is_syllable_char(ch):
            if start is None:
                start = i
        elif start is not None:
            out.append(_Syllable(nfc[start:i].lower(), start, i))
            start = None
    if start is not None:
        out.append(_Syllable(nfc[start:].lower(), start, len(nfc)))
    return out


def _split_phrase(phrase: str) -> tuple[str, ...]:
    return tuple(s.text for s in tokenize(phrase))


def _matches_at(syllables: Sequence[_Syllable], at: int, pattern: Sequence[str]) -> bool:
    if at < 0 or at + len(pattern) > len(syllables):
        return False
    return all(syllables[at + i].text == p for i, p in enumerate(pattern))


def _covered_by_exception(
    syllables: Sequence[_Syllable], at: int, length: int, exceptions: Sequence[Sequence[str]]
) -> bool:
    """Vrai si la plage [at, at+length) est entièrement couverte par une occurrence d'exception."""
    for exc in exceptions:
        for exc_start in range(at + length - len(exc), at + 1):
            if _matches_at(syllables, exc_start, exc):
                return True
    return False


def create_south_linter(entries: Sequence[LexicalVariantEntry]) -> Callable[[str], list[SouthLintFinding]]:
    patterns: list[_Pattern] = []
    for entry in entries:
        if entry.severity == "none":
            continue
        south_forms = {" ".join(_split_phrase(s)) for s in entry.south}
        exceptions = tuple(e for e in (_split_phrase(x) for x in entry.exceptions) if e)
        for north in entry.north:
            tokens = _split_phrase(north)
            # Forme identique au Nord et au Sud : rien à signaler.
            if not tokens or " ".join(tokens) in south_forms:
                continue
            patterns.append(_Pattern(entry, tokens, exceptions))

    def lint(text: str) -> list[SouthLintFinding]:
        syllables = tokenize(text)
        nfc = unicodedata.normalize("NFC", text)
        findings: list[SouthLintFinding] = []
        for i in range(len(syllables)):
            for p in patterns:
                if not _matches_at(syllables, i, p.north):
                    continue
                if _covered_by_exception(syllables, i, len(p.north), p.exceptions):
                    continue
                first = syllables[i]
                last = syllables[i + len(p.north) - 1]
                findings.append(
                    SouthLintFinding(
                        entry_id=p.entry.id,
                        found=nfc[first.start : last.end],
                        suggestions=p.entry.south,
                        severity="error" if p.entry.severity == "error" else "warning",
                        start=first.start,
                        end=last.end,
                    )
                )
        return findings

    return lint


def has_blocking(findings: Sequence[SouthLintFinding]) -> bool:
    return any(f.severity == "error" for f in findings)


def entries_from_json(data: Mapping[str, Any]) -> list[LexicalVariantEntry]:
    return [
        LexicalVariantEntry(
            id=e["id"],
            south=tuple(e["south"]),
            north=tuple(e["north"]),
            severity=e["severity"],
            exceptions=tuple(e.get("exceptions", [])),
        )
        for e in data["entries"]
    ]


def load_linter(variants_path: Path) -> Callable[[str], list[SouthLintFinding]]:
    """Construit un linter depuis un fichier `lexical-variants.json`."""
    return create_south_linter(entries_from_json(json.loads(variants_path.read_text(encoding="utf-8"))))
