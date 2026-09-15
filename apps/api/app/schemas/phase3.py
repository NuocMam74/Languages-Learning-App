"""Schémas du contrat Phase 3 (docs/contracts/phase3.md) : conversation, ligues, défis entre amis, express."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.schemas import CamelModel
from app.schemas.events import GameId

TutorLocale = Literal["fr", "en"]
ConversationMode = Literal["free", "doi_dap"]

# --- Conversation ---------------------------------------------------------------------------


class Localized(CamelModel):
    fr: str
    en: str


class GlossOut(CamelModel):
    vi: str
    gloss: Localized


class CorrectionOut(CamelModel):
    original: str
    corrected: str
    explanation: str


class ConversationCreate(CamelModel):
    locale: TutorLocale = "fr"
    mode: ConversationMode = "free"
    topic_lesson_id: Annotated[str, Field(min_length=1, max_length=128)] | None = None


class OpeningOut(CamelModel):
    text: str
    glosses: list[GlossOut]


class ConversationCreated(CamelModel):
    conversation_id: str
    opening: OpeningOut


class MessageIn(CamelModel):
    text: Annotated[str, Field(min_length=1, max_length=500)]
    input_mode: Literal["text", "voice"] = "text"
    # Mode doi_dap : temps de réponse chronométré côté client (20 s par réponse).
    response_ms: Annotated[int, Field(ge=0, le=3_600_000)] | None = None


class TurnOut(CamelModel):
    role: Literal["user", "assistant"]
    text: str
    glosses: list[GlossOut]
    correction: CorrectionOut | None


class ConversationOut(CamelModel):
    id: str
    mode: ConversationMode
    turns: list[TurnOut]
    ended_at: datetime | None
    fluency: int | None


class ConversationEndOut(CamelModel):
    fluency: Annotated[int, Field(ge=0, le=100)] | None
    summary: dict[str, str]


class WeeklyDebriefOut(CamelModel):
    week_start: date
    progress: str
    struggles: str
    goal: str
    source: Literal["model", "fallback"]
    cached: bool


# --- Ligues ---------------------------------------------------------------------------------


class StandingOut(CamelModel):
    rank: int
    display_name: str
    xp: int
    is_me: bool


class LeagueOut(CamelModel):
    enabled: bool
    division: int | None = None
    division_name: Localized | None = None
    week_start: datetime | None = None
    week_end: datetime | None = None
    standings: list[StandingOut] | None = None
    promote_top: int | None = None
    relegate_bottom: int | None = None


# --- Défis entre amis & express ------------------------------------------------------------


class FriendChallengeCreate(CamelModel):
    kind: Literal["xp_7d"] = "xp_7d"


class FriendChallengeCreated(CamelModel):
    id: str
    invite_code: str
    invite_url: str
    ends_at: datetime


class ParticipantOut(CamelModel):
    display_name: str
    xp: int
    is_me: bool


class FriendChallengeJoined(CamelModel):
    id: str
    participants: list[ParticipantOut]
    ends_at: datetime


class FriendChallengeOut(CamelModel):
    id: str
    invite_code: str
    ends_at: datetime
    participants: list[ParticipantOut]


# Plafond de vraisemblance : justes × 10 + bonus vitesse (le bonus ne dépasse pas 1000 points).
EXPRESS_MAX_SPEED_BONUS = 1000


class ExpressScoreIn(CamelModel):
    game: GameId
    score: Annotated[int, Field(ge=0)]
    correct: Annotated[int, Field(ge=0, le=500)]
    total: Annotated[int, Field(ge=0, le=500)]
    local_date: date

    @model_validator(mode="after")
    def _plausible(self) -> "ExpressScoreIn":
        if self.correct > self.total:
            raise ValueError("correct greater than total")
        if self.score > self.correct * 10 + EXPRESS_MAX_SPEED_BONUS:
            raise ValueError("score not plausible")
        return self


class ExpressScoreOut(CamelModel):
    # Id du score (page publique `/partage/:id` via GET /share/express/{id}).
    id: str
    best: int
    rank_today: int | None


class ExpressShareOut(CamelModel):
    display_name: str
    game: str
    score: int
    created_at: datetime
