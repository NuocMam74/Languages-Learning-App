"""Contrat parcours §2–§3 (règles pures) : graphe d'unités, test d'unité réussi, placement, niveaux, série, badges."""

from datetime import date
from pathlib import Path

from app.config import REPO_ROOT
from app.services import progression
from app.services.badges import LEARNING_BADGES, BadgeInput, badge_codes_for, evaluate_badges
from app.services.content import load_packs
from app.services.levels import MAX_LEVEL, level_for_xp, level_info, xp_for_level
from app.services.progression import ProgressState
from app.services.streak import Streak, displayed_current, freeze, record_activity
from tests.synthetic import build_pack

VI = load_packs(REPO_ROOT / "content")["vi-south"]


def state(completed: dict[str, float] | None = None, entry: str | None = None) -> ProgressState:
    return progression.progress_from(VI, completed or {}, entry)


# --- §2 Test d'unité réussi, graphe d'unités ----------------------------------------------------


def test_unit_test_pass_mark_unlocks_next_unit(tmp_path: Path) -> None:
    pack = build_pack(tmp_path, [{"n": 1, "lessons": 2}, {"n": 2, "lessons": 2}])
    lessons = pack.lessons

    def state(done: dict[str, float]) -> ProgressState:
        return progression.progress_from(pack, done)

    after_lesson = state({"tp.u01.l01": 1.0})
    assert progression.next_lesson(pack, lessons, after_lesson, None).id == "tp.u01.l02"  # type: ignore[union-attr]

    # Test d'unité terminé sous 0,7 : l'unité suivante reste fermée, le test est reproposé.
    failed = state({"tp.u01.l01": 1.0, "tp.u01.l02": 0.69})
    assert not progression.is_unit_passed(pack, pack.units[0], failed)
    assert not progression.is_unit_available(pack, pack.units[1], failed)
    assert progression.next_lesson(pack, lessons, failed, None).id == "tp.u01.l02"  # type: ignore[union-attr]

    passed = state({"tp.u01.l01": 1.0, "tp.u01.l02": 0.7})
    assert progression.is_unit_passed(pack, pack.units[0], passed)
    assert progression.next_lesson(pack, lessons, passed, None).id == "tp.u02.l01"  # type: ignore[union-attr]


def test_requires_graph_and_boost_reorder(tmp_path: Path) -> None:
    # u02 (famille) ne requiert que u01 ; u03 (voyage) aussi : les deux sont disponibles après u01.
    pack = build_pack(
        tmp_path,
        [
            {"n": 1},
            {"n": 2, "tags": ["travel"], "requires": [1]},
            {"n": 3, "tags": ["family"], "requires": [1]},
            {"n": 4},  # défaut : requiert l'unité précédente (u03)
        ],
        paths={"family": ["family"], "travel": ["travel"]},
    )
    done_u1 = progression.progress_from(pack, {"tp.u01.l01": 1, "tp.u01.l02": 1})
    # Les prérequis inter-unités des leçons (u03.l01 → u02.l02) sont ignorés : seul le graphe compte.
    assert progression.next_lesson(pack, pack.lessons, done_u1, "family").id == "tp.u03.l01"  # type: ignore[union-attr]
    assert progression.next_lesson(pack, pack.lessons, done_u1, "travel").id == "tp.u02.l01"  # type: ignore[union-attr]
    assert progression.next_lesson(pack, pack.lessons, done_u1, None).id == "tp.u02.l01"  # type: ignore[union-attr]
    assert progression.unit_requires(pack, pack.units[3]) == ("tp.u03",)
    assert not progression.is_unit_available(pack, pack.units[3], done_u1)


def test_intra_unit_prerequisites_still_apply(tmp_path: Path) -> None:
    pack = build_pack(
        tmp_path, [{"n": 1, "lessons": 3}], lesson_prereqs={"tp.u01.l02": ["tp.u01.l03"], "tp.u01.l03": []}
    )
    first = progression.next_lesson(pack, pack.lessons, ProgressState(), None)
    assert first is not None and first.id == "tp.u01.l01"
    after = progression.progress_from(pack, {"tp.u01.l01": 1})
    # l02 requiert l03 (même unité) : l03 d'abord.
    assert progression.next_lesson(pack, pack.lessons, after, None).id == "tp.u01.l03"  # type: ignore[union-attr]


def test_placement_entry_mapping_real_curriculum() -> None:
    # Niveau 0 : les bases (u00, contrat phase26 §2).
    expected = {0: "vi-south.u00", 1: "vi-south.u03", 2: "vi-south.u05", 3: "vi-south.u07"}
    for level, unit_id in expected.items():
        entry = progression.resolve_entry_lesson(VI, level)
        assert entry is not None and entry.unit == unit_id
        assert entry.id == next(u for u in VI.units if u.id == unit_id).lessons[0]
    entry = progression.resolve_entry_lesson(VI, 2)
    assert entry is not None
    s = state(entry=entry.id)
    # Leçons antérieures sautées : terminées et réussies ; u00 à u04 réussies, u05 proposée.
    assert progression.passed_units(VI, s) >= {"vi-south.u00", "vi-south.u01", "vi-south.u02", "vi-south.u03", "vi-south.u04"}
    assert "vi-south.u05" not in progression.passed_units(VI, s)
    proposed = progression.next_lesson(VI, VI.lessons, s, None)
    assert proposed is not None and proposed.unit == "vi-south.u05"


def test_placement_first_existing_unit_at_or_after_target(tmp_path: Path) -> None:
    pack = build_pack(tmp_path, [{"n": 1}, {"n": 2}, {"n": 4}, {"n": 6}])
    units = [progression.resolve_entry_lesson(pack, level) for level in (0, 1, 2, 3)]
    # Rien au-delà de u06 pour le niveau 3 : dernière unité publiée.
    assert [u.unit if u else None for u in units] == ["tp.u01", "tp.u04", "tp.u06", "tp.u06"]


# --- §3 Niveaux ----------------------------------------------------------------------------------


def test_level_formula_and_names() -> None:
    assert xp_for_level(1) == 0
    assert xp_for_level(2) == 100
    assert xp_for_level(50) == 63_700
    assert [level_for_xp(x) for x in (0, 99, 100, 249, 250, 63_699, 63_700, 10**9)] == [1, 1, 2, 2, 3, 49, 50, 50]
    info = level_info(130, VI)
    assert (info.value, info.xp_into_level, info.xp_for_next) == (2, 30, 150)
    names = VI.raw["levelNames"]
    assert info.name == names[0]
    assert level_info(xp_for_level(6), VI).name == names[1]
    top = level_info(70_000, VI)
    assert (top.value, top.xp_for_next, top.name) == (MAX_LEVEL, 0, names[9])
    assert level_info(0, None).name == {"fr": "Niveau 1", "en": "Level 1"}


# --- §3 Série ------------------------------------------------------------------------------------


def test_streak_read_rule() -> None:
    s = Streak(current=5, longest=5, last_active_date=date(2026, 9, 10))
    assert displayed_current(s, date(2026, 9, 10)) == 5
    assert displayed_current(s, date(2026, 9, 11)) == 5  # hier : pas encore cassée
    assert displayed_current(s, date(2026, 9, 12)) == 0  # un jour manqué, aucune protection
    protected = Streak(current=5, longest=5, last_active_date=date(2026, 9, 10), freezes_available=2)
    assert displayed_current(protected, date(2026, 9, 13)) == 5  # 2 jours manqués couverts
    assert displayed_current(protected, date(2026, 9, 14)) == 0
    frozen = freeze(s, date(2026, 9, 10), date(2026, 9, 20))
    assert displayed_current(frozen, date(2026, 9, 21)) == 5
    assert displayed_current(Streak(), date(2026, 9, 1)) == 0


def test_freeze_not_retroactive_and_cancel() -> None:
    s = Streak(current=8, longest=8, last_active_date=date(2026, 9, 1))
    # Gel déclaré le 5 (jours manqués 2–4 non couverts) : pas de réparation rétroactive.
    late = freeze(s, date(2026, 9, 5), date(2026, 9, 10))
    assert late.frozen_from == date(2026, 9, 5)
    assert record_activity(late, date(2026, 9, 8)).current == 1
    assert displayed_current(late, date(2026, 9, 8)) == 0
    # Gel déclaré le jour même du dernier jour actif : l'absence est couverte.
    ok = freeze(s, date(2026, 9, 1), date(2026, 9, 10))
    assert record_activity(ok, date(2026, 9, 8)).current == 9
    # Annulation : frozenUntil = null.
    cancelled = freeze(ok, date(2026, 9, 3), None)
    assert (cancelled.frozen_until, cancelled.frozen_from) == (None, None)
    assert record_activity(cancelled, date(2026, 9, 8)).current == 1


# --- §3 Badges -----------------------------------------------------------------------------------


def test_new_badges_criteria(tmp_path: Path) -> None:
    assert {"streak_100", "streak_365", "words_500", "no_north_accent", "culture_explorer", "culture_unit"} <= set(
        LEARNING_BADGES
    )
    pack = build_pack(
        tmp_path,
        [{"n": 1}, {"n": 2, "tags": ["culture"]}, {"n": 3}],
        pack_extra={"features": ["tones", "lexical_variants"]},
    )
    base = dict(pack=pack, progress=ProgressState(), streak=Streak(), known_words=0)

    def earned(**kw: object) -> list[str]:
        return evaluate_badges(BadgeInput(**(base | kw)), set())  # type: ignore[arg-type]

    assert earned() == []
    assert "streak_100" in earned(streak=Streak(current=3, longest=100))
    assert "streak_365" not in earned(streak=Streak(current=364, longest=364))
    assert {"words_50", "words_500"} <= set(earned(known_words=500))
    south_ok = [True] * 29 + [False]
    assert "no_north_accent" in earned(south_log=south_ok)  # 29/30 = 96,7 % sur les 30 derniers
    assert "no_north_accent" not in earned(south_log=[True] * 29)  # moins de 30 items
    assert "no_north_accent" not in earned(south_log=[False, False] + [True] * 28)  # 93 %
    assert "culture_explorer" in earned(culture_cards_passed=20)
    assert "culture_explorer" not in earned(culture_cards_passed=19)
    culture_passed = progression.progress_from(pack, {"tp.u02.l01": 1, "tp.u02.l02": 0.8})
    assert "culture_unit" in earned(progress=culture_passed)
    failed = progression.progress_from(pack, {"tp.u02.l01": 1, "tp.u02.l02": 0.5})
    assert "culture_unit" not in earned(progress=failed)
    # Unité culture sautée au placement : réussie aussi (comme `passedUnits` côté client).
    assert "culture_unit" in earned(progress=progression.progress_from(pack, {}, "tp.u03.l01"))
    # Pack sans « tones » ni « lexical_variants » : badges correspondants non applicables.
    plain = build_pack(tmp_path / "plain", [{"n": 1}])
    assert "tone_ear" not in badge_codes_for(plain) and "no_north_accent" not in badge_codes_for(plain)
    assert "no_north_accent" in badge_codes_for(VI)
