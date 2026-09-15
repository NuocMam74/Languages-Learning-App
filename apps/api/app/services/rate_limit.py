"""Limitation de débit et IP client réelle derrière un proxy de confiance (contrat parcours §4).

Interface minimale pour pouvoir passer sur Redis sans toucher aux routes.
"""

import ipaddress
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable, Sequence
from typing import Protocol

IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


class RateLimiter(Protocol):
    def hit(self, key: str) -> bool:
        """Enregistre une requête pour `key` ; False si la limite est dépassée."""
        ...


class InMemorySlidingWindow:
    """Fenêtre glissante en mémoire, par processus ; les clés inactives sont purgées (mémoire bornée)."""

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 10_000,
    ) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._max_keys = max_keys
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        now = self._clock()
        with self._lock:
            if key not in self._hits and len(self._hits) >= self._max_keys:
                self._purge(now)
            hits = self._hits[key]
            while hits and hits[0] <= now - self._window:
                hits.popleft()
            if len(hits) >= self._limit:
                return False
            hits.append(now)
            return True

    def _purge(self, now: float) -> None:
        stale = [k for k, hits in self._hits.items() if not hits or hits[-1] <= now - self._window]
        for k in stale:
            del self._hits[k]

    def __len__(self) -> int:
        return len(self._hits)


def parse_networks(values: Sequence[str]) -> list[IpNetwork]:
    out: list[IpNetwork] = []
    for value in values:
        try:
            out.append(ipaddress.ip_network(value.strip(), strict=False))
        except ValueError:
            continue
    return out


def _in_networks(address: str, networks: Sequence[IpNetwork]) -> bool:
    try:
        ip = ipaddress.ip_address(address.strip())
    except ValueError:
        return False
    return any(ip.version == net.version and ip in net for net in networks)


def client_ip(peer: str | None, forwarded_for: str | None, trusted: Sequence[IpNetwork]) -> str:
    """IP réelle : pair direct, sauf s'il est un proxy de confiance ; X-Forwarded-For lu de droite à gauche en
    sautant les proxys de confiance (le premier saut non fiable est le client)."""
    peer = peer or "unknown"
    if not trusted or not forwarded_for or not _in_networks(peer, trusted):
        return peer
    hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
    for hop in reversed(hops):
        if not _in_networks(hop, trusted):
            return hop
    return hops[0] if hops else peer
