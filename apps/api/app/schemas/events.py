"""Événements pédagogiques — miroir de `packages/core/src/events.ts` (ADR 0004).

Union discriminée sur `type`, champs en camelCase, formes strictes (`extra="forbid"`).
"""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, TypeAdapter

from app.schemas import CamelModel

SessionSource = Literal["daily", "lesson", "review", "game", "placement"]
SrsState = Literal["new", "learning", "review", "relearning"]
# Miroir de `StepType` (packages/core/src/types.ts).
StepType = Literal[
    "culture_card",
    "listen_pick_image",
    "listen_pick_text",
    "listen_transcribe",
    "tone_identify",
    "tone_minimal_pair",
    "tone_produce",
    "speak_repeat",
    "match_pairs",
    "build_sentence",
    "fill_gap",
    "translate_to_vi",
    "translate_to_fr",
    "spot_the_south",
    "game",
]

# Miroir de `GameId` (packages/core/src/types.ts).
GameId = Literal["cho_noi", "karaoke_tonal", "xe_om", "bua_com", "doi_dap", "nho_mat"]

NonNegative = Annotated[float, Field(ge=0)]
Id = Annotated[str, Field(min_length=1, max_length=128)]
SessionId = Annotated[str, Field(min_length=1, max_length=64)]


class SrsCardIn(CamelModel):
    concept_id: Id
    due: AwareDatetime
    stability: float
    difficulty: float
    scheduled_days: float
    learning_steps: int
    reps: Annotated[int, Field(ge=0)]
    lapses: Annotated[int, Field(ge=0)]
    state: SrsState
    last_review: AwareDatetime | None


class _BaseEvent(CamelModel):
    id: UUID
    occurred_at: AwareDatetime
    schema_version: Literal[1]


class SessionStartedPayload(CamelModel):
    session_id: SessionId
    source: SessionSource
    planned_seconds: NonNegative


class AnswerSubmittedPayload(CamelModel):
    session_id: SessionId
    lesson_id: Id | None
    step_index: Annotated[int, Field(ge=0)]
    exercise_type: StepType
    concept_ids: list[Id]
    correct: bool
    near_miss: bool
    response_ms: NonNegative
    attempt: Annotated[int, Field(ge=1)]


class SrsCardUpdatedPayload(CamelModel):
    card: SrsCardIn


class LessonCompletedPayload(CamelModel):
    session_id: SessionId
    lesson_id: Id
    score: Annotated[float, Field(ge=0, le=1)]
    duration_ms: NonNegative


class SessionCompletedPayload(CamelModel):
    session_id: SessionId
    xp_gained: Annotated[int, Field(ge=0, le=100_000)]
    items_count: Annotated[int, Field(ge=0)]
    duration_ms: NonNegative
    local_date: date


class PlacementCompletedPayload(CamelModel):
    level_estimate: Annotated[int, Field(ge=0, le=3)]
    entry_lesson_id: Id
    correct: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]
    # Informatif : le client envoie les cartes SRS de départ en `srs_card_updated`.
    known_concept_ids: Annotated[list[Id], Field(max_length=2000)]


class BadgeEarnedPayload(CamelModel):
    badge_code: Annotated[str, Field(min_length=1, max_length=64)]


class PronunciationScoredPayload(CamelModel):
    session_id: SessionId | None
    concept_id: Id
    score: Annotated[float, Field(ge=0, le=100)]
    exercise_type: StepType


class StreakFrozenPayload(CamelModel):
    frozen_until: date
    local_date: date


class GamePlayedPayload(CamelModel):
    game: GameId
    correct: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]
    duration_ms: NonNegative
    local_date: date


class SessionStarted(_BaseEvent):
    type: Literal["session_started"]
    payload: SessionStartedPayload


class AnswerSubmitted(_BaseEvent):
    type: Literal["answer_submitted"]
    payload: AnswerSubmittedPayload


class SrsCardUpdated(_BaseEvent):
    type: Literal["srs_card_updated"]
    payload: SrsCardUpdatedPayload


class LessonCompleted(_BaseEvent):
    type: Literal["lesson_completed"]
    payload: LessonCompletedPayload


class PronunciationScored(_BaseEvent):
    type: Literal["pronunciation_scored"]
    payload: PronunciationScoredPayload


class StreakFrozen(_BaseEvent):
    type: Literal["streak_frozen"]
    payload: StreakFrozenPayload


class GamePlayed(_BaseEvent):
    type: Literal["game_played"]
    payload: GamePlayedPayload


class SessionCompleted(_BaseEvent):
    type: Literal["session_completed"]
    payload: SessionCompletedPayload


class PlacementCompleted(_BaseEvent):
    type: Literal["placement_completed"]
    payload: PlacementCompletedPayload


class BadgeEarned(_BaseEvent):
    type: Literal["badge_earned"]
    payload: BadgeEarnedPayload


ParloEvent = Annotated[
    SessionStarted
    | AnswerSubmitted
    | SrsCardUpdated
    | PlacementCompleted
    | BadgeEarned
    | PronunciationScored
    | StreakFrozen
    | GamePlayed
    | LessonCompleted
    | SessionCompleted,
    Field(discriminator="type"),
]
event_adapter: TypeAdapter[ParloEvent] = TypeAdapter(ParloEvent)

MAX_BATCH = 500


class EventBatch(CamelModel):
    # Événements bruts : chacun est validé individuellement pour qu'un événement
    # malformé soit rejeté seul, sans bloquer le reste de la file hors ligne.
    events: Annotated[list[dict[str, object]], Field(max_length=MAX_BATCH)]


class RejectedEvent(CamelModel):
    id: str
    reason: str


class EventBatchResult(CamelModel):
    accepted: list[str]
    rejected: list[RejectedEvent]
