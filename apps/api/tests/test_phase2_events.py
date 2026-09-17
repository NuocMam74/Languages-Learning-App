"""Événements de la Phase 2 : `pronunciation_scored`, `streak_frozen`, `game_played`."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import GamePlay, PronunciationScore
from tests.conftest import day_iso, event, today_iso
from tests.test_events import count, me, post


def test_pronunciation_scored_stores_score_only(client: TestClient, auth: dict[str, str]) -> None:
    ok = event(
        "pronunciation_scored", {"sessionId": None, "conceptId": "c_ba", "score": 72.5, "exerciseType": "speak_repeat"}
    )
    too_high = event(
        "pronunciation_scored", {"sessionId": "s1", "conceptId": "c_ba", "score": 101, "exerciseType": "tone_produce"}
    )
    result = post(client, auth, [ok, too_high, ok])
    assert result["accepted"] == [ok["id"], ok["id"]]
    assert result["rejected"][0]["reason"].startswith("invalid:")
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        rows = list(db.scalars(select(PronunciationScore)))
    assert [(r.id, r.concept_id, r.score) for r in rows] == [(ok["id"], "c_ba", 72.5)]


def test_streak_frozen_sets_frozen_until_within_14_days(client: TestClient, auth: dict[str, str]) -> None:
    ok = event("streak_frozen", {"frozenUntil": day_iso(6), "localDate": today_iso()})
    too_long = event("streak_frozen", {"frozenUntil": day_iso(15), "localDate": today_iso()})
    backwards = event("streak_frozen", {"frozenUntil": day_iso(-1), "localDate": today_iso()})
    limit = event("streak_frozen", {"frozenUntil": day_iso(14), "localDate": today_iso()})
    result = post(client, auth, [ok, too_long, backwards])
    assert result["accepted"] == [ok["id"]]
    assert {r["id"] for r in result["rejected"]} == {too_long["id"], backwards["id"]}
    assert all(r["reason"].startswith("invalid") for r in result["rejected"])
    assert me(client, auth)["streak"]["frozenUntil"] == day_iso(6)
    assert post(client, auth, [limit])["rejected"] == []
    assert me(client, auth)["streak"]["frozenUntil"] == day_iso(14)


def test_game_played_recorded_without_xp(client: TestClient, auth: dict[str, str]) -> None:
    play = event(
        "game_played", {"game": "cho_noi", "correct": 8, "total": 10, "durationMs": 60000, "localDate": today_iso()}
    )
    cheat = event(
        "game_played", {"game": "xe_om", "correct": 11, "total": 10, "durationMs": 60000, "localDate": today_iso()}
    )
    unknown = event(
        "game_played", {"game": "tetris", "correct": 1, "total": 1, "durationMs": 1, "localDate": today_iso()}
    )
    result = post(client, auth, [play, cheat, unknown, play])
    assert result["accepted"] == [play["id"], play["id"]]
    reasons = {r["id"]: r["reason"] for r in result["rejected"]}
    assert reasons[cheat["id"]] == "invalid: payload.correct: greater than total"
    assert reasons[unknown["id"]].startswith("invalid:")
    assert count(client, GamePlay) == 1
    assert me(client, auth)["enrollment"]["xpTotal"] == 0
