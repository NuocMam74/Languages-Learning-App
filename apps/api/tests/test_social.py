"""Défis entre amis, défi express et partage public (contrat Phase 3 §3)."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import FriendChallenge
from app.services import friends
from tests.conftest import register
from tests.test_events import post, session_completed


def test_invite_codes_are_crockford_base32() -> None:
    for _ in range(50):
        code = friends.generate_code()
        assert len(code) == 8 and set(code) <= set(friends.CROCKFORD_ALPHABET)
        assert not set(code) & set("ILOU")
    assert friends.normalize_code("abcd-efgh") == "ABCDEFGH"
    assert friends.normalize_code("oil0 1lio".replace(" ", "")) == "01101110"
    assert friends.normalize_code("ABCDEFGU") is None
    assert friends.normalize_code("ABC") is None


def test_create_join_list_friend_challenge(client: TestClient) -> None:
    alice = register(client)
    bob = register(client)
    now = datetime.now(UTC)

    res = client.post("/challenges/friends", headers=alice, json={"kind": "xp_7d"})
    assert res.status_code == 201, res.text
    created = res.json()
    code = created["inviteCode"]
    assert created["inviteUrl"] == f"https://parlo.test/defi/{code}"
    ends = datetime.fromisoformat(created["endsAt"])
    assert timedelta(days=6, hours=23) < ends - now <= timedelta(days=7, minutes=1)

    post(client, alice, [session_completed("a1", now.date().isoformat(), xp=40)])
    post(client, bob, [session_completed("b-old", "2026-01-01", xp=999, when=now - timedelta(days=3))])
    post(client, bob, [session_completed("b1", now.date().isoformat(), xp=15)])

    joined = client.post(f"/challenges/friends/join/{code.lower()}", headers=bob)
    assert joined.status_code == 200, joined.text
    body = joined.json()
    assert body["id"] == created["id"]
    assert [(p["xp"], p["isMe"]) for p in body["participants"]] == [(40, False), (15, True)]
    assert client.post(f"/challenges/friends/join/{code}", headers=bob).status_code == 200  # idempotent

    listed = client.get("/challenges/friends", headers=alice).json()
    assert len(listed) == 1
    assert listed[0]["inviteCode"] == code
    assert [p["isMe"] for p in listed[0]["participants"]] == [True, False]
    assert client.get("/challenges/friends", headers=register(client)).json() == []


def test_friend_challenge_limits(client: TestClient) -> None:
    owner = register(client)
    code = client.post("/challenges/friends", headers=owner, json={}).json()["inviteCode"]
    assert client.post("/challenges/friends/join/ZZZZZZZZ", headers=owner).status_code == 404
    assert client.post("/challenges/friends", headers=owner, json={"kind": "other"}).status_code == 422

    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        challenge = db.scalars(select(FriendChallenge)).one()
        challenge_id = challenge.id
    # 9 amis rejoignent : 10 participants au total.
    for _ in range(9):
        assert client.post(f"/challenges/friends/join/{code}", headers=register(client)).status_code == 200
    full = client.post(f"/challenges/friends/join/{code}", headers=register(client))
    assert (full.status_code, full.json()["detail"]) == (409, "challenge_full")

    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.get(FriendChallenge, challenge_id)
        assert row is not None
        row.ends_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    ended = client.post(f"/challenges/friends/join/{code}", headers=register(client))
    assert (ended.status_code, ended.json()["detail"]) == (409, "challenge_ended")

    for _ in range(friends.MAX_ACTIVE_CREATED):
        assert client.post("/challenges/friends", headers=owner, json={}).status_code == 201
    too_many = client.post("/challenges/friends", headers=owner, json={})
    assert (too_many.status_code, too_many.json()["detail"]) == (409, "too_many_challenges")
    assert client.post("/challenges/friends", json={}).status_code == 401


def score(game: str = "cho_noi", value: int = 120, correct: int = 10, day: str = "2026-09-15") -> dict:
    return {"game": game, "score": value, "correct": correct, "total": 12, "localDate": day}


def test_express_scores_best_and_rank_and_share(client: TestClient) -> None:
    alice = register(client)
    bob = register(client)
    carol = register(client)

    first = client.post("/challenges/express/scores", headers=alice, json=score(value=120)).json()
    assert (first["best"], first["rankToday"]) == (120, 1)
    assert client.post("/challenges/express/scores", headers=alice, json=score(value=90)).json()["best"] == 120
    assert client.post("/challenges/express/scores", headers=bob, json=score(value=150)).json()["rankToday"] == 1
    assert client.post("/challenges/express/scores", headers=alice, json=score(value=100)).json()["rankToday"] == 2
    other_day = client.post("/challenges/express/scores", headers=carol, json=score(value=10, day="2026-09-16"))
    assert other_day.json() == {"id": other_day.json()["id"], "best": 10, "rankToday": 1}

    # Compétition désactivée (motivation « famille ») : pas de rang.
    client.patch("/me/profile", headers=carol, json={"motivation": "family"})
    assert client.post("/challenges/express/scores", headers=carol, json=score(value=5)).json()["rankToday"] is None

    shared = client.get(f"/share/express/{first['id']}")  # public, sans JWT
    assert shared.status_code == 200
    body = shared.json()
    assert (body["displayName"], body["game"], body["score"]) == ("Lan", "cho_noi", 120)
    assert set(body) == {"displayName", "game", "score", "createdAt"}
    assert client.get("/share/express/nope").status_code == 404


def test_express_score_validation(client: TestClient, auth: dict[str, str]) -> None:
    url = "/challenges/express/scores"
    assert client.post(url, headers=auth, json=score(correct=13)).status_code == 422  # correct > total
    assert client.post(url, headers=auth, json=score(value=10_000, correct=2)).status_code == 422
    assert client.post(url, headers=auth, json=score(game="tetris")).status_code == 422
    assert client.post(url, json=score()).status_code == 401
