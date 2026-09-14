"""Schémas d'authentification."""

from typing import Literal

from pydantic import EmailStr, Field

from app.schemas import CamelModel

Locale = Literal["fr", "en"]


class RegisterRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    display_name: str = Field(min_length=1, max_length=80)
    locale: Locale = "fr"


class LoginRequest(CamelModel):
    # Pas de validation de format à la connexion : on compare simplement à l'email stocké.
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(CamelModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105
    expires_in: int
