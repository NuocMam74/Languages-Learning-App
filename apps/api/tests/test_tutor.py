"""`/tutor/*` (Cô Mai) : cache, quota, garde du Sud, replis, limitation. Le modèle est un double local."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import REPO_ROOT, Settings
from app.db import Base
from app.main import create_app
from app.models import TutorCache, TutorMessage
from app.services.content import lesson_document, load_packs
from app.services.tutor import normalize_answer, purge_tutor_data, system_prompt
from app.services.tutor_llm import ChatTurn, TutorCompletion, TutorLLMError
from tests.conftest import event, register
from tests.test_events import post

PACK = load_packs(REPO_ROOT / "content")["vi-south"]


@dataclass
class FakeLLM:
    """Réponses scriptées (texte ou exception), dans l'ordre ; enregistre les appels."""

    replies: list[str | Exception] = field(default_factory=list)
    default: str = "Chào Lan ! On reprend le ton sắc en douceur nghen."
    calls: list[tuple[str, list[ChatTurn]]] = field(default_factory=list)

    def complete(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int) -> TutorCompletion:
        self.calls.append((system, list(turns)))
        reply = self.replies.pop(0) if self.replies else self.default
        if isinstance(reply, Exception):
            raise reply
        return TutorCompletion(text=reply, input_tokens=120, output_tokens=30)


def use_llm(client: TestClient, llm: FakeLLM | None) -> None:
    client.app.state.tutor_llm = llm  # type: ignore[attr-defined]


def app_settings(client: TestClient) -> Settings:
    settings: Settings = client.app.state.settings  # type: ignore[attr-defined]
    return settings


def count(client: TestClient, model: type, **where: Any) -> int:
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        query = select(func.count()).select_from(model).filter_by(**where)
        return int(db.scalar(query) or 0)


def explained_step() -> tuple[str, int, dict[str, Any]]:
    """Première étape du pack munie d'une explication écrite (le contenu peut évoluer)."""
    for lesson_id in sorted(PACK.lessons):
        doc = lesson_document(PACK, lesson_id)
        assert doc is not None
        for index, step in enumerate(doc["steps"]):
            if isinstance(step.get("explain"), dict) and step["explain"].get("fr"):
                return lesson_id, index, step
    pytest.skip("aucune étape avec explication dans le contenu")


def why_body(given: str = "mà", locale: str = "fr") -> dict[str, Any]:
    lesson_id, index, _ = explained_step()
    return {"lessonId": lesson_id, "stepIndex": index, "given": given, "expected": "má", "locale": locale}


# --- Salutation -----------------------------------------------------------------------------


def test_tutor_requires_auth(client: TestClient) -> None:
    assert client.get("/tutor/greeting").status_code == 401
    assert client.post("/tutor/why", json=why_body()).status_code == 401


def test_greeting_fallback_without_key(client: TestClient, auth: dict[str, str]) -> None:
    for _ in range(2):
        body = client.get("/tutor/greeting?locale=fr", headers=auth).json()
        assert body["source"] == "fallback"
        assert body["cached"] is False
        assert "Lan" in body["text"]
    assert "Lan" in client.get("/tutor/greeting?locale=en", headers=auth).json()["text"]
    assert count(client, TutorCache) == 0


def test_greeting_uses_context_and_is_cached(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM()
    use_llm(client, llm)
    wrong = {
        "sessionId": "s1",
        "lessonId": "vi-south.u01.l01",
        "stepIndex": 3,
        "exerciseType": "tone_identify",
        "conceptIds": ["c_ma_mom"],
        "correct": False,
        "nearMiss": False,
        "responseMs": 1500,
        "attempt": 1,
    }
    done = {"sessionId": "s1", "lessonId": "vi-south.u01.l01", "score": 0.8, "durationMs": 300000}
    post(client, auth, [event("answer_submitted", wrong), event("answer_submitted", wrong)])
    post(client, auth, [event("lesson_completed", done)])

    first = client.get("/tutor/greeting?locale=fr&localDate=2026-09-14", headers=auth).json()
    assert first == {"text": llm.default, "cached": False, "source": "model"}
    second = client.get("/tutor/greeting?locale=fr&localDate=2026-09-14", headers=auth).json()
    assert second == {"text": llm.default, "cached": True, "source": "model"}
    assert len(llm.calls) == 1

    system, turns = llm.calls[0]
    assert system == system_prompt(PACK)  # prompt système figé, sans donnée variable
    prompt = turns[0].content
    assert '"Lan"' in prompt
    lesson = lesson_document(PACK, "vi-south.u01.l01")
    assert lesson is not None and lesson["title"]["fr"] in prompt
    assert "má" in prompt  # point faible avec sa forme vietnamienne
    assert "French" in prompt

    # Autre langue ou autre jour : nouvelle génération.
    client.get("/tutor/greeting?locale=en&localDate=2026-09-14", headers=auth)
    client.get("/tutor/greeting?locale=fr&localDate=2026-09-15", headers=auth)
    assert len(llm.calls) == 3
    assert count(client, TutorMessage, role="assistant") == 3


def test_greeting_cache_expires_after_12h(client: TestClient, auth: dict[str, str]) -> None:
    use_llm(client, FakeLLM())
    client.get("/tutor/greeting?localDate=2026-09-14", headers=auth)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.scalars(select(TutorCache)).one()
        assert row.expires_at is not None
        assert row.expires_at - row.created_at == timedelta(hours=12)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert client.get("/tutor/greeting?localDate=2026-09-14", headers=auth).json()["cached"] is False


def test_south_guard_regenerates_once_then_accepts(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM(replies=["Chào Lan ! Hôm nay kể về bố nghen.", "Chào Lan ! Hôm nay kể về ba nghen."])
    use_llm(client, llm)
    body = client.get("/tutor/greeting", headers=auth).json()
    assert body == {"text": "Chào Lan ! Hôm nay kể về ba nghen.", "cached": False, "source": "model"}
    assert len(llm.calls) == 2
    corrective = llm.calls[1][1]
    assert [t.role for t in corrective] == ["user", "assistant", "user"]
    assert "«bố»" in corrective[-1].content
    assert "ba" in corrective[-1].content


def test_south_guard_falls_back_after_second_northern_answer(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM(replies=["Chào Lan ! Hỏi bố đi.", "Vâng, chào Lan !"])
    use_llm(client, llm)
    body = client.get("/tutor/greeting", headers=auth).json()
    assert body["source"] == "fallback"
    assert "bố" not in body["text"] and "Vâng" not in body["text"]
    assert len(llm.calls) == 2
    assert count(client, TutorCache) == 0
    assert count(client, TutorMessage) == 4  # deux appels journalisés


def test_guilt_inducing_or_too_long_output_is_regenerated(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM(replies=["Tu nous manques, Lan…", "x" * 400])
    use_llm(client, llm)
    assert client.get("/tutor/greeting", headers=auth).json()["source"] == "fallback"
    assert len(llm.calls) == 2


def test_model_error_falls_back(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM(replies=[TutorLLMError("timeout")])
    use_llm(client, llm)
    assert client.get("/tutor/greeting", headers=auth).json()["source"] == "fallback"
    _, _, step = explained_step()
    llm.replies = [TutorLLMError("overloaded")]
    body = client.post("/tutor/why", headers=auth, json=why_body()).json()
    assert body == {"text": step["explain"]["fr"], "cached": False, "source": "fallback"}


def test_quota_exceeded_falls_back(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM()
    use_llm(client, llm)
    app_settings(client).tutor_daily_quota = 1

    assert client.get("/tutor/greeting?locale=fr", headers=auth).json()["source"] == "model"
    resting = client.get("/tutor/greeting?locale=en", headers=auth).json()
    assert resting["source"] == "fallback"
    assert resting["text"].startswith("Cô Mai is resting")
    assert (
        client.get("/tutor/greeting?locale=fr&localDate=2031-01-01", headers=auth)
        .json()["text"]
        .startswith("Cô Mai se repose")
    )
    _, _, step = explained_step()
    assert client.post("/tutor/why", headers=auth, json=why_body()).json() == {
        "text": step["explain"]["fr"],
        "cached": False,
        "source": "fallback",
    }
    assert len(llm.calls) == 1


# --- « Pourquoi ? » -----------------------------------------------------------------------


def test_why_grounded_prompt_and_shared_cache(client: TestClient) -> None:
    alice = register(client)
    bob = register(client)
    llm = FakeLLM(default="má monte, mà descend : écoute la fin du mot.")
    use_llm(client, llm)

    first = client.post("/tutor/why", headers=alice, json=why_body("mà")).json()
    assert first == {"text": llm.default, "cached": False, "source": "model"}
    prompt = llm.calls[0][1][0].content
    _, index, step = explained_step()
    assert step["explain"]["fr"] in prompt
    assert f"Step {index} data" in prompt
    assert '"mà"' in prompt

    # Autre utilisateur, même erreur normalisée, quota épuisé : servi par le cache, sans appel.
    app_settings(client).tutor_daily_quota = 0
    second = client.post("/tutor/why", headers=bob, json=why_body("  MÀ. ")).json()
    assert second == {"text": llm.default, "cached": True, "source": "model"}
    assert len(llm.calls) == 1
    assert count(client, TutorMessage) == 2  # seul l'appel d'Alice est journalisé

    # Autre langue : clé différente (ici quota épuisé → explication du contenu).
    other = client.post("/tutor/why", headers=bob, json=why_body("mà", locale="en")).json()
    assert other["source"] == "fallback"
    assert other["text"] == step["explain"].get("en", step["explain"]["fr"])


def test_why_fallback_without_key_and_unknown_step(client: TestClient, auth: dict[str, str]) -> None:
    _, _, step = explained_step()
    body = client.post("/tutor/why", headers=auth, json=why_body()).json()
    assert body == {"text": step["explain"]["fr"], "cached": False, "source": "fallback"}

    bad = why_body()
    bad["stepIndex"] = 999
    assert client.post("/tutor/why", headers=auth, json=bad).status_code == 404
    bad = why_body()
    bad["lessonId"] = "vi-south.u99.l01"
    assert client.post("/tutor/why", headers=auth, json=bad).status_code == 404
    bad = why_body()
    bad["locale"] = "de"
    assert client.post("/tutor/why", headers=auth, json=bad).status_code == 422


def test_why_south_guard_falls_back_to_content(client: TestClient, auth: dict[str, str]) -> None:
    llm = FakeLLM(replies=["Au Nord on dit bố.", "Toujours bố."])
    use_llm(client, llm)
    _, _, step = explained_step()
    body = client.post("/tutor/why", headers=auth, json=why_body()).json()
    assert body == {"text": step["explain"]["fr"], "cached": False, "source": "fallback"}
    assert count(client, TutorCache) == 0


def test_normalize_answer() -> None:
    assert normalize_answer("  Mà. ") == normalize_answer("mà") == "mà"
    assert normalize_answer("Đây  là ba tôi !") == "đây là ba tôi"


# --- Limitation, purge -----------------------------------------------------------------------


def test_tutor_rate_limit_per_user(settings: Settings) -> None:
    settings.tutor_rate_limit = 2
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, base_url="https://testserver") as c:
        alice = register(c)
        bob = register(c)
        assert c.get("/tutor/greeting", headers=alice).status_code == 200
        assert c.get("/tutor/greeting", headers=alice).status_code == 200
        assert c.get("/tutor/greeting", headers=alice).status_code == 429
        assert c.get("/tutor/greeting", headers=bob).status_code == 200
    app.state.engine.dispose()


def test_purge_tutor_data(client: TestClient, auth: dict[str, str]) -> None:
    use_llm(client, FakeLLM())
    client.get("/tutor/greeting", headers=auth)
    now = datetime.now(UTC)
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        old = db.scalars(select(TutorMessage)).first()
        assert old is not None
        old.created_at = now - timedelta(days=91)
        db.commit()
        assert purge_tutor_data(db, now + timedelta(hours=13), retention_days=90) == (1, 1)
    assert count(client, TutorMessage) == 1
    assert count(client, TutorCache) == 0


def test_system_prompt_is_static_and_lists_southern_forms() -> None:
    prompt = system_prompt(PACK)
    assert "Southern Vietnamese only" in prompt
    assert "say ba (never bố)" in prompt
    assert str(datetime.now(UTC).year) not in prompt


# --- Adaptateur Anthropic (sans réseau) --------------------------------------------------------


class _Usage:
    input_tokens = 10
    cache_creation_input_tokens = 900
    cache_read_input_tokens = 0
    output_tokens = 25


class _Block:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


class _Response:
    def __init__(self, text: str, stop_reason: str = "end_turn") -> None:
        self.content = [_Block(text)]
        self.stop_reason = stop_reason
        self.usage = _Usage()


def test_anthropic_adapter_request_shape_and_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    import anthropic
    import httpx2

    from app.services.tutor_llm import AnthropicTutorLLM

    llm = AnthropicTutorLLM("sk-test", "claude-sonnet-4-6", 5.0)
    captured: dict[str, Any] = {}
    responses: list[Any] = [_Response(" Chào ! "), _Response("tronqué", "max_tokens")]

    def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        reply = responses.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(llm._client.messages, "create", fake_create)
    result = llm.complete(system="SYS", turns=[ChatTurn("user", "hello")], max_tokens=100)
    assert result == TutorCompletion(text="Chào !", input_tokens=910, output_tokens=25)
    assert captured["model"] == "claude-sonnet-4-6"
    assert captured["system"] == [{"type": "text", "text": "SYS", "cache_control": {"type": "ephemeral"}}]
    assert captured["messages"] == [{"role": "user", "content": "hello"}]

    with pytest.raises(TutorLLMError):
        llm.complete(system="SYS", turns=[ChatTurn("user", "hello")], max_tokens=100)
    responses.append(anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com")))
    with pytest.raises(TutorLLMError):
        llm.complete(system="SYS", turns=[ChatTurn("user", "hello")], max_tokens=100)
