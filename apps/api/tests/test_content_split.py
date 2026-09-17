"""Découpage du contenu (core.json + unités) : parité avec packages/core et routes `/content` (audit mobile P1 #6)."""

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Base
from app.main import create_app
from app.services.content_split import merge_split, split_pack, utf8_bytes

FIXTURE = Path(__file__).parent / "fixtures" / "content_split_parity.json"
REPO_ROOT = Path(__file__).resolve().parents[3]


def _sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def test_split_matches_typescript_byte_for_byte() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    core, units = split_pack(data["input"], lambda path: int(data["mediaSizes"].get(path, 0)))
    expected = data["expected"]
    assert core["units"] == expected["units"]
    assert len(core["lessonIndex"]) == expected["lessonIndex"]
    assert [c.get("unit") for c in core["conceptIndex"]] == expected["conceptUnits"]
    assert [_sha(u) for u in units] == expected["unitsSha256"]
    assert _sha(core) == expected["coreSha256"]


def test_split_round_trip_and_rules() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw = data["input"]
    core, units = split_pack(raw)
    merged = merge_split(core, units)
    assert merged["lessons"] == raw["lessons"]
    assert merged["concepts"] == raw["concepts"]
    assert {c["id"]: c for c in merged["culture"]} == {c["id"]: c for c in raw["culture"]}
    # Carte culture citée : dans l'unité de la leçon. Concept complet : dans une seule unité.
    for unit in units:
        cards = {c["id"] for c in unit["culture"]}
        for lesson in unit["lessons"]:
            assert all(s["ref"] in cards for s in lesson["steps"] if s["type"] == "culture_card")
    homes = [c["id"] for u in units for c in u["concepts"]]
    assert sorted(homes) == sorted(c["id"] for c in raw["concepts"])
    assert all(entry["bytes"] == utf8_bytes(u) for entry, u in zip(core["units"], units, strict=True))
    assert all("steps" not in summary for summary in core["lessonIndex"])


@pytest.fixture
def split_client(settings: Settings, tmp_path: Path) -> Any:
    root = tmp_path / "content"
    shutil.copytree(REPO_ROOT / "content" / "es", root / "es")
    (root / "es" / "audio").mkdir(exist_ok=True)
    (root / "es" / "audio" / "hola.opus").write_bytes(b"ogg-data")
    app = create_app(settings.model_copy(update={"content_dir": root, "default_course": "es"}))
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://testserver") as c:
        yield c, root
    app.state.engine.dispose()


def test_core_and_unit_routes_follow_published_version(split_client: Any) -> None:
    client, root = split_client
    version = client.get("/content/es/latest.json").json()["version"]
    core = client.get(f"/content/es/v{version}/core.json").json()
    bundle = client.get(f"/content/es/v{version}/bundle.json").json()
    assert core["format"] == 2 and core["pack"]["version"] == version
    assert {"lessonIndex", "conceptIndex", "mediaIndex", "exams", "placement", "games", "units"} <= set(core)
    assert core["mediaIndex"] == bundle["mediaIndex"]

    units = []
    for entry in core["units"]:
        res = client.get(f"/content/es/v{version}/units/{entry['id']}.json")
        assert res.status_code == 200
        unit = res.json()
        assert unit["unit"] == entry["id"] and unit["version"] == version
        assert entry["bytes"] == len(res.content)
        assert entry["mediaBytes"] == sum(
            len(b"ogg-data") if p == "audio/hola.opus" else (root / "es" / p).stat().st_size for p in unit["media"]
        )
        units.append(unit)
    # Parité avec le bundle : recomposer les unités redonne exactement les leçons et concepts servis.
    merged = merge_split(core, units)
    assert merged["lessons"] == bundle["lessons"] and merged["concepts"] == bundle["concepts"]
    assert client.get(f"/content/es/v{version}/units/inconnue.json").status_code == 404

    # Publication (autre worker) : l'ancienne version n'est plus servie, la nouvelle l'est.
    pack_file = root / "es" / "pack.json"
    data = json.loads(pack_file.read_text(encoding="utf-8"))
    data["version"] = version + 1
    pack_file.write_text(json.dumps(data), encoding="utf-8")
    assert client.get(f"/content/es/v{version}/core.json").status_code == 404
    assert client.get(f"/content/es/v{version}/units/{core['units'][0]['id']}.json").status_code == 404
    fresh = client.get(f"/content/es/v{version + 1}/core.json").json()
    assert fresh["pack"]["version"] == version + 1
    assert (
        client.get(f"/content/es/v{version + 1}/units/{fresh['units'][0]['id']}.json").json()["version"] == version + 1
    )
