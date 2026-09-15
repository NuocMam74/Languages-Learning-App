"""Conversation avec Cô Mai (contrat Phase 3 §1) : flux SSE par phrase, garde du Sud, vocabulaire, gloses,
correction, quota, Đối đáp et débriefing hebdomadaire. Le modèle est un double local (jamais de réseau)."""

import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import REPO_ROOT
from app.models import Conversation, ConversationTurn, TutorCache, TutorMessage
from app.services import conversation as conv
from app.services.content import concept_documents, load_packs
from app.services.tutor import purge_tutor_data
from app.services.tutor_llm import ChatTurn, TutorCompletion, TutorLLMError
from tests.conftest import event
from tests.test_events import post
from tests.test_tutor import app_settings, count, use_llm

PACK = load_packs(REPO_ROOT / "content")["vi-south"]
META = conv.META_MARKER

Script = list[str] | Exception


@dataclass
class StreamLLM:
    """Double du modèle : chaque appel consomme un script (fragments de texte, ou exception)."""

    streams: list[Script] = field(default_factory=list)
    replies: list[str | Exception] = field(default_factory=list)
    calls: list[tuple[str, list[ChatTurn]]] = field(default_factory=list)

    def stream(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int) -> Iterator[str | TutorCompletion]:
        self.calls.append((system, list(turns)))
        script = self.streams.pop(0) if self.streams else [f"Dạ, chào Lan! {META} {{}}"]
        if isinstance(script, Exception):
            raise script
        for chunk in script:
            if chunk == "!boom":
                raise TutorLLMError("coupure réseau")
            yield chunk
        yield TutorCompletion(text="".join(script), input_tokens=100, output_tokens=20)

    def complete(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int) -> TutorCompletion:
        self.calls.append((system, list(turns)))
        reply = self.replies.pop(0) if self.replies else "{}"
        if isinstance(reply, Exception):
            raise reply
        return TutorCompletion(text=reply, input_tokens=100, output_tokens=20)


def sse_events(body: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def learn_basics(client: TestClient, auth: dict[str, str]) -> None:
    """Vocabulaire vu : leçons u01.l02 (chào, anh, dạ…) et u01.l03 (ba, tôi, đây là…)."""
    done = [
        event("lesson_completed", {"sessionId": "s1", "lessonId": lid, "score": 1, "durationMs": 1000})
        for lid in ("vi-south.u01.l02", "vi-south.u01.l03")
    ]
    assert post(client, auth, done)["rejected"] == []


def start(client: TestClient, auth: dict[str, str], mode: str = "free", locale: str = "fr") -> dict[str, Any]:
    res = client.post("/tutor/conversations", headers=auth, json={"locale": locale, "mode": mode})
    assert res.status_code == 201, res.text
    body: dict[str, Any] = res.json()
    return body


def say(client: TestClient, auth: dict[str, str], cid: str, text: str, **extra: Any) -> list[tuple[str, dict]]:
    res = client.post(f"/tutor/conversations/{cid}/messages", headers=auth, json={"text": text, **extra})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return sse_events(res.text)


def test_opening_without_key_uses_pack_welcome(client: TestClient, auth: dict[str, str]) -> None:
    body = start(client, auth)
    assert body["opening"] == {"text": PACK.raw["welcome"]["vi"], "glosses": []}
    events = say(client, auth, body["conversationId"], "Chào cô!")
    assert [e for e, _ in events] == ["fallback", "done"]
    assert events[0][1]["reason"] == "error"


def test_streams_checked_sentences_glosses_and_correction(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    assert "xôi" not in {c.get("vi") for c in concept_documents(PACK).values()}
    llm = StreamLLM(streams=[[f"Dạ, chào Lan! {META} {{}}"]])
    use_llm(client, llm)
    opening = start(client, auth)
    assert opening["opening"] == {"text": "Dạ, chào Lan!", "glosses": []}
    cid = opening["conversationId"]

    meta = {
        "glosses": [
            {"vi": "xôi", "fr": "riz gluant", "en": "sticky rice"},
            {"vi": "ba", "fr": "déjà connu", "en": "already known"},
        ],
        "correction": {"corrected": "Chào cô Mai!", "explanation": "On ajoute le nom après cô."},
    }
    llm.streams = [
        [
            "Dạ, chào ",
            "Lan! Đây là ba tôi, ba tôi là ",
            "ba nghen. Tôi ăn xôi. Chào! [[ME",
            "TA]] " + json.dumps(meta, ensure_ascii=False),
        ]
    ]
    events = say(client, auth, cid, "Chào cô!")
    assert events == [
        ("sentence", {"text": "Dạ, chào Lan!"}),
        ("sentence", {"text": "Đây là ba tôi, ba tôi là ba nghen."}),
        ("sentence", {"text": "Tôi ăn xôi."}),
        ("gloss", {"vi": "ăn", "gloss": {"fr": "manger", "en": "to eat"}}),  # glose du contenu
        ("gloss", {"vi": "xôi", "gloss": {"fr": "riz gluant", "en": "sticky rice"}}),  # glose du modèle
        (
            "correction",
            {"original": "Chào cô!", "corrected": "Chào cô Mai!", "explanation": "On ajoute le nom après cô."},
        ),
        ("done", {"turn": 1, "remainingToday": 28}),
    ]
    system, turns = llm.calls[-1]
    assert system == conv.conversation_system_prompt(PACK.directory)
    prompt = turns[0].content
    assert "chào" in prompt and "tôi" in prompt  # vocabulaire vu injecté
    assert '"Chào cô!"' in prompt and "Dạ, chào Lan!" in prompt  # message et historique comme données

    state = client.get(f"/tutor/conversations/{cid}", headers=auth).json()
    assert state["endedAt"] is None and state["fluency"] is None
    assert [t["role"] for t in state["turns"]] == ["assistant", "user", "assistant"]
    assert state["turns"][1]["correction"]["corrected"] == "Chào cô Mai!"
    assert state["turns"][2]["text"] == "Dạ, chào Lan! Đây là ba tôi, ba tôi là ba nghen. Tôi ăn xôi."
    assert [g["vi"] for g in state["turns"][2]["glosses"]] == ["ăn", "xôi"]
    assert "[[META]]" not in json.dumps(state)
    assert count(client, TutorMessage, role="user") == 2


def test_too_many_new_words_are_stripped(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    llm = StreamLLM(streams=[[f"Dạ! {META} {{}}"], [f"Chào Lan! Hôm nay trời mưa to quá. Tôi là ba. {META} {{}}"]])
    use_llm(client, llm)
    cid = start(client, auth)["conversationId"]
    events = say(client, auth, cid, "Chào cô!")
    assert [d["text"] for e, d in events if e == "sentence"] == ["Chào Lan!", "Tôi là ba."]


def test_all_sentences_stripped_regenerates_then_falls_back(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    unknown = f"Hôm nay trời mưa to quá. {META} {{}}"
    llm = StreamLLM(streams=[[f"Dạ! {META} {{}}"], [unknown], [unknown]])
    use_llm(client, llm)
    cid = start(client, auth)["conversationId"]
    events = say(client, auth, cid, "Chào cô!")
    assert events[0] == ("fallback", {"text": conv.fallback_text("fr", "error"), "reason": "error"})
    assert "too many words" in llm.calls[-1][1][-1].content


def test_south_guard_regenerates_mid_stream(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    llm = StreamLLM(
        streams=[
            [f"Dạ! {META} {{}}"],
            ["Chào Lan! ", "Đây là bố tôi. ", "Tôi là ba."],
            [f"Đây là ba tôi. {META} {{}}"],
        ]
    )
    use_llm(client, llm)
    cid = start(client, auth)["conversationId"]
    events = say(client, auth, cid, "Chào cô!")
    assert [e for e, _ in events] == ["sentence", "sentence", "done"]
    assert [d["text"] for _, d in events[:2]] == ["Chào Lan!", "Đây là ba tôi."]
    corrective = llm.calls[-1][1]
    assert [t.role for t in corrective] == ["user", "assistant", "user"]
    assert "«bố»" in corrective[-1].content and "ba" in corrective[-1].content
    assert "Chào Lan!" in corrective[-1].content  # déjà dit : ne pas répéter
    assert "bố" not in json.dumps(events, ensure_ascii=False)
    assert events[-1][1]["remainingToday"] == 27  # ouverture + 2 appels


def test_south_guard_falls_back_after_second_northern_answer(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    llm = StreamLLM(streams=[[f"Dạ! {META} {{}}"], ["Chào Lan! Đây là bố tôi. "], ["Vâng, tôi là ba."]])
    use_llm(client, llm)
    cid = start(client, auth)["conversationId"]
    events = say(client, auth, cid, "Chào cô!")
    assert [e for e, _ in events] == ["sentence", "fallback", "done"]
    assert events[1][1] == {"text": conv.fallback_text("fr", "south_guard"), "reason": "south_guard"}
    turns = client.get(f"/tutor/conversations/{cid}", headers=auth).json()["turns"]
    assert turns[-1] == {"role": "assistant", "text": events[1][1]["text"], "glosses": [], "correction": None}


def test_model_error_mid_stream_and_quota(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    llm = StreamLLM(streams=[[f"Dạ! {META} {{}}"], ["Chào Lan! Tôi là ba. ", "!boom"]])
    use_llm(client, llm)
    cid = start(client, auth, locale="en")["conversationId"]
    events = say(client, auth, cid, "Chào cô!")
    assert [e for e, _ in events] == ["sentence", "fallback", "done"]
    assert events[1][1]["reason"] == "error"

    app_settings(client).tutor_daily_quota = 2
    events = say(client, auth, cid, "Cảm ơn cô!")
    assert events[0] == ("fallback", {"text": conv.fallback_text("en", "quota"), "reason": "quota"})
    assert events[1] == ("done", {"turn": 2, "remainingToday": 0})
    assert len(llm.calls) == 2


def test_conversation_errors(client: TestClient, auth: dict[str, str]) -> None:
    cid = start(client, auth)["conversationId"]
    other = client.post(
        "/auth/register",
        json={"email": "o@example.com", "password": "correct-horse-battery", "displayName": "O", "locale": "fr"},
    ).json()["accessToken"]
    assert client.get(f"/tutor/conversations/{cid}", headers={"Authorization": f"Bearer {other}"}).status_code == 404
    assert client.post("/tutor/conversations/nope/messages", headers=auth, json={"text": "a"}).status_code == 404
    assert client.post(f"/tutor/conversations/{cid}/messages", headers=auth, json={"text": ""}).status_code == 422
    bad_topic = {"mode": "free", "topicLessonId": "vi-south.u99.l01"}
    assert client.post("/tutor/conversations", headers=auth, json=bad_topic).status_code == 422
    assert client.post("/tutor/conversations", json={}).status_code == 401
    client.post(f"/tutor/conversations/{cid}/end", headers=auth)
    assert client.post(f"/tutor/conversations/{cid}/messages", headers=auth, json={"text": "a"}).status_code == 409


def test_doi_dap_six_turns_and_fluency(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    corrected = json.dumps({"glosses": [], "correction": {"corrected": "Dạ, tôi là Lan.", "explanation": "Poli."}})
    streams: list[Script] = [[f"Chào Lan! {META} {{}}"]]
    streams += [[f"Dạ! Anh là ba? {META} " + (corrected if i == 0 else "{}")] for i in range(6)]
    use_llm(client, StreamLLM(streams=streams))
    cid = start(client, auth, mode="doi_dap")["conversationId"]
    times = [3000, 5000, 12500, 20000, 25000, None]
    for i, ms in enumerate(times):
        extra = {"responseMs": ms} if ms is not None else {}
        events = say(client, auth, cid, "Tôi là Lan." if i else "Tôi Lan.", **extra)
        assert events[-1][1]["turn"] == i + 1
    assert client.post(f"/tutor/conversations/{cid}/messages", headers=auth, json={"text": "a"}).status_code == 409

    ended = client.post(f"/tutor/conversations/{cid}/end", headers=auth).json()
    # P = 1 ; S = (1 + 1 + 0,5 + 0 + 0 + 0,5) / 6 = 0,5 ; A = 1 − 1/6 → round(100 × (0,5 + 0,15 + 0,1667)) = 82
    assert ended["fluency"] == 82
    assert ended["summary"]["fr"].startswith("6 échange(s) avec Cô Mai, 1 correction(s)")
    assert "82/100" in ended["summary"]["en"]
    assert client.post(f"/tutor/conversations/{cid}/end", headers=auth).json() == ended  # idempotent
    state = client.get(f"/tutor/conversations/{cid}", headers=auth).json()
    assert state["fluency"] == 82 and state["endedAt"] is not None


def test_fluency_formula_edges() -> None:
    assert conv.fluency([]) == 0

    def turn(ms: int | None, corrected: bool = False) -> ConversationTurn:
        return ConversationTurn(
            role="user", text="x", response_ms=ms, correction_json={"a": "b"} if corrected else None
        )

    assert conv.fluency([turn(1000)] * 6) == 100
    assert conv.fluency([turn(30000, corrected=True)] * 3) == 25  # 0,5 × 0,5


def test_free_conversation_end_has_no_fluency(client: TestClient, auth: dict[str, str]) -> None:
    cid = start(client, auth)["conversationId"]
    ended = client.post(f"/tutor/conversations/{cid}/end", headers=auth).json()
    assert ended["fluency"] is None
    assert set(ended["summary"]) == {"fr", "en"}


def test_purge_removes_old_conversations(client: TestClient, auth: dict[str, str]) -> None:
    cid = start(client, auth)["conversationId"]
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        row = db.get(Conversation, cid)
        assert row is not None
        row.created_at = datetime.now(UTC) - timedelta(days=91)
        db.commit()
        purge_tutor_data(db, retention_days=90)
    assert count(client, Conversation) == 0
    assert count(client, ConversationTurn) == 0


def test_sentence_splitter() -> None:
    assert conv.split_sentences("Chào! Đây là ba. Tôi") == (["Chào!", "Đây là ba."], "Tôi")
    assert conv.split_sentences("Hả?» Dạ… ừ") == (["Hả?»", "Dạ…"], "ừ")


# --- Débriefing hebdomadaire ----------------------------------------------------------------------


def test_debrief_fallback_built_from_data(client: TestClient, auth: dict[str, str]) -> None:
    learn_basics(client, auth)
    body = client.get("/tutor/debrief/weekly?locale=fr", headers=auth).json()
    assert body["source"] == "fallback" and body["cached"] is False
    assert body["progress"].startswith("2 leçon(s) terminée(s)")
    monday = datetime.now(UTC).date() - timedelta(days=datetime.now(UTC).weekday())
    assert body["weekStart"] == monday.isoformat()
    assert body["goal"].startswith("Cette semaine")
    assert client.get("/tutor/debrief/weekly?locale=en", headers=auth).json()["struggles"].startswith("Nothing")


def test_debrief_model_cached_per_week_and_locale(client: TestClient, auth: dict[str, str]) -> None:
    reply = json.dumps({"progress": "Deux leçons !", "struggles": "Les tons.", "goal": "Trois séances."})
    llm = StreamLLM(replies=[reply, reply])
    use_llm(client, llm)
    first = client.get("/tutor/debrief/weekly?locale=fr", headers=auth).json()
    assert (first["progress"], first["source"], first["cached"]) == ("Deux leçons !", "model", False)
    second = client.get("/tutor/debrief/weekly?locale=fr", headers=auth).json()
    assert (second["goal"], second["cached"]) == ("Trois séances.", True)
    assert len(llm.calls) == 1
    client.get("/tutor/debrief/weekly?locale=en", headers=auth)
    assert len(llm.calls) == 2
    with client.app.state.session_factory() as db:  # type: ignore[attr-defined]
        rows = list(db.scalars(select(TutorCache).where(TutorCache.kind == "debrief")))
    assert len(rows) == 2
    assert all(r.expires_at is not None and r.expires_at.weekday() == 0 for r in rows)


@pytest.mark.parametrize(
    "replies",
    [
        [TutorLLMError("timeout")],
        ['{"progress": "Ton bố est fier.", "struggles": "x", "goal": "y"}'] * 2,
        ["pas du JSON"],
    ],
)
def test_debrief_falls_back_on_model_problems(client: TestClient, auth: dict[str, str], replies: list) -> None:
    use_llm(client, StreamLLM(replies=list(replies)))
    body = client.get("/tutor/debrief/weekly", headers=auth).json()
    assert body["source"] == "fallback"
    assert count(client, TutorCache) == 0


# --- Adaptateur Anthropic en flux (sans réseau) ------------------------------------------------------


class _FakeStream:
    def __init__(self, chunks: list[str], final: Any, error: Exception | None = None) -> None:
        self._chunks, self._final, self._error = chunks, final, error

    def __enter__(self) -> "_FakeStream":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    @property
    def text_stream(self) -> Iterator[str]:
        yield from self._chunks
        if self._error is not None:
            raise self._error

    def get_final_message(self) -> Any:
        return self._final


def test_anthropic_adapter_streams_text_then_completion(monkeypatch: pytest.MonkeyPatch) -> None:
    import anthropic
    import httpx2

    from app.services.tutor_llm import AnthropicTutorLLM
    from tests.test_tutor import _Response

    llm = AnthropicTutorLLM("sk-test", "claude-sonnet-4-6", 5.0)
    captured: dict[str, Any] = {}
    streams = [
        _FakeStream(["Chào ", "Lan!"], _Response("Chào Lan!")),
        _FakeStream(["Chào"], _Response("Chào", "max_tokens")),
        _FakeStream(["Chào"], None, anthropic.APIConnectionError(request=httpx2.Request("POST", "https://x"))),
    ]

    def fake_stream(**kwargs: Any) -> _FakeStream:
        captured.update(kwargs)
        return streams.pop(0)

    monkeypatch.setattr(llm._client.messages, "stream", fake_stream)
    items = list(llm.stream(system="SYS", turns=[ChatTurn("user", "hi")], max_tokens=50))
    assert items == ["Chào ", "Lan!", TutorCompletion(text="Chào Lan!", input_tokens=910, output_tokens=25)]
    assert captured["system"] == [{"type": "text", "text": "SYS", "cache_control": {"type": "ephemeral"}}]
    assert captured["model"] == "claude-sonnet-4-6" and captured["max_tokens"] == 50
    with pytest.raises(TutorLLMError):
        list(llm.stream(system="SYS", turns=[ChatTurn("user", "hi")], max_tokens=50))
    with pytest.raises(TutorLLMError):
        list(llm.stream(system="SYS", turns=[ChatTurn("user", "hi")], max_tokens=50))
