"""Limitation de débit. Interface minimale pour pouvoir passer sur Redis sans toucher aux routes."""

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from typing import Protocol


class RateLimiter(Protocol):
    def hit(self, key: str) -> bool:
        """Enregistre une requête pour `key` ; False si la limite est dépassée."""
        ...


class InMemorySlidingWindow:
    """Fenêtre glissante en mémoire (un seul processus : suffisant en Phase 0)."""

    def __init__(self, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        now = self._clock()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - self._window:
                hits.popleft()
            if len(hits) >= self._limit:
                return False
            hits.append(now)
            return True
