"""Contrat parcours (API) : restauration, lot empoisonné, plafonds, séances vides, jour local, gel, niveaux,
profil, ligues, statut du professeur, cache « pourquoi ? », push, contenu versionné, planificateur, requêtes."""

import json
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event as sa_event
from sqlalchemy import select

from app.config import REPO_ROOT, Settings
from app.db import Base
from app.main import create_app
from app.models import ClassMember, LeagueGroup, LeagueMember, SchoolClass, StudySession, TutorCache, User
from app.services import classes, events, leagues
from app.services.content import load_packs
from app.services.levels import xp_for_level
from tests.conftest import PASSWORD, event, register
from tests.test_events import card, me, post, session_completed
from tests.test_push import run_reminders, subscribe
from tests.test_tutor import FakeLLM, count, use_llm, why_body

TODAY = datetime.now(UTC)


def today_iso() -> str:
    return TODAY.date().isoformat()


def login_headers(client: TestClient, email: str) -> dict[str, str]:
    res = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


# --- §4 Restauration : appareil A → appareil B ------------------------------------------------


def test_restore_state_on_second_device(client: TestClient) -> None:
    device_a = register(client, "restore@example.com")
    t0 = TODAY - timedelta(hours=2)
    session = str(uuid.uuid4())
    outbox = [
        event(
            "placement_completed",
            {"levelEstimate": 1, "entryLessonId": "vi-south.u03.l01", "correct": 5, "total": 8, "knownConceptIds": []},
            t0,
        ),
        event("srs_card_updated", {"card": card(2, "2026-09-01T10:00:00.000Z") | {"conceptId": "c_chao"}}, t0),
        event(
            "lesson_completed",
            {"sessionId": session, "lessonId": "vi-south.u03.l01", "score": 0.9, "durationMs": 300_000},
            t0 + timedelta(minutes=5),
        ),
        session_completed(session, t0.date().isoformat(), xp=120, when=t0 + timedelta(minutes=6)),
        event("badge_earned", {"badgeCode": "first_lesson"}, t0 + timedelta(minutes=6)),
        event("srs_card_updated", {"card": card(1, None) | {"conceptId": "c_es_hola"}}, t0),  # autre pack
    ]
    assert post(client, device_a, outbox)["rejected"] == []
    client.patch("/me/profile", headers=device_a, json={"motivation": "travel", "entourage": "partner"})

    client.cookies.clear()
    device_b = login_headers(client, "restore@example.com")
    state = client.get(f"/me/state?pack=vi-south&localDate={t0.date().isoformat()}", headers=device_b).json()
    assert state["enrolled"] is True
    assert state["placement"] == {"levelEstimate": 1, "entryLessonId": "vi-south.u03.l01"}
    [progress] = state["lessonProgress"]
    assert (progress["lessonId"], progress["bestScore"], progress["attempts"]) == ("vi-south.u03.l01", 0.9, 1)
    assert [c["conceptId"] for c in state["srsCards"]] == ["c_chao"]
    assert state["srsCards"][0]["reps"] == 2
    assert [b["code"] for b in state["badges"]] == ["first_lesson"]
    assert (state["streak"]["current"], state["xpTotal"]) == (1, 120)
    assert state["level"] == {"value": 2, "name": state["level"]["name"], "xpIntoLevel": 20, "xpForNext": 150}
    assert (state["profile"]["motivation"], state["profile"]["entourage"]) == ("travel", "partner")
    assert client.get("/me/state?pack=zz", headers=device_b).status_code == 404
    assert client.get("/me/state?pack=vi-south").status_code == 401

    # Carte inconnue du serveur envoyée par l'appareil B : acceptée ; carte connue moins avancée : ignorée.
    fresh = card(1, "2026-09-10T10:00:00.000Z") | {"conceptId": "c_ba"}
    stale = card(1, "2026-09-10T10:00:00.000Z") | {"conceptId": "c_chao"}
    assert (
        post(
            client, device_b, [event("srs_card_updated", {"card": fresh}), event("srs_card_updated", {"card": stale})]
        )["rejected"]
        == []
    )
    cards = {
        c["conceptId"]: c["reps"] for c in client.get("/me/state?pack=vi-south", headers=device_b).json()["srsCards"]
    }
    assert cards == {"c_ba": 1, "c_chao": 2}


# --- §4 Lot empoisonné ----------------------------------------------------------------------


def test_poisoned_event_rejected_alone_with_server_error(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    poisoned_id = str(uuid.uuid4())
    original = events._apply_badge_earned

    def boom(db: Any, user_id: str, ev: Any) -> None:
        original(db, user_id, ev)  # écriture partielle, annulée par le SAVEPOINT
        if str(ev.id) == poisoned_id:
            raise RuntimeError("bug serveur")

    monkeypatch.setattr(events, "_apply_badge_earned", boom)
    poisoned = event("badge_earned", {"badgeCode": "streak_7"}) | {"id": poisoned_id}
    good_before = session_completed("p1", today_iso(), when=TODAY - timedelta(minutes=10))
    good_after = event("badge_earned", {"badgeCode": "first_lesson"})
    result = post(client, auth, [good_before, poisoned, good_after])
    assert result["rejected"] == [{"id": poisoned_id, "reason": "server_error"}]
    assert sorted(result["accepted"]) == sorted([good_before["id"], good_after["id"]])
    state = me(client, auth)
    assert [b["code"] for b in state["badges"]] == ["first_lesson"]  # rien du badge fautif
    assert state["enrollment"]["xpTotal"] == 30
    # Renvoyé après correction : accepté (pas marqué traité).
    monkeypatch.setattr(events, "_apply_badge_earned", original)
    assert post(client, auth, [poisoned])["accepted"] == [poisoned_id]


# --- §3 Plafonds, séances vides, jour local --------------------------------------------------


def test_session_caps_are_clipped_not_rejected(client: TestClient, auth: dict[str, str]) -> None:
    huge = event(
        "session_completed",
        {
            "sessionId": "cap",
            "xpGained": 999_999,
            "itemsCount": 5000,
            "durationMs": 10 * 86_400_000,
            "localDate": today_iso(),
        },
    )
    small = event(
        "session_completed",
        {"sessionId": "cap2", "xpGained": 500, "itemsCount": 3, "durationMs": 60_000, "localDate": today_iso()},
    )
    assert post(client, auth, [huge, small])["rejected"] == []
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        rows = {s.id: s for s in db.scalars(select(StudySession))}
    assert (rows["cap"].items_count, rows["cap"].xp_gained, rows["cap"].duration_ms) == (200, 1000, 4 * 3_600_000)
    assert rows["cap2"].xp_gained == 15 * 3 + 50
    assert me(client, auth)["enrollment"]["xpTotal"] == 1000 + 95


def test_empty_session_gives_nothing(client: TestClient, auth: dict[str, str]) -> None:
    empty = event(
        "session_completed",
        {"sessionId": "empty", "xpGained": 20, "itemsCount": 0, "durationMs": 5000, "localDate": today_iso()},
    )
    assert post(client, auth, [empty])["accepted"] == [empty["id"]]
    state = me(client, auth, today_iso())
    assert (state["enrollment"]["xpTotal"], state["streak"]["current"], state["streak"]["lastActiveDate"]) == (
        0,
        0,
        None,
    )
    # Leçon terminée dans la séance (ex. carte culture seule) : la séance compte.
    lesson = event(
        "lesson_completed", {"sessionId": "culture", "lessonId": "vi-south.u01.l01", "score": 1, "durationMs": 1}
    )
    culture = event(
        "session_completed",
        {"sessionId": "culture", "xpGained": 20, "itemsCount": 0, "durationMs": 5000, "localDate": today_iso()},
    )
    post(client, auth, [lesson, culture])
    assert me(client, auth, today_iso())["streak"]["current"] == 1


def test_local_date_must_match_occurred_at(client: TestClient, auth: dict[str, str]) -> None:
    far = session_completed("far", (TODAY - timedelta(days=3)).date().isoformat(), when=TODAY)
    ahead = session_completed("ahead", (TODAY + timedelta(days=1)).date().isoformat(), when=TODAY)
    game = event(
        "game_played",
        {
            "game": "cho_noi",
            "correct": 3,
            "total": 4,
            "durationMs": 1,
            "localDate": (TODAY + timedelta(days=5)).date().isoformat(),
        },
    )
    result = post(client, auth, [far, ahead, game])
    assert {r["id"]: r["reason"] for r in result["rejected"]} == {
        far["id"]: "invalid: local_date",
        game["id"]: "invalid: local_date",
    }
    assert result["accepted"] == [ahead["id"]]  # fuseau à l'est : +1 jour toléré


def test_streak_freeze_declared_and_cancelled_with_null(client: TestClient, auth: dict[str, str]) -> None:
    day = TODAY.date()
    until = (day + timedelta(days=5)).isoformat()
    declared = event("streak_frozen", {"frozenUntil": until, "localDate": day.isoformat()})
    assert post(client, auth, [declared])["rejected"] == []
    streak = me(client, auth, day.isoformat())["streak"]
    assert (streak["frozenUntil"], streak["frozenFrom"]) == (until, day.isoformat())
    cancel = event("streak_frozen", {"frozenUntil": None, "localDate": day.isoformat()})
    assert post(client, auth, [cancel])["rejected"] == []
    streak = me(client, auth, day.isoformat())["streak"]
    assert (streak["frozenUntil"], streak["frozenFrom"]) == (None, None)


def test_me_level_follows_xp(client: TestClient, auth: dict[str, str]) -> None:
    for i in range(3):
        post(client, auth, [session_completed(f"lv{i}", today_iso(), xp=1000)])  # plafonné à 15·8+50 = 170
    level = me(client, auth)["level"]
    xp = 3 * 170  # 510 XP : niveau 4 (450) → 5 (700)
    assert xp_for_level(4) <= xp < xp_for_level(5)
    assert (level["value"], level["xpIntoLevel"], level["xpForNext"]) == (4, xp - 450, 700 - 450)
    pack = load_packs(REPO_ROOT / "content")["vi-south"]
    assert level["name"] == pack.raw["levelNames"][0]
    assert me(client, auth)["enrollment"]["level"] == 4


# --- §4 Profil et ligues ------------------------------------------------------------------------


def test_leagues_default_follows_motivation_after_register(client: TestClient, auth: dict[str, str]) -> None:
    assert client.get("/me", headers=auth).json()["profile"]["leaguesEnabled"] is True
    body = client.patch(
        "/me/profile",
        headers=auth,
        json={"motivation": "family", "entourage": "parents", "selfLevel": "words", "interfaceLocale": "en"},
    ).json()
    assert (body["leaguesEnabled"], body["entourage"], body["selfLevel"], body["interfaceLocale"]) == (
        False,
        "parents",
        "words",
        "en",
    )
    assert client.get("/me", headers=auth).json()["user"]["locale"] == "en"
    assert client.patch("/me/profile", headers=auth, json={"motivation": "travel"}).json()["leaguesEnabled"] is True
    # Choix explicite : la motivation ne le remplace plus.
    client.patch("/me/profile", headers=auth, json={"leaguesEnabled": False})
    assert client.patch("/me/profile", headers=auth, json={"motivation": "work"}).json()["leaguesEnabled"] is False


def test_league_standings_exclude_opted_out_users(client: TestClient) -> None:
    alice = register(client)
    bob = register(client)
    for headers in (alice, bob):
        post(client, headers, [session_completed(str(uuid.uuid4()), today_iso(), xp=40)])
    client.get("/leagues/me", headers=alice)
    client.get("/leagues/me", headers=bob)  # chacun rejoint le groupe de la semaine à sa première lecture
    standings = client.get("/leagues/me", headers=alice).json()["standings"]
    assert len(standings) == 2
    client.patch("/me/profile", headers=bob, json={"leaguesEnabled": False})
    standings = client.get("/leagues/me", headers=alice).json()["standings"]
    assert [s["isMe"] for s in standings] == [True]


def test_rollover_query_count_does_not_grow_with_users(client: TestClient) -> None:
    def queries_for(n: int) -> int:
        now = datetime.now(UTC)
        prev_start, _ = leagues.week_bounds(leagues.week_start_date(now) - timedelta(days=7))
        with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
            for model in (LeagueMember, LeagueGroup, StudySession):
                db.query(model).delete()
            for i in range(n):
                user = User(display_name=f"R{i}", locale="fr")
                db.add(user)
                db.flush()
                from app.models import Profile

                db.add(Profile(user_id=user.id, daily_goal_min=10, leagues_enabled=True))
                db.add(StudySession(id=str(uuid.uuid4()), user_id=user.id, xp_gained=5, ended_at=prev_start))
            db.commit()
            counter = {"n": 0}

            def count_query(*_: Any) -> None:
                counter["n"] += 1

            engine = client.app.state.engine  # type: ignore[attr-defined]
            sa_event.listen(engine, "before_cursor_execute", count_query)
            try:
                leagues.rollover(db, now)
            finally:
                sa_event.remove(engine, "before_cursor_execute", count_query)
            db.rollback()
            return counter["n"]

    assert queries_for(3) == queries_for(12)


def test_class_dashboard_query_count_is_constant(client: TestClient) -> None:
    teacher = register(client)
    teacher_id = client.get("/me", headers=teacher).json()["user"]["id"]
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        klass = SchoolClass(teacher_id=teacher_id, name="C", pack_code="vi-south", join_code="ABCDEF")
        db.add(klass)
        db.commit()
        class_id = klass.id

    def queries_with(students: int) -> int:
        with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
            while db.query(ClassMember).count() < students:
                user = User(display_name=f"S{uuid.uuid4().hex[:4]}", locale="fr")
                db.add(user)
                db.flush()
                db.add(ClassMember(class_id=class_id, user_id=user.id, consent_at=datetime.now(UTC)))
            db.commit()
            klass = db.get(SchoolClass, class_id)
            counter = {"n": 0}

            def count_query(*_: Any) -> None:
                counter["n"] += 1

            engine = client.app.state.engine  # type: ignore[attr-defined]
            sa_event.listen(engine, "before_cursor_execute", count_query)
            try:
                classes.students_progress(db, klass, None, datetime.now(UTC))  # type: ignore[arg-type]
            finally:
                sa_event.remove(engine, "before_cursor_execute", count_query)
            return counter["n"]

    assert queries_with(2) == queries_with(8)


# --- §5 Professeur ------------------------------------------------------------------------------


def test_tutor_status_per_pack(client: TestClient) -> None:
    assert client.get("/tutor/status?pack=vi-south").json() == {
        "available": False,
        "reason": "no_model",
        "personaName": "Cô Mai",
    }
    assert client.get("/tutor/status?pack=es").json() == {
        "available": False,
        "reason": "pack_unsupported",
        "personaName": None,
    }
    assert client.get("/tutor/status?pack=zz").status_code == 404
    use_llm(client, FakeLLM())
    assert client.get("/tutor/status").json() == {"available": True, "reason": None, "personaName": "Cô Mai"}


def test_pack_without_persona_uses_templates_only(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM()
    use_llm(client, llm)
    post(client, auth, [event("pack_switched", {"fromPack": "vi-south", "toPack": "es"})])
    body = client.get("/tutor/greeting?locale=fr", headers=auth).json()
    assert body["source"] == "fallback" and "Lan" in body["text"] and "Cô Mai" not in body["text"]
    assert llm.calls == []
    res = client.post("/tutor/conversations", headers=auth, json={"locale": "fr", "mode": "free"})
    assert (res.status_code, res.json()["detail"]) == (409, "tutor_unavailable")


def test_why_cache_key_includes_expected_and_expires(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM(replies=["Première explication.", "Seconde explication."])
    use_llm(client, llm)
    first = client.post("/tutor/why", headers=auth, json=why_body("mà")).json()
    assert first["cached"] is False
    # Même réponse donnée, autre réponse attendue injectée par le client : pas de cache partagé.
    other = why_body("mà") | {"expected": "mạ"}
    second = client.post("/tutor/why", headers=auth, json=other).json()
    assert (second["cached"], second["text"]) == (False, "Seconde explication.")
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        rows = list(db.scalars(select(TutorCache).where(TutorCache.kind == "why")))
    assert len(rows) == 2
    assert all(timedelta(days=29) < r.expires_at - r.created_at <= timedelta(days=30) for r in rows)  # type: ignore[operator]
    assert count(client, TutorCache, kind="why") == 2


# --- §4 Push ----------------------------------------------------------------------------------


def test_push_endpoint_never_reassigned_to_another_user(client: TestClient, auth: dict[str, str]) -> None:
    assert subscribe(client, auth) == 204
    other = register(client)
    assert subscribe(client, other) == 409


def test_one_reminder_per_user_using_profile_hour_and_timezone(client: TestClient, auth: dict[str, str]) -> None:
    subscribe(client, auth, endpoint="https://push.example.com/a", reminderHour=8, timezone="UTC")
    subscribe(client, auth, endpoint="https://push.example.com/b", reminderHour=8, timezone="UTC")
    # Le profil (réglages) fait foi : 19 h à Saïgon (UTC+7) = 12:00 UTC.
    client.patch("/me/profile", headers=auth, json={"reminderHour": 19, "timezone": "Asia/Ho_Chi_Minh"})
    report, sent = run_reminders(client, datetime(2026, 9, 14, 8, 0, tzinfo=UTC))
    assert report.sent == 0
    report, sent = run_reminders(client, datetime(2026, 9, 14, 12, 0, tzinfo=UTC))
    assert report.sent == 1 and len(sent) == 1
    assert sent[0]["endpoint"] == "https://push.example.com/b"  # abonnement le plus récent
    assert run_reminders(client, datetime(2026, 9, 14, 12, 30, tzinfo=UTC))[0].sent == 0
    # Le plus récent a expiré : l'autre appareil reçoit le rappel du lendemain.
    report, sent = run_reminders(client, datetime(2026, 9, 15, 12, 0, tzinfo=UTC), statuses=[410, None])
    assert (report.deleted, report.sent, [s["endpoint"] for s in sent]) == (
        1,
        1,
        ["https://push.example.com/b", "https://push.example.com/a"],
    )


# --- §1, §6 Contenu versionné -----------------------------------------------------------------


@pytest.fixture
def versioned_client(settings: Settings, tmp_path: Path) -> Any:
    root = tmp_path / "content"
    shutil.copytree(REPO_ROOT / "content" / "es", root / "es")
    (root / "es" / "audio").mkdir(exist_ok=True)
    (root / "es" / "audio" / "hola.opus").write_bytes(b"ogg")
    (root / "es" / "_review").mkdir(exist_ok=True)
    (root / "es" / "_review" / "secret.json").write_text("{}", encoding="utf-8")
    app = create_app(settings.model_copy(update={"content_dir": root, "default_course": "es"}))
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://testserver") as c:
        yield c, root
    app.state.engine.dispose()


def test_manifest_bundle_and_media_follow_published_version(versioned_client: Any) -> None:
    client, root = versioned_client
    manifest = client.get("/courses/es/manifest").json()
    version = manifest["version"]
    assert "audio/hola.opus" in manifest["mediaIndex"] and manifest["comingSoon"] is True
    assert all(m.split("/")[0] in ("audio", "pitch", "img") for m in manifest["mediaIndex"])
    assert client.get("/content/es/latest.json").json() == {"code": "es", "version": version}
    bundle = client.get(f"/content/es/v{version}/bundle.json").json()
    assert bundle["mediaIndex"] == manifest["mediaIndex"]
    assert {"pack", "curriculum", "lessons", "concepts", "culture", "exams", "placement", "games"} <= set(bundle)
    assert client.get(f"/content/es/v{version}/audio/hola.opus").content == b"ogg"
    assert client.get(f"/content/es/v{version}/_review/secret.json").status_code == 404
    assert client.get(f"/content/es/v{version}/../es/pack.json").status_code == 404

    # Publication par un autre worker : pack.json réécrit, aucun cache vidé ici.
    pack_file = root / "es" / "pack.json"
    data = json.loads(pack_file.read_text(encoding="utf-8"))
    data["version"] = version + 1
    pack_file.write_text(json.dumps(data), encoding="utf-8")
    assert client.get("/courses/es/manifest").json()["version"] == version + 1
    assert client.get("/content/es/latest.json").json()["version"] == version + 1
    assert client.get(f"/content/es/v{version}/bundle.json").status_code == 404
    assert client.get(f"/content/es/v{version + 1}/bundle.json").json()["pack"]["version"] == version + 1


def test_scheduler_includes_tutor_purge(settings: Settings) -> None:
    from app.scheduler import start_scheduler

    app = create_app(settings)
    scheduler = start_scheduler(settings, app.state.session_factory)
    try:
        assert {"weekly_challenge", "leagues_rollover", "push_reminders", "tutor_purge"} <= {
            job.id for job in scheduler.get_jobs()
        }
    finally:
        scheduler.shutdown(wait=False)
        app.state.engine.dispose()


def test_why_without_lesson_falls_back_to_content(client: TestClient, auth: dict[str, str]) -> None:
    use_llm(client, FakeLLM())
    body = why_body("mà") | {"lessonId": None}
    res = client.post("/tutor/why", headers=auth, json=body)
    assert res.status_code == 200
    assert res.json()["source"] == "fallback" and "má" in res.json()["text"]


def test_batch_level_failure_returns_json_500(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def crash(*_: Any, **__: Any) -> None:
        raise RuntimeError("commit impossible")

    monkeypatch.setattr("app.routers.me.process_batch", crash)
    res = client.post("/me/events", headers=auth, json={"events": [session_completed("x", today_iso())]})
    assert (res.status_code, res.json()) == (500, {"detail": "server_error"})
