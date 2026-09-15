"""`/tutor/*` : Cô Mai (salutation, « pourquoi ? », conversation, débriefing). JWT et limitation par utilisateur."""

from collections.abc import Iterator
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.deps import CurrentUser, DbDep, PacksDep, SettingsDep
from app.schemas.phase3 import (
    ConversationCreate,
    ConversationCreated,
    ConversationEndOut,
    ConversationOut,
    CorrectionOut,
    GlossOut,
    MessageIn,
    OpeningOut,
    TurnOut,
    WeeklyDebriefOut,
)
from app.schemas.tutor import TutorLocale, TutorReplyOut, WhyRequest
from app.services import conversation, debrief, tutor
from app.services.rate_limit import RateLimiter
from app.services.tutor_llm import TutorLLM


def tutor_rate_limit(request: Request, user: CurrentUser) -> None:
    limiter: RateLimiter = request.app.state.tutor_rate_limiter
    if not limiter.hit(f"tutor:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Doucement ! Cô Mai reprend son souffle."
        )


def get_tutor_llm(request: Request) -> TutorLLM | None:
    llm: TutorLLM | None = request.app.state.tutor_llm
    return llm


TutorLLMDep = Annotated[TutorLLM | None, Depends(get_tutor_llm)]

router = APIRouter(prefix="/tutor", tags=["tutor"], dependencies=[Depends(tutor_rate_limit)])


def _out(reply: tutor.TutorReply) -> TutorReplyOut:
    return TutorReplyOut(text=reply.text, cached=reply.cached, source=reply.source)


@router.get("/greeting", response_model=TutorReplyOut)
def greeting(
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
    packs: PacksDep,
    llm: TutorLLMDep,
    locale: TutorLocale = "fr",
    local_date: Annotated[
        date | None, Query(alias="localDate", description="Jour local du client (AAAA-MM-JJ)")
    ] = None,
) -> TutorReplyOut:
    return _out(tutor.daily_greeting(db, llm, settings, packs, user, locale, local_date))


@router.post("/why", response_model=TutorReplyOut)
def why(
    body: WhyRequest, user: CurrentUser, db: DbDep, settings: SettingsDep, packs: PacksDep, llm: TutorLLMDep
) -> TutorReplyOut:
    try:
        reply = tutor.explain_why(
            db,
            llm,
            settings,
            packs,
            user,
            lesson_id=body.lesson_id,
            step_index=body.step_index,
            given=body.given,
            expected=body.expected,
            locale=body.locale,
        )
    except tutor.TutorNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _out(reply)


# --- Conversation (contrat Phase 3 §1) ------------------------------------------------------

_CONVERSATION_STATUS = {
    "conversation_not_found": status.HTTP_404_NOT_FOUND,
    "unknown_lesson": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "conversation_ended": status.HTTP_409_CONFLICT,
    "conversation_complete": status.HTTP_409_CONFLICT,
    "tutor_unavailable": status.HTTP_409_CONFLICT,
}


def _conversation_http_error(exc: conversation.ConversationError) -> HTTPException:
    return HTTPException(_CONVERSATION_STATUS.get(str(exc), status.HTTP_409_CONFLICT), detail=str(exc))


def _glosses(items: list[dict[str, Any]] | None) -> list[GlossOut]:
    return [GlossOut.model_validate(g) for g in items or []]


@router.post("/conversations", response_model=ConversationCreated, status_code=status.HTTP_201_CREATED)
def create_conversation(
    body: ConversationCreate, user: CurrentUser, db: DbDep, settings: SettingsDep, packs: PacksDep, llm: TutorLLMDep
) -> ConversationCreated:
    try:
        conv, opening = conversation.start_conversation(
            db, llm, settings, packs, user, locale=body.locale, mode=body.mode, topic_lesson_id=body.topic_lesson_id
        )
    except conversation.ConversationError as exc:
        db.rollback()
        raise _conversation_http_error(exc) from exc
    return ConversationCreated(
        conversation_id=conv.id, opening=OpeningOut(text=opening.text, glosses=_glosses(opening.glosses_json))
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {"text/event-stream": {}},
            "description": "Flux SSE : sentence, gloss, correction, done, fallback",
        }
    },
)
def post_message(
    conversation_id: str,
    body: MessageIn,
    request: Request,
    user: CurrentUser,
    db: DbDep,
    settings: SettingsDep,
    packs: PacksDep,
    llm: TutorLLMDep,
) -> StreamingResponse:
    try:
        prepared = conversation.prepare_turn(db, settings, packs, user, conversation_id, body.text, body.response_ms)
    except conversation.ConversationError as exc:
        db.rollback()
        raise _conversation_http_error(exc) from exc
    session_factory = request.app.state.session_factory

    def events() -> Iterator[str]:
        # Session propre au flux : celle de la requête peut être fermée avant la fin de la réponse.
        with session_factory() as stream_db:
            yield from conversation.stream_turn(stream_db, llm, settings, prepared)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(conversation_id: str, user: CurrentUser, db: DbDep) -> ConversationOut:
    try:
        conv = conversation.get_owned(db, user.id, conversation_id)
    except conversation.ConversationError as exc:
        raise _conversation_http_error(exc) from exc
    return ConversationOut(
        id=conv.id,
        mode=conv.mode,  # type: ignore[arg-type]
        turns=[
            TurnOut(
                role=t.role,  # type: ignore[arg-type]
                text=t.text,
                glosses=_glosses(t.glosses_json),
                correction=CorrectionOut.model_validate(t.correction_json) if t.correction_json else None,
            )
            for t in conversation.turns_of(db, conv.id)
        ],
        ended_at=conv.ended_at,
        fluency=conv.fluency,
    )


@router.post("/conversations/{conversation_id}/end", response_model=ConversationEndOut)
def end_conversation(conversation_id: str, user: CurrentUser, db: DbDep) -> ConversationEndOut:
    try:
        conv = conversation.end_conversation(db, user.id, conversation_id)
    except conversation.ConversationError as exc:
        raise _conversation_http_error(exc) from exc
    return ConversationEndOut(fluency=conv.fluency, summary=conv.summary_json or {})


@router.get("/debrief/weekly", response_model=WeeklyDebriefOut)
def weekly_debrief(
    user: CurrentUser, db: DbDep, settings: SettingsDep, packs: PacksDep, llm: TutorLLMDep, locale: TutorLocale = "fr"
) -> WeeklyDebriefOut:
    result = debrief.weekly_debrief(db, llm, settings, packs, user, locale)
    return WeeklyDebriefOut(
        week_start=result.week_start,
        progress=result.progress,
        struggles=result.struggles,
        goal=result.goal,
        source=result.source,  # type: ignore[arg-type]
        cached=result.cached,
    )
