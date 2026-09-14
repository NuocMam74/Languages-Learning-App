"""Le portage Python de south-lint passe exactement les cas partagés avec le TypeScript."""

import json

import pytest

from app.config import REPO_ROOT
from app.south_lint import has_blocking, load_linter

CASES = json.loads((REPO_ROOT / "packages/south-lint/cases.json").read_text(encoding="utf-8"))
lint = load_linter(REPO_ROOT / "content/vi-south/lexical-variants.json")


@pytest.mark.parametrize("case", CASES, ids=[c["text"] for c in CASES])
def test_shared_cases(case: dict[str, object]) -> None:
    assert [f.entry_id for f in lint(str(case["text"]))] == case["expect"]


def test_finding_details() -> None:
    [finding] = lint("Đây là bố tôi.")
    assert finding.found == "bố"
    assert finding.suggestions == ("ba",)
    assert finding.severity == "error"
    assert (finding.start, finding.end) == (7, 9)
    assert has_blocking([finding])


def test_nfd_input_is_normalized() -> None:
    import unicodedata

    assert [f.entry_id for f in lint(unicodedata.normalize("NFD", "Mẹ ơi!"))] == ["lv_maman"]
    assert not has_blocking(lint("Mẹ ơi!"))  # avertissement seulement
