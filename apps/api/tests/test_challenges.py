"""Défi de la semaine (contrat Phase 2 §3) : rotation (parité core), progression, réclamation."""

import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.config import REPO_ROOT
from app.models import Challenge
from app.services import challenges
from app.services.content import load_packs
from tests.conftest import event
from tests.test_events import me, post

PARITY: dict[str, Any] = json.loads((Path(__file__).parent / "fixtures" / "core_parity.json").read_text("utf-8"))
PACK = load_packs(REPO_ROOT / "content")["vi-south"]


def iso_z(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", ".000Z")


def test_weekly_rotation_matches_core() -> None:
    for case in PARITY["challengeWeeks"]:
        start = challenges.week_start(datetime.fromisoformat(case["now"]))
        definition = challenges.definition_for_week(start)
        assert (definition.kind, definition.target) == (case["kind"], case["target"]), case
        assert iso_z(start) == case["periodStart"]
        assert iso_z(start + timedelta(days=7)) == case["periodEnd"]


def test_longest_run() -> None:
    days = {date(2026, 9, d) for d in (14, 15, 17, 18, 19)}
    assert challenges.longest_run(days) == 3
    assert challenges.longest_run(set()) == 0


def use_challenge(client: TestClient, kind: str, target: int) -> Challenge:
    """Remplace le défi de la semaine courante (le type dépend de la date du test)."""
    now = datetime.now(UTC)
    start = challenges.week_start(now)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.get(Challenge, challenges.challenge_id(start)) or Challenge(id=challenges.challenge_id(start))
        row.kind = kind
        row.period_start = start
        row.period_end = start + timedelta(days=7)
        row.spec_json = {"target": target, "title": {"fr": "t", "en": "t"}, "badgeCode": f"challenge_{kind}"}
        db.merge(row)
        db.commit()
        return row


def current(client: TestClient, auth: dict[str, str]) -> dict[str, Any]:
    res = client.get("/challenges/current", headers=auth)
    assert res.status_code == 200, res.text
    items: list[dict[str, Any]] = res.json()
    assert len(items) == 1
    return items[0]


def lesson_done(lesson_id: str, when: datetime | None = None) -> dict[str, Any]:
    return event("lesson_completed", {"sessionId": "s", "lessonId": lesson_id, "score": 1, "durationMs": 1}, when)


def test_current_challenge_generated_lazily(client: TestClient, auth: dict[str, str]) -> None:
    item = current(client, auth)
    definition = challenges.definition_for_week(challenges.week_start(datetime.now(UTC)))
    assert item["kind"] == definition.kind
    assert item["target"] == definition.target
    assert item["progress"] == 0
    assert item["badgeCode"] == f"challenge_{definition.kind}"
    assert set(item) == {
        "id", "kind", "title", "target", "unit", "progress", "completedAt", "claimedAt", "periodStart", "periodEnd",
        "badgeCode",
    }  # fmt: skip
    assert current(client, auth)["id"] == item["id"]


def test_lessons_challenge_claim_gives_xp_and_badge(client: TestClient, auth: dict[str, str]) -> None:
    challenge = use_challenge(client, "lessons", 3)
    old = datetime.now(UTC) - timedelta(days=8)
    post(client, auth, [lesson_done("vi-south.u01.l01", old), lesson_done("vi-south.u01.l02")])
    item = current(client, auth)
    assert (item["progress"], item["completedAt"]) == (1, None)
    assert client.post(f"/challenges/{challenge.id}/claim", headers=auth).status_code == 409

    post(
        client,
        auth,
        [lesson_done("vi-south.u01.l03"), lesson_done("vi-south.u01.l04"), lesson_done("vi-south.u01.l05")],
    )
    item = current(client, auth)
    assert item["progress"] == 3  # plafonné à l'objectif
    assert item["completedAt"] is not None
    xp_before = me(client, auth)["enrollment"]["xpTotal"]

    res = client.post(f"/challenges/{challenge.id}/claim", headers=auth)
    assert res.status_code == 200, res.text
    assert res.json()["xp"] == 50
    state = me(client, auth)
    assert state["enrollment"]["xpTotal"] == xp_before + 50
    assert "challenge_lessons" in [b["code"] for b in state["badges"]]
    assert current(client, auth)["claimedAt"] is not None
    again = client.post(f"/challenges/{challenge.id}/claim", headers=auth)
    assert (again.status_code, again.json()["detail"]) == (409, "already_claimed")
    assert client.post("/challenges/nope/claim", headers=auth).status_code == 404


def test_challenge_badge_cannot_be_self_awarded(client: TestClient, auth: dict[str, str]) -> None:
    forged = event("badge_earned", {"badgeCode": "challenge_lessons"})
    assert post(client, auth, [forged])["rejected"] == [{"id": forged["id"], "reason": "unknown_badge"}]


def test_words_theme_counts_unit_words_of_completed_lessons(client: TestClient, auth: dict[str, str]) -> None:
    use_challenge(client, "words_theme", 10)
    item = current(client, auth)
    assert item["unit"] == "vi-south.u01"
    post(client, auth, [lesson_done("vi-south.u01.l01"), lesson_done("vi-south.u02.l01")])
    words = challenges.unit_words(PACK, "vi-south.u01")["vi-south.u01.l01"]
    assert words
    assert current(client, auth)["progress"] == min(10, len(words))


def test_streak_speaking_and_games(client: TestClient, auth: dict[str, str]) -> None:
    now = datetime.now(UTC)
    start = challenges.week_start(now)
    use_challenge(client, "streak_days", 5)
    # Les jours se dérivent de la semaine en cours, et seulement de ceux déjà passés. Écrits en dur,
    # ils sortaient de la période dès que la semaine tournait : le serveur rejette un `localDate` à
    # plus d'un jour de son `occurredAt` (et un `occurredAt` à venir), les séances n'étaient plus
    # comptées, et le test virait au rouge pour la seule raison que le temps passe.
    # Deux jours de suite, puis — si la semaine est assez avancée — un jour sauté : la suite reste
    # de 2. `test_longest_run` couvre la règle elle-même ; ici on vérifie que les séances arrivent
    # et sont rattachées au bon jour.
    elapsed = (now.date() - start.date()).days
    days = [start.date() + timedelta(days=offset) for offset in (0, 1, 3) if offset <= elapsed]
    sessions = [
        event(
            "session_completed",
            {"sessionId": f"s{i}", "xpGained": 1, "itemsCount": 1, "durationMs": 1000, "localDate": day.isoformat()},
            # Midi, sauf pour aujourd'hui : un `occurredAt` à venir serait rejeté.
            min(datetime.combine(day, time(12), tzinfo=UTC), now),
        )
        for i, day in enumerate(days)
    ]
    post(client, auth, sessions)
    assert current(client, auth)["progress"] == challenges.longest_run(set(days))

    use_challenge(client, "speaking_minutes", 5)
    scores = [
        event(
            "pronunciation_scored",
            {"sessionId": None, "conceptId": "c_ba", "score": 50, "exerciseType": "speak_repeat"},
            start + timedelta(seconds=i),
        )
        for i in range(13)
    ]
    post(client, auth, scores)
    assert current(client, auth)["progress"] == 2  # 13 × 10 s = 130 s
    post(client, auth, [scores[0]] + [dict(s, id=str(uuid.uuid4())) for s in scores[:5]])
    assert current(client, auth)["progress"] == 3  # 18 items = 180 s

    use_challenge(client, "game_score", 3)
    plays = [
        event(
            "game_played",
            {"game": "cho_noi", "correct": c, "total": t, "durationMs": 1, "localDate": start.date().isoformat()},
            start + timedelta(seconds=i),
        )
        for i, (c, t) in enumerate([(7, 10), (6, 10), (0, 0), (3, 3), (9, 9)])
    ]
    post(client, auth, plays)
    assert current(client, auth)["progress"] == 3
