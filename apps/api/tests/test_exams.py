"""Examens, certificats et vérification publique (contrat Phase 2 §2)."""

import io
import json
import unicodedata
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.config import REPO_ROOT
from app.deps import get_exams
from app.models import ExamAttempt
from app.services import exams
from app.services.certificates import CROCKFORD, normalize_code
from app.services.content import load_packs
from app.services.engine import Exercise
from app.services.text import normalize_answer
from tests.conftest import PASSWORD, event
from tests.test_events import post

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "exam_a0.json").read_text(encoding="utf-8"))
EXAM = exams.parse_exam(FIXTURE)
PACK = load_packs(REPO_ROOT / "content")["vi-south"]
NAME = "Nguyễn Thị Ánh"


@pytest.fixture
def exam_client(client: TestClient) -> TestClient:
    client.app.dependency_overrides[get_exams] = lambda: {"vi-south": {EXAM.id: EXAM}}  # type: ignore[attr-defined]
    return client


def learner(client: TestClient, name: str = NAME) -> dict[str, str]:
    res = client.post(
        "/auth/register",
        json={"email": f"x-{uuid.uuid4().hex[:8]}@example.com", "password": PASSWORD, "displayName": name},
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


def complete_unit_tests(client: TestClient, auth: dict[str, str]) -> None:
    lesson_ids = [lid for unit in EXAM.requires_units for lid in exams.unit_test_lessons(PACK, unit)]
    assert len(lesson_ids) == 4
    post(
        client,
        auth,
        [
            event("lesson_completed", {"sessionId": "s", "lessonId": lid, "score": 1, "durationMs": 1000})
            for lid in lesson_ids
        ],
    )


def right_response(exercise: Exercise) -> dict[str, Any]:
    if exercise.is_choice:
        return {"kind": "choice", "optionId": exercise.answer_id}
    if exercise.type == "build_sentence":
        remaining = normalize_answer(exercise.target or "")
        ids: list[str] = []
        tokens = sorted(exercise.tokens, key=lambda t: -len(t.text or ""))
        while remaining:
            token = next(
                t
                for t in tokens
                if t.id not in ids
                and (
                    remaining == normalize_answer(t.text or "")
                    or remaining.startswith(normalize_answer(t.text or "") + " ")
                )
            )
            ids.append(token.id)
            remaining = remaining[len(normalize_answer(token.text or "")) :].strip()
        return {"kind": "tokens", "optionIds": ids}
    return {"kind": "speech", "score": 88}


def answers_for(attempt_id: str, wrong: set[tuple[str, int]] = frozenset()) -> list[dict[str, Any]]:  # type: ignore[assignment]
    out = []
    for (skill, index), exercise in exams.build_items(PACK, EXAM, attempt_id).items():
        response = {"kind": "skip"} if (skill, index) in wrong else right_response(exercise)
        out.append({"section": skill, "index": index, "response": response, "responseMs": 1500})
    return out


def test_fixture_exam_matches_contract() -> None:
    assert len(EXAM.items()) == 25
    assert all(len(s["items"]) >= 4 for s in EXAM.sections)


def test_exams_locked_until_unit_tests_done(exam_client: TestClient) -> None:
    auth = learner(exam_client)
    listed = exam_client.get("/exams", headers=auth).json()
    assert listed == [
        {
            "id": "vi-south.exam.a0",
            "level": "A0",
            "certificate": {"fr": "A0 Bén rễ", "en": "A0 Bén rễ"},
            "requiresUnits": EXAM.requires_units,
            "durationMinutes": 15,
            "unlocked": False,
            "lastAttempt": None,
            "nextAttemptAt": None,
        }
    ]
    res = exam_client.post(f"/exams/{EXAM.id}/start", headers=auth)
    assert (res.status_code, res.json()) == (403, {"detail": "locked_units"})
    assert exam_client.post("/exams/vi-south.exam.zz/start", headers=auth).status_code == 404
    complete_unit_tests(exam_client, auth)
    assert exam_client.get("/exams", headers=auth).json()[0]["unlocked"] is True


def test_pass_exam_issue_certificate_pdf_and_verify(exam_client: TestClient) -> None:
    auth = learner(exam_client)
    complete_unit_tests(exam_client, auth)

    start = exam_client.post(f"/exams/{EXAM.id}/start", headers=auth)
    assert start.status_code == 201, start.text
    body = start.json()
    assert body["seed"] == body["attemptId"]
    assert body["items"][0] == {"section": "listening", "index": 0}
    assert len(body["items"]) == 25
    started = datetime.fromisoformat(body["startedAt"])
    assert datetime.fromisoformat(body["expiresAt"]) - started == timedelta(minutes=15)
    # Reprise : même tentative tant qu'elle n'est ni soumise ni expirée.
    assert exam_client.post(f"/exams/{EXAM.id}/start", headers=auth).json()["attemptId"] == body["attemptId"]

    # Une erreur d'écoute : 24/25 = 0,96.
    answers = answers_for(body["attemptId"], wrong={("listening", 0)})
    res = exam_client.post(f"/exams/attempts/{body['attemptId']}/submit", headers=auth, json={"answers": answers})
    assert res.status_code == 200, res.text
    result = res.json()
    assert result["passed"] is True
    assert result["global"] == 0.96
    assert result["scores"] == {"listening": 0.875, "reading": 1.0, "vocabulary": 1.0, "speaking": 1.0}
    listening_step = EXAM.sections[0]["items"][0]["step"]
    assert result["gaps"] == [{"skill": "listening", "conceptIds": [listening_step["concept"]]}]
    code = result["certificate"]["verificationCode"]
    assert len(code) == 10 and set(code) <= set(CROCKFORD)

    again = exam_client.post(f"/exams/attempts/{body['attemptId']}/submit", headers=auth, json={"answers": answers})
    assert again.status_code == 409

    locked = exam_client.post(f"/exams/{EXAM.id}/start", headers=auth)
    assert locked.status_code == 409
    assert locked.json()["detail"] == "retry_locked"
    assert datetime.fromisoformat(locked.json()["nextAttemptAt"]) > datetime.now(UTC) + timedelta(hours=47)
    listed = exam_client.get("/exams", headers=auth).json()[0]
    assert listed["lastAttempt"]["passed"] is True
    assert listed["lastAttempt"]["scores"]["listening"] == 0.875
    assert listed["nextAttemptAt"] is not None

    certs = exam_client.get("/certificates", headers=auth).json()
    assert len(certs) == 1
    cert = certs[0]
    assert cert["verificationCode"] == code
    assert cert["pdfUrl"] == f"/certificates/{cert['id']}.pdf"
    assert cert["shareImageUrl"] is None

    pdf = exam_client.get(cert["pdfUrl"], headers=auth)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    text = unicodedata.normalize("NFC", PdfReader(io.BytesIO(pdf.content)).pages[0].extract_text())
    assert NAME in text
    assert code in text
    assert "A0 Bén rễ" in text
    assert f"https://parlo.test/verifier/{code}" in text
    assert exam_client.get(cert["pdfUrl"], headers=learner(exam_client, "Autre")).status_code == 404
    assert exam_client.get(cert["pdfUrl"]).status_code == 401

    verified = exam_client.get(f"/verify/{code.lower()}")
    assert verified.status_code == 200
    assert verified.json() == {
        "valid": True,
        "displayName": NAME,
        "level": "A0",
        "certificate": {"fr": "A0 Bén rễ", "en": "A0 Bén rễ"},
        "issuedAt": verified.json()["issuedAt"],
        "scores": result["scores"],
    }
    missing = exam_client.get("/verify/ZZZZZZZZZZ")
    assert (missing.status_code, missing.json()) == (404, {"valid": False})


def test_failed_exam_gaps_speech_rules_and_no_certificate(exam_client: TestClient) -> None:
    auth = learner(exam_client)
    complete_unit_tests(exam_client, auth)
    attempt_id = exam_client.post(f"/exams/{EXAM.id}/start", headers=auth).json()["attemptId"]
    answers = answers_for(attempt_id)
    speaking = [a for a in answers if a["section"] == "speaking"]
    # Score hors bornes : borné à 100 (juste) ; micro refusé : faux ; 59,9 : faux ; absent : faux.
    speaking[0]["response"] = {"kind": "speech", "score": 500}
    speaking[1]["response"] = {"kind": "speech", "score": None}
    speaking[2]["response"] = {"kind": "speech", "score": 59.9}
    speaking[3]["response"] = {"kind": "choice", "optionId": "x"}
    answers.remove(speaking[4])
    res = exam_client.post(f"/exams/attempts/{attempt_id}/submit", headers=auth, json={"answers": answers})
    result = res.json()
    # 2/6 à l'oral < 0,5 : échec malgré 21/25 = 0,84 au global.
    assert result["scores"]["speaking"] == 2 / 6
    assert result["global"] == 0.84
    assert result["passed"] is False
    assert result["certificate"] is None
    assert [g["skill"] for g in result["gaps"]] == ["speaking"]
    assert exam_client.get("/certificates", headers=auth).json() == []


def test_expired_attempt_is_gone(exam_client: TestClient) -> None:
    auth = learner(exam_client)
    complete_unit_tests(exam_client, auth)
    attempt_id = exam_client.post(f"/exams/{EXAM.id}/start", headers=auth).json()["attemptId"]
    with exam_client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        attempt = db.get(ExamAttempt, attempt_id)
        attempt.started_at -= timedelta(minutes=18)
        attempt.expires_at -= timedelta(minutes=18)
        db.commit()
    res = exam_client.post(f"/exams/attempts/{attempt_id}/submit", headers=auth, json={"answers": []})
    assert res.status_code == 410
    # Tentative expirée non soumise : pas de verrou de 48 h, une nouvelle tentative démarre.
    fresh = exam_client.post(f"/exams/{EXAM.id}/start", headers=auth)
    assert fresh.status_code == 201
    assert fresh.json()["attemptId"] != attempt_id
    other = learner(exam_client)
    assert (
        exam_client.post(f"/exams/attempts/{attempt_id}/submit", headers=other, json={"answers": []}).status_code == 404
    )


def test_grading_within_grace_and_missing_answers_wrong() -> None:
    result = exams.grade(PACK, EXAM, "seed", [])
    assert result.global_score == 0
    assert result.passed is False
    assert {g["skill"] for g in result.gaps} == set(exams.SKILLS)


def test_load_exams_is_robust(tmp_path: Path) -> None:
    from dataclasses import replace

    pack = replace(PACK, directory=tmp_path)
    assert exams.load_exams(pack) == {}
    (tmp_path / "exams").mkdir()
    (tmp_path / "exams" / "a0.json").write_text(json.dumps(FIXTURE), encoding="utf-8")
    (tmp_path / "exams" / "broken.json").write_text("{", encoding="utf-8")
    (tmp_path / "exams" / "partial.json").write_text('{"id": "x"}', encoding="utf-8")
    assert list(exams.load_exams(pack)) == [EXAM.id]


def test_real_exam_files_are_gradable() -> None:
    """Les examens publiés dans content/ (s'il y en a) se construisent avec le moteur Python."""
    for exam in exams.load_exams(PACK).values():
        assert len(exams.build_items(PACK, exam, "check")) == len(exam.items())


def test_normalize_code() -> None:
    assert normalize_code(" abcd-efgh-io ") == "ABCDEFGH10"
