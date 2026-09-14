"""`/tutor/*` : Cô Mai (salutation du jour, « pourquoi ? »). JWT obligatoire, limité par utilisateur."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.deps import CurrentUser, DbDep, PacksDep, SettingsDep
from app.schemas.tutor import TutorLocale, TutorReplyOut, WhyRequest
from app.services import tutor
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
