"""Plusieurs packs (contrat Phase 3 §5) et nouveaux événements (§4). Pack `es` de test (fixture), pas celui du dépôt."""

import json
import shutil
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.db import Base
from app.main import create_app
from app.services.content import course_code_of_concept
from tests.conftest import event, register
from tests.test_challenges import current, use_challenge
from tests.test_events import card, me, post, session_completed

ES_LESSONS = ("es.u01.l01", "es.u01.l02")


def _write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _es_pack(root: Path) -> None:
    _write(
        root / "pack.json",
        {
            "code": "es",
            "lang": "es",
            "variant": "latam",
            "name": {"fr": "Espagnol", "en": "Spanish"},
            "version": 1,
            "script": "latin",
            "direction": "ltr",
            "features": [],
            "voices": [{"id": "lucia", "label": "Lucía", "gender": "f", "accent": "CDMX"}],
            "interfaceLocales": ["fr", "en"],
        },
    )
    _write(
        root / "curriculum.json",
        {
            "pack": "es",
            "blocks": [],
            "units": [
                {"id": "es.u01", "title": {"fr": "U1", "en": "U1"}, "status": "available", "lessons": ES_LESSONS}
            ],
            "paths": {},
        },
    )
    for i, lesson_id in enumerate(ES_LESSONS):
        _write(
            root / "lessons" / "u01" / f"l0{i + 1}.json",
            {
                "id": lesson_id,
                "unit": "es.u01",
                "title": {"fr": f"Leçon {i + 1}", "en": f"Lesson {i + 1}"},
                "estimatedMinutes": 4,
                "prerequisites": list(ES_LESSONS[:i]),
                "concepts": ["c_es_hola"],
                "steps": [],
                "review": {"srsIntroduce": ["c_es_hola"]},
            },
        )
    _write(
        root / "concepts" / "c_es_hola.json",
        {"id": "c_es_hola", "type": "word", "es": "hola", "gloss": {"fr": "bonjour", "en": "hello"}},
    )


@pytest.fixture(scope="session")
def content_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("content")
    shutil.copytree(
        REPO_ROOT / "content" / "vi-south",
        root / "vi-south",
        ignore=lambda _d, names: [n for n in names if "." in n and not n.endswith(".json")],
    )
    _es_pack(root / "es")
    (root / "broken").mkdir()
    (root / "broken" / "pack.json").write_text('{"code": "broken"}', encoding="utf-8")  # pack en cours d'écriture
    return root


@pytest.fixture
def mp_client(settings: Settings, content_dir: Path) -> Iterator[TestClient]:
    settings.content_dir = content_dir
    settings.serve_content = False
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.state.engine.dispose()


def switch(to: str, from_: str | None = "vi-south") -> dict[str, Any]:
    return event("pack_switched", {"fromPack": from_, "toPack": to})


def test_concept_pack_prefixes() -> None:
    codes = ["es", "vi-south"]
    assert course_code_of_concept("es_hola", codes, "vi-south") == "es"
    assert course_code_of_concept("c_es_hola", codes, "vi-south") == "es"
    assert course_code_of_concept("c_ba", codes, "vi-south") == "vi-south"
    assert course_code_of_concept("c_essai", codes, "vi-south") == "vi-south"


def test_courses_list_both_packs_and_skip_incomplete(mp_client: TestClient) -> None:
    codes = sorted(c["code"] for c in mp_client.get("/courses").json())
    assert codes == ["es", "vi-south"]
    es = next(c for c in mp_client.get("/courses").json() if c["code"] == "es")
    assert es["features"] == []


def test_pack_switched_changes_current_enrollment(mp_client: TestClient) -> None:
    auth = register(mp_client)
    result = post(mp_client, auth, [switch("es"), switch("zz")])
    assert [r["reason"] for r in result["rejected"]] == ["unknown_course"]
    state = me(mp_client, auth)
    assert state["enrollment"]["courseCode"] == "es"
    assert state["enrollment"]["currentLessonId"] == "es.u01.l01"
    assert sorted(e["courseCode"] for e in state["enrollments"]) == ["es", "vi-south"]

    post(mp_client, auth, [switch("vi-south", "es")])
    assert me(mp_client, auth)["enrollment"]["courseCode"] == "vi-south"
    bad = event("pack_switched", {"fromPack": None, "toPack": ""})
    assert post(mp_client, auth, [bad])["rejected"][0]["reason"].startswith("invalid")


def test_events_apply_to_the_pack_of_their_ids(mp_client: TestClient) -> None:
    auth = register(mp_client)
    t0 = datetime.now(UTC) - timedelta(minutes=5)
    answer = event(
        "answer_submitted",
        {
            "sessionId": "es-s1",
            "lessonId": "es.u01.l01",
            "stepIndex": 0,
            "exerciseType": "listen_pick_text",
            "conceptIds": ["c_es_hola"],
            "correct": True,
            "nearMiss": False,
            "responseMs": 900,
            "attempt": 1,
        },
        t0,
    )
    done_payload = {"sessionId": "es-s1", "lessonId": "es.u01.l01", "score": 1, "durationMs": 1000}
    done = event("lesson_completed", done_payload, t0 + timedelta(seconds=1))
    completed = session_completed("es-s1", "2026-09-15", xp=25, when=t0 + timedelta(seconds=2))
    result = post(mp_client, auth, [answer, done, completed])
    assert result["rejected"] == []
    post(mp_client, auth, [session_completed("vi-s1", "2026-09-15", xp=7)])

    state = me(mp_client, auth)
    by_pack = {e["courseCode"]: e for e in state["enrollments"]}
    assert by_pack["es"]["xpTotal"] == 25 and by_pack["es"]["currentLessonId"] == "es.u01.l02"
    assert by_pack["vi-south"]["xpTotal"] == 7  # séance sans réponse : inscription courante
    assert state["enrollment"]["courseCode"] == "vi-south"


def test_session_next_per_pack(mp_client: TestClient) -> None:
    auth = register(mp_client)
    due = "2026-01-01T00:00:00.000Z"
    es_card = {**card(3, due), "conceptId": "c_es_hola"}
    post(
        mp_client,
        auth,
        [event("srs_card_updated", {"card": card(3, due)}), event("srs_card_updated", {"card": es_card})],
    )

    es = mp_client.get("/me/session/next?pack=es", headers=auth)
    assert es.status_code == 200, es.text
    plan = es.json()
    assert plan["courseCode"] == "es"
    reviews = [b for b in plan["blocks"] if b["kind"] == "review"]
    assert reviews and reviews[0]["conceptIds"] == ["c_es_hola"]
    assert {"kind": "new", "lessonId": "es.u01.l01"} in plan["blocks"]

    vi = mp_client.get("/me/session/next", headers=auth).json()
    assert vi["courseCode"] == "vi-south"
    assert [b["conceptIds"] for b in vi["blocks"] if b["kind"] == "review"] == [["c_ba"]]
    assert mp_client.get("/me/session/next?pack=zz", headers=auth).status_code == 404
    assert sorted(e["courseCode"] for e in me(mp_client, auth)["enrollments"]) == ["es", "vi-south"]


def test_tutor_conversation_unavailable_for_non_vietnamese_pack(mp_client: TestClient) -> None:
    auth = register(mp_client)
    post(mp_client, auth, [switch("es")])
    res = mp_client.post("/tutor/conversations", headers=auth, json={"mode": "free"})
    assert (res.status_code, res.json()["detail"]) == (409, "tutor_unavailable")


def test_conversation_turn_counts_for_speaking_challenge(client: TestClient, auth: dict[str, str]) -> None:
    use_challenge(client, "speaking_minutes", 5)
    today = datetime.now(UTC).date().isoformat()
    turn = {"conversationId": "c1", "mode": "doi_dap", "words": 4, "responseMs": 3500, "localDate": today}
    turns = [event("conversation_turn", turn) for _ in range(5)]
    bad = event("conversation_turn", {**turn, "mode": "chat"})
    result = post(client, auth, [*turns, bad])
    assert len(result["accepted"]) == 5
    assert result["rejected"][0]["reason"].startswith("invalid")
    assert current(client, auth)["progress"] == 1  # 5 × 20 s = 100 s → 1 min
