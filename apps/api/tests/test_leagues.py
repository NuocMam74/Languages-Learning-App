"""Ligues (contrat Phase 3 §2) : XP de la semaine, placement, passage de semaine, promotion/relégation, groupes."""

import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import REPO_ROOT
from app.models import ChallengeProgress, LeagueGroup, LeagueMember, Profile, StudySession, User
from app.routers.leagues import division_name
from app.services import challenges, leagues
from app.services.content import league_division_names, load_packs
from tests.test_events import post, session_completed

PACK = load_packs(REPO_ROOT / "content")["vi-south"]


def db_session(client: TestClient) -> Session:
    session: Session = client.app.state.session_factory()  # type: ignore[attr-defined]
    return session


def add_user(db: Session, name: str, xp: int | None, ended_at: datetime, enabled: bool = True) -> str:
    user = User(id=str(uuid.uuid4()), display_name=name, locale="fr")
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, daily_goal_min=10, leagues_enabled=enabled))
    if xp is not None:
        db.add(StudySession(id=str(uuid.uuid4()), user_id=user.id, xp_gained=xp, items_count=1, ended_at=ended_at))
    db.flush()
    return user.id


def test_week_bounds_and_outcomes() -> None:
    now = datetime(2026, 9, 17, 15, tzinfo=UTC)  # jeudi
    week = leagues.week_start_date(now)
    assert week.isoformat() == "2026-09-14"
    start, end = leagues.week_bounds(week)
    assert (start, end - start) == (datetime(2026, 9, 14, tzinfo=UTC), timedelta(days=7))
    assert [leagues.outcome_for(r, 12, 10) for r in (1, 5, 6, 7, 8, 12)] == [
        "promoted",
        "promoted",
        "stayed",
        "stayed",
        "relegated",
        "relegated",
    ]
    assert leagues.outcome_for(1, 3, 0) == "stayed"  # pas de promotion sans XP
    assert leagues.outcome_for(3, 3, 0) == "stayed"  # petit groupe : pas de relégation dans le top 5
    assert (leagues.next_division(5, "promoted"), leagues.next_division(1, "relegated")) == (5, 1)


def test_leagues_disabled_and_new_learner(client: TestClient, auth: dict[str, str]) -> None:
    body = client.get("/leagues/me", headers=auth).json()
    names = league_division_names(PACK)
    assert body["enabled"] is True and body["division"] == 1 and body["standings"] == []
    assert body["divisionName"] == (names[0] if names else {"fr": "Division 1", "en": "Division 1"})
    assert (body["promoteTop"], body["relegateBottom"]) == (5, 5)
    assert datetime.fromisoformat(body["weekEnd"]) - datetime.fromisoformat(body["weekStart"]) == timedelta(days=7)

    client.patch("/me/profile", headers=auth, json={"motivation": "family"})
    assert client.get("/leagues/me", headers=auth).json() == {"enabled": False}
    assert client.get("/leagues/me").status_code == 401


def test_active_learner_joins_a_group_with_week_xp(client: TestClient, auth: dict[str, str]) -> None:
    now = datetime.now(UTC)
    post(client, auth, [session_completed("old", "2026-01-01", xp=500, when=now - timedelta(days=30))])
    post(client, auth, [session_completed("s1", now.date().isoformat(), xp=30)])
    body = client.get("/leagues/me", headers=auth).json()
    assert body["standings"] == [{"rank": 1, "displayName": "Lan", "xp": 30, "isMe": True}]
    assert client.get("/leagues/me", headers=auth).json()["standings"][0]["xp"] == 30  # membre stable


def test_xp_counts_claimed_challenges(client: TestClient) -> None:
    now = datetime.now(UTC)
    with db_session(client) as db:
        uid = add_user(db, "Mai", 20, now)
        challenge = challenges.ensure_week_challenge(db, now)
        db.add(ChallengeProgress(user_id=uid, challenge_id=challenge.id, progress=5, claimed_at=now))
        db.flush()
        start, end = leagues.week_bounds(leagues.week_start_date(now))
        assert leagues.xp_between(db, [uid], start, end) == {uid: 20 + challenges.CLAIM_XP}


def test_rollover_promotes_relegates_and_regroups(client: TestClient) -> None:
    now = datetime.now(UTC)
    week = leagues.week_start_date(now)
    prev_start, _ = leagues.week_bounds(week - timedelta(days=7))
    with db_session(client) as db:
        ids = [add_user(db, f"U{i:02d}", 10 * i, prev_start + timedelta(days=1)) for i in range(12)]
        for uid in ids:
            assert leagues.ensure_membership(db, uid, prev_start + timedelta(days=2)) is not None
        # Toute la semaine écoulée en division 3.
        for group in db.scalars(select(LeagueGroup)):
            group.division = 3
        for member in db.scalars(select(LeagueMember)):
            member.division = 3
        db.get(Profile, ids[6]).leagues_enabled = False  # type: ignore[union-attr]
        db.commit()

        assert leagues.rollover(db, now) == 11
        db.commit()
        assert leagues.rollover(db, now) == 0  # idempotent

        previous = {m.user_id: m for m in db.scalars(select(LeagueMember).where(LeagueMember.week_start < week))}
        # L'utilisateur qui a désactivé les ligues est retiré du classement final (ni rang ni issue).
        assert [previous[ids[i]].final_rank for i in (11, 0)] == [1, 11]
        assert previous[ids[6]].final_rank is None
        assert previous[ids[11]].final_xp == 110
        outcomes: dict[str, Any] = {uid: m.outcome for uid, m in previous.items()}
        assert [outcomes[ids[i]] for i in range(12)] == ["relegated"] * 5 + ["stayed", None] + ["promoted"] * 5

        current = {
            m.user_id: m.division for m in db.scalars(select(LeagueMember).where(LeagueMember.week_start == week))
        }
        assert ids[6] not in current
        assert Counter(current.values()) == {4: 5, 2: 5, 3: 1}
        assert current[ids[11]] == 4 and current[ids[0]] == 2 and current[ids[5]] == 3


def test_groups_of_30_are_balanced_and_deterministic(client: TestClient) -> None:
    now = datetime.now(UTC)
    prev_start, _ = leagues.week_bounds(leagues.week_start_date(now) - timedelta(days=7))
    with db_session(client) as db:
        ids = [add_user(db, f"P{i:02d}", 5, prev_start + timedelta(hours=5)) for i in range(61)]
        add_user(db, "Inactive", None, prev_start)
        db.commit()
        assert leagues.rollover(db, now) == 61
        sizes = Counter(m.group_id for m in db.scalars(select(LeagueMember)))
        assert sorted(sizes.values()) == [20, 20, 21]
        week = leagues.week_start_date(now)
        ordered = sorted(ids, key=lambda uid: leagues._sort_key(week, uid))
        groups = {g.id: g.group_index for g in db.scalars(select(LeagueGroup))}
        members = {m.user_id: groups[m.group_id] for m in db.scalars(select(LeagueMember))}
        assert [members[uid] for uid in ordered[:6]] == [0, 1, 2, 0, 1, 2]


def test_division_names_from_pack_or_neutral_default() -> None:
    names = [{"fr": f"Fleuve {i}", "en": f"River {i}"} for i in range(1, 6)]
    assert division_name(names, 2).model_dump() == {"fr": "Fleuve 2", "en": "River 2"}
    assert division_name(None, 4).model_dump() == {"fr": "Division 4", "en": "Division 4"}
