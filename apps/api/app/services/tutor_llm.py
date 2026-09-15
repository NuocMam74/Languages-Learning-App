"""Accès au modèle de Cô Mai derrière une interface minimale (remplaçable en test, jamais de réseau).

Seule `AnthropicTutorLLM` parle à l'API Anthropic. Toute erreur (réseau, délai, 4xx/5xx, refus,
réponse tronquée) est convertie en `TutorLLMError` : l'appelant retombe alors sur un message préécrit.
"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

import anthropic
from anthropic.types import Message, MessageParam, TextBlockParam


@dataclass(frozen=True)
class ChatTurn:
    role: Literal["user", "assistant"]
    content: str


@dataclass(frozen=True)
class TutorCompletion:
    text: str
    input_tokens: int
    output_tokens: int


class TutorLLMError(Exception):
    """Échec d'appel au modèle : déclenche le repli préécrit."""


class TutorLLM(Protocol):
    def complete(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int) -> TutorCompletion:
        """Une réponse texte pour `turns` (le dernier tour est `user`)."""
        ...

    def stream(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int) -> Iterator[str | TutorCompletion]:
        """Fragments de texte au fil de l'eau, puis une `TutorCompletion` finale (texte complet et jetons).

        Lève `TutorLLMError` (éventuellement en cours d'itération).
        """
        ...


class AnthropicTutorLLM:
    """Client synchrone (les routes FastAPI `def` tournent dans le pool de threads)."""

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        # Un seul nouvel essai : l'utilisateur attend, le repli préécrit vaut mieux qu'une longue attente.
        self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout_seconds, max_retries=1)
        self._model = model

    @staticmethod
    def _request(system: str, turns: Sequence[ChatTurn]) -> tuple[list[TextBlockParam], list[MessageParam]]:
        system_blocks: list[TextBlockParam] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        messages: list[MessageParam] = [{"role": t.role, "content": t.content} for t in turns]
        return system_blocks, messages

    @staticmethod
    def _completion(response: Message) -> TutorCompletion:
        if response.stop_reason not in ("end_turn", "stop_sequence"):
            raise TutorLLMError(f"stop_reason={response.stop_reason}")
        text = "".join(block.text for block in response.content if block.type == "text").strip()
        if not text:
            raise TutorLLMError("réponse vide")
        usage = response.usage
        input_tokens = (
            usage.input_tokens + (usage.cache_creation_input_tokens or 0) + (usage.cache_read_input_tokens or 0)
        )
        return TutorCompletion(text=text, input_tokens=input_tokens, output_tokens=usage.output_tokens)

    def stream(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int) -> Iterator[str | TutorCompletion]:
        system_blocks, messages = self._request(system, turns)
        try:
            with self._client.messages.stream(
                model=self._model, max_tokens=max_tokens, system=system_blocks, messages=messages
            ) as stream:
                yield from stream.text_stream
                final = stream.get_final_message()
        except anthropic.APIError as exc:
            raise TutorLLMError(f"{type(exc).__name__}: {exc}") from exc
        yield self._completion(final)

    def complete(self, *, system: str, turns: Sequence[ChatTurn], max_tokens: int) -> TutorCompletion:
        # Prompt système figé et marqué pour le cache de prompt ; le contexte dynamique est dans les tours.
        system_blocks: list[TextBlockParam] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        messages: list[MessageParam] = [{"role": t.role, "content": t.content} for t in turns]
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                system=system_blocks,
                messages=messages,
            )
        except anthropic.APIError as exc:  # APIStatusError, APIConnectionError, APITimeoutError…
            raise TutorLLMError(f"{type(exc).__name__}: {exc}") from exc

        if response.stop_reason not in ("end_turn", "stop_sequence"):
            raise TutorLLMError(f"stop_reason={response.stop_reason}")
        text = "".join(block.text for block in response.content if block.type == "text").strip()
        if not text:
            raise TutorLLMError("réponse vide")
        usage = response.usage
        input_tokens = (
            usage.input_tokens + (usage.cache_creation_input_tokens or 0) + (usage.cache_read_input_tokens or 0)
        )
        return TutorCompletion(text=text, input_tokens=input_tokens, output_tokens=usage.output_tokens)
