"""Schémas de `/tutor/*` (Cô Mai)."""

from typing import Annotated, Literal

from pydantic import Field

from app.schemas import CamelModel

TutorLocale = Literal["fr", "en"]


class TutorReplyOut(CamelModel):
    text: str
    # Vrai si la réponse vient du cache serveur (aucun appel au modèle, aucun quota consommé).
    cached: bool
    # « model » : texte généré (et vérifié par la garde du Sud) ; « fallback » : message préécrit.
    source: Literal["model", "fallback"]


class WhyRequest(CamelModel):
    lesson_id: Annotated[str, Field(min_length=1, max_length=128)]
    step_index: Annotated[int, Field(ge=0, le=1000)]
    given: Annotated[str, Field(max_length=200)]
    expected: Annotated[str, Field(max_length=200)]
    locale: TutorLocale = "fr"
