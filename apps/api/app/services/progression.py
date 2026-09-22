"""Progression et déblocage (contrat parcours §2) — portage fidèle de packages/core (session.ts, placement.ts).

- **Test d'unité réussi** : leçon `kind: "unit_test"` terminée avec un meilleur score ≥ 0,7. Une unité sans test
  d'unité est réussie quand toutes ses leçons sont terminées.
- **Graphe d'unités** : `requires` (défaut : unité précédente dans la liste). Une unité est disponible quand chaque
  unité requise (existante) est réussie. Seuls les prérequis de leçons **intra-unité** comptent. Le tri par
  `boostTags` s'applique aux unités disponibles.
- **Placement** : niveau 0..3 → début de u01 / u03 / u05 / u07 (première unité publiée de numéro ≥ cible, sinon la
  dernière) ; les leçons antérieures sont « sautées » : comptées terminées **et** réussies (comme le client, qui les
  ajoute à ses ensembles `completed` et `passed`).
"""

import re
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass

from app.services.content import Lesson, Pack, Unit

UNIT_TEST_PASS_SCORE = 0.7
PLACEMENT_ENTRY_UNITS = (1, 3, 5, 7)
_EPSILON = 1e-9
_UNIT_NUMBER = re.compile(r"u(\d+)$")


def is_unit_test_passed(best_score: float) -> bool:
    return best_score >= UNIT_TEST_PASS_SCORE - _EPSILON


@dataclass(frozen=True)
class ProgressState:
    """`ProgressSets` du client : leçons terminées et tests d'unité réussis (sautées au placement comprises)."""

    completed: frozenset[str] = frozenset()
    passed: frozenset[str] = frozenset()


def progress_from(pack: Pack, best_scores: Mapping[str, float], entry_lesson_id: str | None = None) -> ProgressState:
    """Ensembles à partir des meilleurs scores des leçons terminées et du point d'entrée du placement."""
    skipped = set(lessons_before(pack, entry_lesson_id)) if entry_lesson_id else set()
    completed = set(best_scores) | skipped
    passed = {
        lid
        for lid, score in best_scores.items()
        if (lesson := pack.lessons.get(lid)) is not None and lesson.kind == "unit_test" and is_unit_test_passed(score)
    } | skipped
    return ProgressState(frozenset(completed), frozenset(passed))


def unit_requires(pack: Pack, unit: Unit) -> tuple[str, ...]:
    if unit.requires is not None:
        return unit.requires
    index = next((i for i, u in enumerate(pack.units) if u.id == unit.id), 0)
    return (pack.units[index - 1].id,) if index > 0 else ()


def unit_test_lessons(pack: Pack, unit: Unit) -> list[str]:
    return [lid for lid in unit.lessons if (lesson := pack.lessons.get(lid)) is not None and lesson.kind == "unit_test"]


def is_unit_passed(pack: Pack, unit: Unit, state: ProgressState) -> bool:
    """Chaque test d'unité réussi ; sans test, toutes les leçons de l'unité terminées."""
    if not unit.lessons:
        return False
    tests = unit_test_lessons(pack, unit)
    if tests:
        return all(lid in state.passed for lid in tests)
    return all(lid in state.completed for lid in unit.lessons)


def is_unit_available(pack: Pack, unit: Unit, state: ProgressState) -> bool:
    if unit.status != "available":
        return False
    by_id = {u.id: u for u in pack.units}
    return all(rid not in by_id or is_unit_passed(pack, by_id[rid], state) for rid in unit_requires(pack, unit))


def lesson_done(lesson: Lesson, state: ProgressState) -> bool:
    """Terminée, et réussie s'il s'agit d'un test d'unité (un test sous le seuil reste à refaire).

    **Volontairement plus permissif que le client**, et ce n'est pas un oubli. Depuis le contrat
    phase10 §3, l'application exige la *maîtrise* d'une leçon ordinaire — tous ses exercices notés
    réussis — pour ouvrir la suivante. `passed` ne contient ici que des tests d'unité (voir
    `progress_from`) : la même règle n'est pas appliquée.

    Le serveur *reçoit* la maîtrise depuis le contrat phase25 §1 (`lesson_progress.mastered`), mais
    il la garde pour la **rendre** à un appareil restauré — il ne s'en sert pas pour juger. La
    colonne est fausse pour toutes les leçons faites avant ce contrat : s'en servir ici renverrait
    les comptes existants à la première leçon du cursus. Ne pas « aligner » cette fonction sur le
    client tant que ces lignes n'ont pas été rattrapées.

    Conséquence assumée : côté serveur, `next_lesson` peut désigner la leçon suivante là où le
    client propose de refaire la précédente. C'est sans effet sur l'apprentissage — le client est
    la source de vérité de la séance ; le serveur ne s'en sert que pour le pointeur d'inscription
    et la phrase du bilan hebdomadaire.
    """
    if lesson.id not in state.completed:
        return False
    return lesson.kind != "unit_test" or lesson.id in state.passed


def is_lesson_unlocked(pack: Pack, lesson_id: str, state: ProgressState) -> bool:
    lesson = pack.lessons.get(lesson_id)
    if lesson is None:
        return False
    if lesson_id in state.completed:
        return True
    unit = next((u for u in pack.units if lesson_id in u.lessons), None)
    if unit is None or not is_unit_available(pack, unit, state):
        return False
    in_unit = set(unit.lessons)
    return all(p not in in_unit or p in state.completed for p in lesson.prerequisites)


def next_lesson(pack: Pack, lessons: Mapping[str, Lesson], state: ProgressState, path: str | None) -> Lesson | None:
    """Première leçon non faite des unités disponibles (boostées d'abord), prérequis intra-unité remplis."""
    boost = set(pack.paths.get(path, ())) if path else set()
    units = [
        (unit, order, any(t in boost for t in unit.tags))
        for order, unit in enumerate(pack.units)
        if is_unit_available(pack, unit, state)
    ]
    units.sort(key=lambda u: (not u[2], u[1]))
    for unit, _order, _boosted in units:
        in_unit = set(unit.lessons)
        for lesson_id in unit.lessons:
            lesson = lessons.get(lesson_id)
            if lesson is None or lesson_done(lesson, state):
                continue
            if all(p not in in_unit or p in state.completed for p in lesson.prerequisites):
                return lesson
    return None


def unit_number(unit: Unit, index: int) -> int:
    match = _UNIT_NUMBER.search(unit.id)
    return int(match.group(1)) if match else index + 1


def resolve_entry_lesson(pack: Pack, level_estimate: int) -> Lesson | None:
    """Niveau 0..3 → première leçon de la première unité publiée (avec leçons) de numéro ≥ u01/u03/u05/u07,
    sinon de la dernière unité publiée."""
    level = max(0, min(len(PLACEMENT_ENTRY_UNITS) - 1, int(level_estimate)))
    target = PLACEMENT_ENTRY_UNITS[level]
    candidates: list[tuple[int, Lesson]] = []
    for index, unit in enumerate(pack.units):
        first = next((pack.lessons[lid] for lid in unit.lessons if lid in pack.lessons), None)
        if unit.status == "available" and first is not None:
            candidates.append((unit_number(unit, index), first))
    if not candidates:
        return None
    return next((first for number, first in candidates if number >= target), candidates[-1][1])


def lessons_before(pack: Pack, lesson_id: str | None) -> list[str]:
    """Leçons situées avant `lesson_id` dans l'ordre du cursus (sautées par le placement) — `lessonsBefore`."""
    ordered = [lid for unit in pack.units for lid in unit.lessons]
    if not lesson_id or lesson_id not in ordered:
        return []
    return ordered[: ordered.index(lesson_id)]


def done_units(pack: Pack, state: ProgressState, unit_ids: Collection[str]) -> bool:
    """Examen débloqué : chaque unité requise existe et est réussie (ou sautée au placement)."""
    by_id = {u.id: u for u in pack.units}
    return all(uid in by_id and is_unit_passed(pack, by_id[uid], state) for uid in unit_ids)


def passed_units(pack: Pack, state: ProgressState) -> set[str]:
    return {u.id for u in pack.units if is_unit_passed(pack, u, state)}


def unlocked_lessons(state: ProgressState, extra: Iterable[str] = ()) -> set[str]:
    return set(state.completed) | set(extra)
