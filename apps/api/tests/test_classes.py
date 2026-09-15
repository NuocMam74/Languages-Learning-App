"""Espace enseignant (contrat Phase 4 §2) : classes, consentement, progression, devoirs, confidentialité."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models import Exam, ExamAttempt
from app.services import classes
from tests.conftest import event, grant_roles, register, user_id_of
from tests.test_events import post, session_completed

PACK = "vi-south"


def teacher(client: TestClient, name: str = "Cô Hạnh") -> dict[str, str]:
    headers = register(client)
    user_id = grant_roles(client, headers, "teacher")
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        from app.models import User

        user = db.get(User, user_id)
        assert user is not None
        user.display_name = name
        db.commit()
    return headers


def create_class(client: TestClient, headers: dict[str, str], name: str = "CM2 Lotus") -> dict[str, Any]:
    res = client.post("/classes", headers=headers, json={"name": name, "packCode": PACK})
    assert res.status_code == 201, res.text
    body: dict[str, Any] = res.json()
    return body


def join(client: TestClient, headers: dict[str, str], code: str) -> Any:
    return client.post(f"/classes/join/{code}", headers=headers, json={"consent": True})


def answer(concept: str, correct: bool, when: datetime) -> dict[str, Any]:
    return event(
        "answer_submitted",
        {
            "sessionId": "s1",
            "lessonId": f"{PACK}.u01.l01",
            "stepIndex": 1,
            "exerciseType": "tone_identify",
            "conceptIds": [concept],
            "correct": correct,
            "nearMiss": False,
            "responseMs": 1200,
            "attempt": 1,
        },
        when,
    )


def lesson_completed(lesson_id: str) -> dict[str, Any]:
    return event("lesson_completed", {"sessionId": "s1", "lessonId": lesson_id, "score": 0.9, "durationMs": 300000})


def test_join_codes() -> None:
    for _ in range(50):
        code = classes.generate_code()
        assert len(code) == 6 and set(code) <= set(classes.CROCKFORD_ALPHABET)
    assert classes.normalize_code("ab-cd1o") == "ABCD10"
    assert classes.normalize_code("ABCDEU") is None
    assert classes.normalize_code("ABC") is None


def test_create_list_join_and_privacy(client: TestClient) -> None:
    prof = teacher(client)
    learner = register(client)
    assert client.post("/classes", headers=learner, json={"name": "x", "packCode": PACK}).status_code == 403
    assert client.post("/classes", headers=prof, json={"name": "x", "packCode": "zz"}).status_code == 422
    assert client.get("/classes", headers=learner).status_code == 403

    created = create_class(client, prof)
    assert set(created) == {"id", "name", "joinCode", "packCode"}
    code = created["joinCode"]
    assert len(code) == 6 and created["packCode"] == PACK

    no_consent = client.post(f"/classes/join/{code}", headers=learner, json={"consent": False})
    assert (no_consent.status_code, no_consent.json()["detail"]) == (400, "consent_required")
    assert client.post(f"/classes/join/{code}", headers=learner).status_code == 400
    assert join(client, prof, code).status_code == 409  # sa propre classe
    assert join(client, learner, "ZZZZZZ").status_code == 404

    joined = join(client, learner, code.lower())
    assert joined.status_code == 200, joined.text
    assert joined.json() == {"classId": created["id"], "name": "CM2 Lotus", "teacherName": "Cô Hạnh"}
    assert join(client, learner, code).status_code == 200  # idempotent

    listed = client.get("/classes", headers=prof).json()
    assert listed == [{**created, "studentCount": 1}]
    other_prof = teacher(client, "M. Tâm")
    assert client.get("/classes", headers=other_prof).json() == []
    assert client.get(f"/classes/{created['id']}", headers=other_prof).status_code == 404

    detail = client.get(f"/classes/{created['id']}", headers=prof)
    assert detail.status_code == 200
    assert "@" not in detail.text and "email" not in detail.text  # jamais l'email
    [student] = detail.json()["students"]
    assert student["displayName"] == "Lan" and student["id"] == user_id_of(client, learner)

    mine = client.get("/me/classes", headers=learner).json()
    assert mine == [{"id": created["id"], "name": "CM2 Lotus", "teacherName": "Cô Hạnh", "assignments": []}]
    assert "@" not in client.get("/me/classes", headers=learner).text


def test_student_progress(client: TestClient) -> None:
    prof = teacher(client)
    learner = register(client)
    klass = create_class(client, prof)
    join(client, learner, klass["joinCode"])
    now = datetime.now(UTC)

    post(client, learner, [session_completed("a", now.date().isoformat(), xp=40)])
    post(client, learner, [lesson_completed(f"{PACK}.u01.l01"), lesson_completed(f"{PACK}.u01.l02")])
    events = [answer("c_ma_mom", False, now - timedelta(minutes=i)) for i in range(3)]
    events += [answer("c_ma_mom", True, now - timedelta(minutes=5))]
    events += [answer("c_ma_ghost", False, now - timedelta(minutes=6)), answer("c_ma_ghost", True, now)]
    events += [answer("c_ma_but", False, now - timedelta(days=40)) for _ in range(3)]  # hors fenêtre
    post(client, learner, events)

    learner_id = user_id_of(client, learner)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        db.add(Exam(id="vi-south.exam.a0", course_id=PACK, level="A0", spec_json={}))
        db.add(
            ExamAttempt(
                user_id=learner_id,
                exam_id="vi-south.exam.a0",
                started_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(minutes=30),
                passed=True,
                score_json={"global": 0.84, "scores": {}},
            )
        )
        db.commit()

    [student] = client.get(f"/classes/{klass['id']}", headers=prof).json()["students"]
    assert student["lastActiveDate"] == now.date().isoformat()
    assert student["streak"] == 1
    assert student["xpWeek"] >= 40
    assert student["lessonsCompleted"] == 2
    assert student["currentLessonId"] == f"{PACK}.u01.l03"
    assert student["weakConcepts"] == [{"id": "c_ma_mom", "vi": "má", "errorRate": 0.75}]
    assert student["exams"] == [{"level": "A0", "passed": True, "global": 0.84}]
    assert set(student) == {
        "id",
        "displayName",
        "joinedAt",
        "lastActiveDate",
        "streak",
        "xpWeek",
        "lessonsCompleted",
        "currentLessonId",
        "weakConcepts",
        "exams",
    }


def test_assignments(client: TestClient) -> None:
    prof = teacher(client)
    alice = register(client)
    bob = register(client)
    klass = create_class(client, prof)
    for s in (alice, bob):
        join(client, s, klass["joinCode"])
    url = f"/classes/{klass['id']}/assignments"

    assert client.post(url, headers=prof, json={"title": "x"}).status_code == 422
    both = {"title": "x", "lessonIds": [f"{PACK}.u01.l01"], "unitId": f"{PACK}.u01"}
    assert client.post(url, headers=prof, json=both).status_code == 422
    unknown = client.post(url, headers=prof, json={"title": "x", "lessonIds": ["vi-south.u99.l01"]})
    assert unknown.status_code == 422
    assert client.post(url, headers=prof, json={"title": "x", "unitId": "vi-south.u99"}).status_code == 422
    assert client.post(url, headers=alice, json={"title": "x", "unitId": f"{PACK}.u01"}).status_code == 403

    two = client.post(
        url,
        headers=prof,
        json={"title": "Tons", "lessonIds": [f"{PACK}.u01.l01", f"{PACK}.u01.l02"], "dueDate": "2026-10-01"},
    )
    assert two.status_code == 201, two.text
    unit = client.post(url, headers=prof, json={"title": "Unité 1", "unitId": f"{PACK}.u01"})
    assert unit.status_code == 201

    post(client, alice, [lesson_completed(f"{PACK}.u01.l01"), lesson_completed(f"{PACK}.u01.l02")])
    post(client, bob, [lesson_completed(f"{PACK}.u01.l01")])

    detail = client.get(f"/classes/{klass['id']}", headers=prof).json()
    by_title = {a["title"]: a for a in detail["assignments"]}
    assert by_title["Tons"]["completed"] == 1 and by_title["Tons"]["total"] == 2
    assert by_title["Tons"]["dueDate"] == "2026-10-01"
    assert by_title["Unité 1"]["unitId"] == f"{PACK}.u01" and len(by_title["Unité 1"]["lessonIds"]) >= 3
    assert by_title["Unité 1"]["completed"] == 0

    [mine] = client.get("/me/classes", headers=bob).json()
    tons = next(a for a in mine["assignments"] if a["title"] == "Tons")
    assert tons == {
        "id": two.json()["id"],
        "title": "Tons",
        "lessonIds": [f"{PACK}.u01.l01", f"{PACK}.u01.l02"],
        "dueDate": "2026-10-01",
        "completed": 1,
        "total": 2,
    }

    assert client.delete(f"{url}/{two.json()['id']}", headers=prof).status_code == 204
    assert client.delete(f"{url}/{two.json()['id']}", headers=prof).status_code == 404
    assert len(client.get(f"/classes/{klass['id']}", headers=prof).json()["assignments"]) == 1


def test_code_regeneration_removal_leave_and_capacity(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    prof = teacher(client)
    klass = create_class(client, prof)
    old = klass["joinCode"]
    res = client.post(f"/classes/{klass['id']}/regenerate-code", headers=prof)
    assert res.status_code == 200
    new = res.json()["joinCode"]
    assert new != old and len(new) == 6
    student = register(client)
    assert join(client, student, old).status_code == 404
    assert join(client, student, new).status_code == 200

    student_id = user_id_of(client, student)
    assert client.delete(f"/classes/{klass['id']}/students/{student_id}", headers=prof).status_code == 204
    assert client.get("/me/classes", headers=student).json() == []
    assert client.delete(f"/classes/{klass['id']}/students/{student_id}", headers=prof).status_code == 404

    join(client, student, new)
    assert client.delete(f"/me/classes/{klass['id']}", headers=student).status_code == 204
    assert client.delete(f"/me/classes/{klass['id']}", headers=student).status_code == 404
    assert client.get("/classes", headers=prof).json()[0]["studentCount"] == 0

    monkeypatch.setattr(classes, "MAX_STUDENTS", 2)
    assert join(client, register(client), new).status_code == 200
    assert join(client, register(client), new).status_code == 200
    full = join(client, register(client), new)
    assert (full.status_code, full.json()["detail"]) == (409, "class_full")


def test_max_students_constant() -> None:
    assert classes.MAX_STUDENTS == 60
