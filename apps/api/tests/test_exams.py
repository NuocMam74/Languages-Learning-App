"""Examens, certificats et vérification publique (contrat Phase 2 §2, contrat parcours §1–§2).

Le contenu du dépôt n'a encore ni audio ni courbe F0 : les tests d'API fournissent les médias par le dossier du
studio (`STUDIO_MEDIA_DIR/<pack>/…`, inclus dans l'index des médias) et ajoutent une référence F0 aux items
`speak_repeat` de l'examen de test. Les items `tone_produce` (courbe portée par le concept, absente) restent non notés.
"""

import copy
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
from app.services.content import concept_documents, load_packs
from app.services.engine import Exercise
from app.services.text import normalize_answer
from tests.conftest import PASSWORD, event
from tests.test_events import post

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "exam_a0.json").read_text(encoding="utf-8"))
PITCH_REF = "pitch/exam_test_ref.json"
PACK = load_packs(REPO_ROOT / "content")["vi-south"]
NAME = "Nguyễn Thị Ánh"


def with_pitch_refs(raw: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(raw)
    for section in out["sections"]:
        for item in section["items"]:
            if item["step"]["type"] == "speak_repeat":
                item["step"]["pitchRef"] = PITCH_REF
    return out


EXAM = exams.parse_exam(with_pitch_refs(FIXTURE))
# Médias « présents » : tout l'audio natif référencé par les concepts de l'examen + la référence F0 de test.
CONCEPTS = concept_documents(PACK)
MEDIA = frozenset(
    {PITCH_REF}
    | {
        track["src"]
        for concept in CONCEPTS.values()
        for track in concept.get("audio", [])
        if track.get("source") == "native"
    }
)
# 25 items − 2 `tone_produce` sans courbe de référence = 23 items notés.
GRADED_WITH_MEDIA = 23


@pytest.fixture
def exam_client(client: TestClient, tmp_path: Path) -> TestClient:
    client.app.dependency_overrides[get_exams] = lambda: {"vi-south": {EXAM.id: EXAM}}  # type: ignore[attr-defined]
    studio = tmp_path / "studio-media"
    for rel in MEDIA:
        target = studio / "vi-south" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"x")
    client.app.state.settings.studio_media_dir = studio  # type: ignore[attr-defined]
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
            "unavailableReason": None,
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

    # Une erreur d'écoute : 22/23 items notés (les 2 `tone_produce` sans courbe ne comptent pas).
    answers = answers_for(body["attemptId"], wrong={("listening", 0)})
    res = exam_client.post(f"/exams/attempts/{body['attemptId']}/submit", headers=auth, json={"answers": answers})
    assert res.status_code == 200, res.text
    result = res.json()
    assert result["passed"] is True
    assert result["global"] == pytest.approx(22 / GRADED_WITH_MEDIA)
    assert result["scores"] == {"listening": 0.875, "reading": 1.0, "vocabulary": 1.0, "speaking": 1.0}
    # Résultat relisible (réponse de `submit` perdue).
    assert exam_client.get(f"/exams/attempts/{body['attemptId']}", headers=auth).json() == result
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
    assert listed["lastAttempt"]["global"] == pytest.approx(22 / GRADED_WITH_MEDIA)
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
    # Items 0–3 : speak_repeat avec référence F0 (notés) ; 4–5 : tone_produce sans courbe (non notés).
    # Score hors bornes : borné à 100 (juste) ; micro refusé : faux ; 59,9 : faux ; type inattendu : faux.
    speaking[0]["response"] = {"kind": "speech", "score": 500}
    speaking[1]["response"] = {"kind": "speech", "score": None}
    speaking[2]["response"] = {"kind": "speech", "score": 59.9}
    speaking[3]["response"] = {"kind": "choice", "optionId": "x"}
    answers.remove(speaking[4])
    res = exam_client.post(f"/exams/attempts/{attempt_id}/submit", headers=auth, json={"answers": answers})
    result = res.json()
    # 1/4 à l'oral < 0,5 : échec malgré 20/23 ≈ 0,87 au global.
    assert result["scores"]["speaking"] == 0.25
    assert result["global"] == pytest.approx(20 / GRADED_WITH_MEDIA)
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
    result = exams.grade(PACK, EXAM, "seed", [], MEDIA)
    assert result.global_score == 0
    assert result.passed is False
    assert result.graded_items == GRADED_WITH_MEDIA
    assert {g["skill"] for g in result.gaps} == set(exams.SKILLS)


def perfect(seed: str) -> list[dict[str, Any]]:
    return [
        {"section": s, "index": i, "response": right_response(ex), "responseMs": 1}
        for (s, i), ex in exams.build_items(PACK, EXAM, seed).items()
    ]


def test_missing_media_items_are_ungraded_and_skills_null() -> None:
    """Contrat parcours §1 : oral sans F0 et écoute tonale sans audio natif retirés du dénominateur."""
    answers = perfect("s")
    no_media = exams.grade(PACK, EXAM, "s", answers, frozenset())
    # Aucun média : 6 items oraux et 4 items d'écoute tonals non notés → 15 notés, oral null.
    assert no_media.graded_items == 15
    assert no_media.scores["speaking"] is None
    assert no_media.scores["listening"] == 1.0
    assert no_media.passed is True  # la compétence sans item noté est exclue de « chaque compétence ≥ 0,5 »
    assert exams.unavailable_reason(PACK, EXAM, frozenset()) is None  # 15 items : encore disponible

    # Oral faux mais non noté (pas de référence F0) : n'empêche pas la réussite.
    wrong_speech = [
        a | {"response": {"kind": "speech", "score": 0}} if a["section"] == "speaking" else a for a in answers
    ]
    assert exams.grade(PACK, EXAM, "s", wrong_speech, frozenset()).passed is True
    # Avec la référence F0, le même oral est noté et fait échouer.
    graded = exams.grade(PACK, EXAM, "s", wrong_speech, MEDIA)
    assert (graded.scores["speaking"], graded.passed) == (0.0, False)

    # Écoute tonale : une paire minimale n'est notée que si chaque audio qu'elle peut jouer existe.
    one_audio = frozenset({"audio/c_ma_ghost_mai.opus"})
    assert ("listening", 6) not in exams.graded_refs(PACK, EXAM, one_audio)
    both = one_audio | {"audio/c_ma_mom_mai.opus"}
    assert ("listening", 6) in exams.graded_refs(PACK, EXAM, both)


def tonal_heavy_exam() -> exams.ExamSpec:
    raw = copy.deepcopy(FIXTURE)
    listening = next(s for s in raw["sections"] if s["skill"] == "listening")
    for item in listening["items"][:2]:
        item["step"] = {"type": "tone_identify", "concept": "c_ma_mom"}
    return exams.parse_exam(raw)


def test_exam_unavailable_when_fewer_than_15_graded_items(exam_client: TestClient) -> None:
    heavy = tonal_heavy_exam()
    assert exams.unavailable_reason(PACK, heavy, frozenset()) == "media_missing"
    assert exams.unavailable_reason(PACK, heavy, MEDIA) is None
    exam_client.app.dependency_overrides[get_exams] = lambda: {"vi-south": {heavy.id: heavy}}  # type: ignore[attr-defined]
    exam_client.app.state.settings.studio_media_dir = Path("does-not-exist")  # type: ignore[attr-defined]
    auth = learner(exam_client)
    complete_unit_tests(exam_client, auth)
    [listed] = exam_client.get("/exams", headers=auth).json()
    assert (listed["unlocked"], listed["unavailableReason"]) == (True, "media_missing")
    res = exam_client.post(f"/exams/{heavy.id}/start", headers=auth)
    assert (res.status_code, res.json()) == (409, {"detail": "media_missing"})


def test_exam_requires_passed_unit_tests(exam_client: TestClient) -> None:
    """Contrat parcours §2 : un test d'unité sous 0,7 ne compte pas pour les examens."""
    auth = learner(exam_client)
    lesson_ids = [lid for unit in EXAM.requires_units for lid in exams.unit_test_lessons(PACK, unit)]
    post(
        exam_client,
        auth,
        [
            event("lesson_completed", {"sessionId": "s", "lessonId": lid, "score": 0.69, "durationMs": 1})
            for lid in lesson_ids
        ],
    )
    assert exam_client.get("/exams", headers=auth).json()[0]["unlocked"] is False
    assert exam_client.post(f"/exams/{EXAM.id}/start", headers=auth).status_code == 403
    post(
        exam_client,
        auth,
        [event("lesson_completed", {"sessionId": "s", "lessonId": lesson_ids[0], "score": 0.7, "durationMs": 1})]
        + [
            event("lesson_completed", {"sessionId": "s", "lessonId": lid, "score": 0.95, "durationMs": 1})
            for lid in lesson_ids[1:]
        ],
    )
    assert exam_client.get("/exams", headers=auth).json()[0]["unlocked"] is True


def test_exam_unlocked_by_placement_skip(exam_client: TestClient) -> None:
    auth = learner(exam_client)
    placement = event(
        "placement_completed",
        {"levelEstimate": 3, "entryLessonId": "vi-south.u07.l01", "correct": 8, "total": 8, "knownConceptIds": []},
    )
    post(exam_client, auth, [placement])
    assert exam_client.get("/exams", headers=auth).json()[0]["unlocked"] is True


def test_certificate_lookup_is_per_pack(client: TestClient) -> None:
    from app.models import Certificate, User
    from app.services.certificates import issue_certificate

    auth = learner(client)
    user_id = client.get("/me", headers=auth).json()["user"]["id"]
    now = datetime.now(UTC)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        user = db.get(User, user_id)
        attempt = ExamAttempt(user_id=user_id, exam_id=None, started_at=now)
        es = issue_certificate(db, user, "es", EXAM, attempt, {"listening": 1.0}, now)  # type: ignore[arg-type]
        vi = issue_certificate(db, user, "vi-south", EXAM, attempt, {"listening": 1.0}, now)  # type: ignore[arg-type]
        again = issue_certificate(db, user, "vi-south", EXAM, attempt, {"listening": 1.0}, now)  # type: ignore[arg-type]
        assert es.id != vi.id and again.id == vi.id
        assert {c.course_id for c in db.query(Certificate).all()} == {"es", "vi-south"}


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
