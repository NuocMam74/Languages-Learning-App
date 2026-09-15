"""Studio de contenu (contrat Phase 4 §1) : arbre, brouillons, validation, publication, relecture native.

Le contenu est une copie temporaire (schémas + pack `es`) : la publication écrit dans CONTENT_DIR.
Le validateur est remplacé par un double, sauf `test_real_validator_run` (Node + tsx requis).
"""

import json
import shutil
import unicodedata
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import REPO_ROOT, Settings
from app.db import Base
from app.main import create_app
from app.models import ContentDraft, ContentPublication, ContentReview
from app.services import studio
from tests.conftest import STUDIO_PACK as PACK
from tests.conftest import grant_roles, register


class FakeValidator:
    def __init__(self) -> None:
        self.errors: list[dict[str, str]] = []
        self.roots: list[Path] = []
        self.snapshots: list[dict[str, Any]] = []

    def __call__(self, root: Path) -> studio.ValidationReport:
        self.roots.append(root)
        concept = root / PACK / "concepts" / "c_es_adios.json"
        self.snapshots.append(
            {
                "schema": (root / "schema" / "concept.schema.json").is_file(),
                "concept": json.loads(concept.read_text(encoding="utf-8")) if concept.is_file() else None,
                "new_lesson": (root / PACK / "lessons" / "u01" / "l09.json").is_file(),
            }
        )
        return studio.ValidationReport(errors=list(self.errors), warnings=[{"where": PACK, "message": "w"}])


@pytest.fixture
def fake_validator() -> FakeValidator:
    return FakeValidator()


@pytest.fixture
def sclient(studio_settings: Settings, fake_validator: FakeValidator) -> Iterator[TestClient]:
    app = create_app(studio_settings)
    Base.metadata.create_all(app.state.engine)
    app.state.content_validator = fake_validator
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.state.engine.dispose()
    studio.clear_content_caches()


def editor(client: TestClient, *roles: str) -> dict[str, str]:
    headers = register(client)
    grant_roles(client, headers, *(roles or ("editor",)))
    return headers


def concept_doc(content_dir: Path, concept_id: str = "c_es_adios") -> dict[str, Any]:
    data: dict[str, Any] = json.loads((content_dir / PACK / "concepts" / f"{concept_id}.json").read_text("utf-8"))
    return data


def test_packs_and_tree(sclient: TestClient) -> None:
    headers = editor(sclient, "reviewer")
    packs = sclient.get("/studio/packs", headers=headers).json()
    [pack] = packs
    assert pack["code"] == "es" and isinstance(pack["name"], str) and pack["name"] and isinstance(pack["version"], int)

    tree = sclient.get(f"/studio/packs/{PACK}/tree", headers=headers).json()
    [unit] = tree["units"]
    assert unit["id"] == "es.u01" and unit["status"] == "available" and isinstance(unit["title"], str)
    assert [lesson["id"] for lesson in unit["lessons"]] == ["es.u01.l01", "es.u01.l02", "es.u01.l03"]
    assert unit["lessons"][0] == {
        "id": "es.u01.l01",
        "title": "Hola, buenos días",
        "kind": "lesson",
        "reviewed": False,
        "draft": False,
    }
    adios = next(c for c in tree["concepts"] if c["id"] == "c_es_adios")
    assert adios == {"id": "c_es_adios", "vi": "adiós", "reviewed": False, "draft": False}
    assert {c["id"] for c in tree["culture"]} >= {"cc_es_saludos"}
    assert sclient.get("/studio/packs/zz/tree", headers=headers).status_code == 404


def test_draft_lifecycle_and_optimistic_concurrency(sclient: TestClient, content_dir: Path) -> None:
    headers = editor(sclient)
    url = f"/studio/packs/{PACK}/documents/concept/c_es_adios"
    doc = sclient.get(url, headers=headers).json()
    assert doc["kind"] == "concept" and doc["id"] == "c_es_adios"
    assert doc["published"]["vi"] == "adiós" and doc["draft"] is None

    data = {**doc["published"], "note": {"fr": "Salut !", "en": "Bye!"}}
    first = sclient.put(url, headers=headers, json={"data": data, "baseUpdatedAt": None})
    assert first.status_code == 200, first.text
    updated_at = first.json()["updatedAt"]

    # Brouillon créé entre-temps par quelqu'un d'autre : baseUpdatedAt null est périmé.
    assert sclient.put(url, headers=headers, json={"data": data, "baseUpdatedAt": None}).status_code == 409
    second = sclient.put(url, headers=headers, json={"data": data, "baseUpdatedAt": updated_at})
    assert second.status_code == 200, second.text
    assert second.json()["updatedAt"] > updated_at
    stale = sclient.put(url, headers=headers, json={"data": data, "baseUpdatedAt": updated_at})
    assert stale.status_code == 409

    got = sclient.get(url, headers=headers).json()
    assert got["draft"]["data"]["note"]["fr"] == "Salut !"
    assert got["draft"]["updatedBy"] == "Lan"
    tree = sclient.get(f"/studio/packs/{PACK}/tree", headers=headers).json()
    assert next(c for c in tree["concepts"] if c["id"] == "c_es_adios")["draft"] is True

    assert sclient.delete(f"{url}/draft", headers=headers).status_code == 204
    assert sclient.get(url, headers=headers).json()["draft"] is None
    # Brouillon supprimé : une base non nulle est périmée.
    assert sclient.put(url, headers=headers, json={"data": data, "baseUpdatedAt": updated_at}).status_code == 409

    bad = {**data, "id": "c_es_other"}
    assert sclient.put(url, headers=headers, json={"data": bad, "baseUpdatedAt": None}).status_code == 422
    assert sclient.get(f"/studio/packs/{PACK}/documents/concept/bad id!", headers=headers).status_code == 422
    assert sclient.get(f"/studio/packs/{PACK}/documents/unknown/x", headers=headers).status_code == 422
    # Documents uniques : l'id est le code du pack.
    pack_doc = sclient.get(f"/studio/packs/{PACK}/documents/pack/{PACK}", headers=headers).json()
    assert pack_doc["id"] == PACK and pack_doc["published"]["code"] == PACK
    # Le fichier publié n'a pas bougé.
    assert "note" not in concept_doc(content_dir)


def test_validate_overlays_drafts_on_a_copy(sclient: TestClient, fake_validator: FakeValidator) -> None:
    headers = editor(sclient)
    url = f"/studio/packs/{PACK}/documents/concept/c_es_adios"
    data = {**sclient.get(url, headers=headers).json()["published"], "vi": "adiós amigo"}
    sclient.put(url, headers=headers, json={"data": data, "baseUpdatedAt": None})
    lesson = {"id": "es.u01.l09", "unit": "es.u01", "title": {"fr": "Nouvelle"}}
    res = sclient.put(f"/studio/packs/{PACK}/documents/lesson/es.u01.l09", headers=headers, json={"data": lesson})
    assert res.status_code == 200, res.text

    fake_validator.errors = [{"where": "content/es/lessons/u01/l09.json", "message": "/ must have required property"}]
    report = sclient.post(f"/studio/packs/{PACK}/validate", headers=headers)
    assert report.status_code == 200, report.text
    assert report.json() == {
        "errors": [{"where": "content/es/lessons/u01/l09.json", "message": "/ must have required property"}],
        "warnings": [{"where": "es", "message": "w"}],
    }
    [snap] = fake_validator.snapshots
    assert snap["schema"] and snap["new_lesson"]
    assert snap["concept"]["vi"] == "adiós amigo"
    assert fake_validator.roots[0].name == "content"
    assert not fake_validator.roots[0].exists()  # dossier temporaire nettoyé

    # Leçon en brouillon rattachée à son unité dans l'arbre.
    tree = sclient.get(f"/studio/packs/{PACK}/tree", headers=headers).json()
    new = tree["units"][0]["lessons"][-1]
    assert new == {"id": "es.u01.l09", "title": "Nouvelle", "kind": "lesson", "reviewed": False, "draft": True}


def test_publish(sclient: TestClient, content_dir: Path, fake_validator: FakeValidator) -> None:
    headers = editor(sclient)
    reviewer = editor(sclient, "reviewer")
    url = f"/studio/packs/{PACK}/documents/concept/c_es_adios"
    published = sclient.get(url, headers=headers).json()["published"]
    version = json.loads((content_dir / PACK / "pack.json").read_text("utf-8"))["version"]
    decomposed = unicodedata.normalize("NFD", "adiós señor")
    data = {**published, "vi": decomposed}
    sclient.put(url, headers=headers, json={"data": data, "baseUpdatedAt": None})
    body = {"documents": [{"kind": "concept", "id": "c_es_adios"}], "message": "Correction"}

    assert sclient.post(f"/studio/packs/{PACK}/publish", headers=reviewer, json=body).status_code == 403
    missing = {"documents": [{"kind": "concept", "id": "c_es_hola"}], "message": "x"}
    assert sclient.post(f"/studio/packs/{PACK}/publish", headers=headers, json=missing).status_code == 422

    fake_validator.errors = [{"where": "content/es/concepts/c_es_adios.json", "message": "boom"}]
    refused = sclient.post(f"/studio/packs/{PACK}/publish", headers=headers, json=body)
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "validation_failed"
    assert refused.json()["detail"]["errors"][0]["message"] == "boom"
    assert concept_doc(content_dir)["vi"] == "adiós"

    fake_validator.errors = []
    res = sclient.post(f"/studio/packs/{PACK}/publish", headers=headers, json=body)
    assert res.status_code == 200, res.text
    assert res.json() == {"written": ["es/concepts/c_es_adios.json", "es/pack.json"], "packVersion": version + 1}
    raw = (content_dir / PACK / "concepts" / "c_es_adios.json").read_bytes()
    text = raw.decode("utf-8")
    assert b"\r\n" not in raw and text.endswith("}\n")
    assert text.startswith('{\n  "$schema": "../../schema/concept.schema.json",\n  "id": "c_es_adios"')
    assert '"vi": "adiós señor"' in text and text == unicodedata.normalize("NFC", text)
    assert json.loads((content_dir / PACK / "pack.json").read_text("utf-8"))["version"] == version + 1
    assert sclient.get(url, headers=headers).json()["draft"] is None
    assert sclient.get("/studio/packs", headers=headers).json()[0]["version"] == version + 1

    with sclient.app.state.session_factory() as db:  # type: ignore[attr-defined]
        [publication] = db.scalars(select(ContentPublication)).all()
        assert publication.message == "Correction" and publication.pack_version == version + 1
        assert publication.files == ["es/concepts/c_es_adios.json", "es/pack.json"]
        assert db.scalars(select(ContentDraft)).all() == []

    # Brouillon identique au publié : aucun document réécrit, mais chaque publication incrémente la version
    # (contrat parcours §4 : caches serveur et clients indexés par version).
    same = sclient.get(url, headers=headers).json()["published"]
    sclient.put(url, headers=headers, json={"data": same, "baseUpdatedAt": None})
    again = sclient.post(f"/studio/packs/{PACK}/publish", headers=headers, json=body)
    assert again.json() == {"written": ["es/pack.json"], "packVersion": version + 2}


def test_publish_disabled(settings: Settings, content_dir: Path, tmp_path: Path) -> None:
    app = create_app(settings.model_copy(update={"content_dir": content_dir, "studio_media_dir": tmp_path / "m"}))
    Base.metadata.create_all(app.state.engine)
    app.state.content_validator = FakeValidator()
    with TestClient(app, base_url="https://testserver") as client:
        headers = editor(client)
        body = {"documents": [{"kind": "concept", "id": "c_es_adios"}], "message": "x"}
        res = client.post(f"/studio/packs/{PACK}/publish", headers=headers, json=body)
        assert (res.status_code, res.json()["detail"]) == (403, "publish_disabled")
    app.state.engine.dispose()
    studio.clear_content_caches()


def test_review_queue_and_approve(sclient: TestClient, content_dir: Path) -> None:
    reviewer = editor(sclient, "reviewer")
    editor_only = editor(sclient, "editor")
    review_dir = content_dir / PACK / "_review"
    review_dir.mkdir()
    (review_dir / "doubts.json").write_text(
        json.dumps(
            {
                "c_es_adios": ["¿adiós ou chao ?"],
                "es.u01": ["Registre de « usted » ?"],
                "_distractors": ["trop proches"],
            }
        ),
        encoding="utf-8",
    )

    queue = sclient.get(f"/studio/packs/{PACK}/review-queue", headers=reviewer).json()
    kinds = {item["kind"] for item in queue}
    assert {"lesson", "concept", "culture"} <= kinds
    adios = next(i for i in queue if i["id"] == "c_es_adios")
    assert adios == {
        "kind": "concept",
        "id": "c_es_adios",
        "title": "adiós",
        "vi": ["adiós"],
        "doubts": ["¿adiós ou chao ?"],
    }
    lesson = next(i for i in queue if i["id"] == "es.u01.l01")
    assert lesson["title"] == "Hola, buenos días" and isinstance(lesson["vi"], list)

    groups = [i for i in queue if i["kind"] in ("curriculum", "pack")]
    assert groups == [
        {"kind": "pack", "id": "_distractors", "title": "distractors", "vi": [], "doubts": ["trop proches"]},
        {
            "kind": "curriculum",
            "id": "es.u01",
            "title": groups[1]["title"],
            "vi": [],
            "doubts": ["Registre de « usted » ?"],
        },
    ]
    unit_doubts = sclient.get(f"/studio/packs/{PACK}/review-queue?unit=es.u01", headers=reviewer).json()
    assert [i["id"] for i in unit_doubts if i["kind"] in ("curriculum", "pack")] == ["es.u01"]
    only_concepts = sclient.get(f"/studio/packs/{PACK}/review-queue?kind=concept", headers=reviewer).json()
    assert only_concepts and {i["kind"] for i in only_concepts} == {"concept"}
    unit = sclient.get(f"/studio/packs/{PACK}/review-queue?unit=es.u01&kind=culture", headers=reviewer).json()
    assert "cc_es_saludos" in {i["id"] for i in unit}
    assert sclient.get(f"/studio/packs/{PACK}/review-queue?unit=es.u99", headers=reviewer).json() == []

    url = f"/studio/packs/{PACK}/documents/concept/c_es_adios/review"
    assert sclient.post(url, headers=editor_only, json={"verdict": "approve"}).status_code == 403
    changes = sclient.post(url, headers=reviewer, json={"verdict": "changes", "comment": "On dit « chau »"})
    assert changes.status_code == 200
    assert sclient.get(f"/studio/packs/{PACK}/documents/concept/c_es_adios", headers=reviewer).json()["draft"] is None

    res = sclient.post(url, headers=reviewer, json={"verdict": "approve", "comment": "OK"})
    assert res.status_code == 200, res.text
    assert res.json()["reviewedBy"] == "Lan" and res.json()["reviewedAt"]
    draft = sclient.get(f"/studio/packs/{PACK}/documents/concept/c_es_adios", headers=reviewer).json()["draft"]
    assert draft["data"]["reviewed"] is True and draft["data"]["vi"] == "adiós"
    queue = sclient.get(f"/studio/packs/{PACK}/review-queue?kind=concept", headers=reviewer).json()
    assert "c_es_adios" not in {i["id"] for i in queue}

    with sclient.app.state.session_factory() as db:  # type: ignore[attr-defined]
        rows = db.scalars(select(ContentReview).order_by(ContentReview.created_at)).all()
        assert [(r.verdict, r.comment) for r in rows] == [("changes", "On dit « chau »"), ("approve", "OK")]

    assert (
        sclient.post(
            f"/studio/packs/{PACK}/documents/pack/es/review", headers=reviewer, json={"verdict": "approve"}
        ).status_code
        == 422
    )
    missing = f"/studio/packs/{PACK}/documents/concept/c_es_nope/review"
    assert sclient.post(missing, headers=reviewer, json={"verdict": "approve"}).status_code == 404


def test_document_paths() -> None:
    assert studio.default_path("vi-south", "lesson", "vi-south.u03.l02") == "lessons/u03/l02.json"
    assert studio.default_path("vi-south", "exam", "vi-south.exam.a1") == "exams/a1.json"
    assert studio.default_path("vi-south", "concept", "c_ba") == "concepts/c_ba.json"
    assert studio.default_path("vi-south", "curriculum", "vi-south") == "curriculum.json"
    assert studio.schema_ref("lesson", "lessons/u03/l02.json") == "../../../schema/lesson.schema.json"
    for kind, bad in (("lesson", "es.u01.l01"), ("lesson", "vi-south.u01"), ("exam", "other")):
        with pytest.raises(studio.StudioError):
            studio.default_path("vi-south", kind, bad)
    with pytest.raises(studio.StudioError):
        studio.canonical_id("vi-south", "concept", "../../etc")


def _node_tooling() -> bool:
    return shutil.which("npx") is not None and (REPO_ROOT / "node_modules" / "tsx").is_dir()


@pytest.mark.skipif(not _node_tooling(), reason="Node/npx ou tsx indisponible")
def test_real_validator_run(studio_settings: Settings, content_dir: Path, tmp_path: Path) -> None:
    """Exécution réelle de `npx tsx scripts/validate-content.ts --root <copie> --json` sur un brouillon invalide."""
    packs = studio.content_service.load_packs(content_dir)
    pack = packs[PACK]
    published = studio.scan_published(pack.directory, pack.code)
    broken = concept_doc(content_dir) | {"reviewed": "oui"}
    draft = ContentDraft(pack_code=PACK, kind="concept", doc_id="c_es_adios", data=broken)
    report = studio.validate_pack(studio_settings, studio.make_validator(studio_settings), pack, published, [draft])
    assert any(
        e["where"] == "content/es/concepts/c_es_adios.json" and "reviewed" in e["message"] for e in report.errors
    )
    assert isinstance(report.warnings, list)
    studio.clear_content_caches()
