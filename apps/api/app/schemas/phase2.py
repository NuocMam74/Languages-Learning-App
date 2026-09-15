"""Schémas du contrat Phase 2 (docs/contracts/phase2.md) : examens, certificats, défis, push."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field

from app.schemas import CamelModel

Skill = Literal["listening", "reading", "vocabulary", "speaking"]

# --- Examens --------------------------------------------------------------------------------


class ExamScores(CamelModel):
    """Null : compétence sans item noté (médias manquants), exclue de la règle « chaque compétence ≥ 0,5 »."""

    listening: float | None
    reading: float | None
    vocabulary: float | None
    speaking: float | None


class LastAttemptOut(CamelModel):
    id: str
    submitted_at: datetime
    passed: bool
    scores: ExamScores
    global_: Annotated[float | None, Field(alias="global")] = None


class ExamOut(CamelModel):
    id: str
    level: str
    certificate: dict[str, str]
    requires_units: list[str]
    duration_minutes: int
    unlocked: bool
    last_attempt: LastAttemptOut | None
    next_attempt_at: datetime | None
    # « media_missing » : moins de 15 items notables faute d'audio natif / de référence F0 (contrat parcours §1).
    unavailable_reason: Literal["media_missing"] | None = None


class ExamItemRef(CamelModel):
    section: Skill
    index: int


class ExamStartOut(CamelModel):
    attempt_id: str
    seed: str
    started_at: datetime
    expires_at: datetime
    items: list[ExamItemRef]


# Miroir de `ExerciseResponse` (packages/core/src/engine.ts).
class ChoiceResponse(CamelModel):
    kind: Literal["choice"]
    option_id: Annotated[str, Field(max_length=128)]


class TokensResponse(CamelModel):
    kind: Literal["tokens"]
    option_ids: Annotated[list[Annotated[str, Field(max_length=16)]], Field(max_length=64)]


class SpeechResponse(CamelModel):
    kind: Literal["speech"]
    # Borné à 0..100 à la notation (score calculé localement).
    score: float | None


class GameResponse(CamelModel):
    kind: Literal["game"]
    correct: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0)]


class SkipResponse(CamelModel):
    kind: Literal["skip"]


ExerciseResponse = Annotated[
    ChoiceResponse | TokensResponse | SpeechResponse | GameResponse | SkipResponse, Field(discriminator="kind")
]


class ExamAnswer(CamelModel):
    section: Skill
    index: Annotated[int, Field(ge=0, le=200)]
    response: ExerciseResponse
    response_ms: Annotated[float, Field(ge=0)]


class ExamSubmit(CamelModel):
    answers: Annotated[list[ExamAnswer], Field(max_length=200)]


class GapOut(CamelModel):
    skill: Skill
    concept_ids: list[str]


class CertificateRef(CamelModel):
    id: str
    verification_code: str


class ExamResultOut(CamelModel):
    passed: bool
    global_: Annotated[float, Field(alias="global")]
    scores: ExamScores
    gaps: list[GapOut]
    certificate: CertificateRef | None


# --- Certificats ----------------------------------------------------------------------------


class CertificateOut(CamelModel):
    id: str
    level: str
    issued_at: datetime
    verification_code: str
    pdf_url: str
    # Image de partage générée côté client (canvas) : toujours null côté API.
    share_image_url: str | None


class VerifyOut(CamelModel):
    valid: bool
    display_name: str
    level: str
    certificate: dict[str, str]
    issued_at: datetime
    scores: ExamScores


# --- Défis ----------------------------------------------------------------------------------

ChallengeKind = Literal["words_theme", "streak_days", "speaking_minutes", "lessons", "game_score"]


class ChallengeOut(CamelModel):
    id: str
    kind: ChallengeKind
    title: dict[str, str]
    target: int
    unit: str | None
    progress: int
    completed_at: datetime | None
    claimed_at: datetime | None
    period_start: datetime
    period_end: datetime
    badge_code: str


class ClaimOut(CamelModel):
    claimed_at: datetime
    xp: int


# --- Push -----------------------------------------------------------------------------------


class VapidKeyOut(CamelModel):
    key: str


class PushKeys(CamelModel):
    p256dh: Annotated[str, Field(min_length=1, max_length=256)]
    auth: Annotated[str, Field(min_length=1, max_length=128)]


class PushSubscribeIn(CamelModel):
    endpoint: Annotated[str, Field(min_length=8, max_length=1024, pattern=r"^https://")]
    keys: PushKeys
    reminder_hour: Annotated[int, Field(ge=0, le=23)]
    timezone: Annotated[str, Field(min_length=1, max_length=64)]


class PushUnsubscribeIn(CamelModel):
    endpoint: Annotated[str, Field(min_length=1, max_length=1024)]
