"""Défis entre amis et défi express (spec §5.2, contrat Phase 3 §3).

- Défi entre amis `xp_7d` : 7 jours à partir de la création, jusqu'à 10 participants ; score = XP gagnée pendant
  la période (mêmes sources que les ligues : séances terminées + défis réclamés). Code d'invitation : 8 caractères
  Crockford base32 (sans I, L, O, U) ; à la saisie, minuscules acceptées et I/L → 1, O → 0, tirets ignorés.
- Défi express : un score par partie ; meilleur score du jour (jour local) par jeu et rang du jour parmi les
  meilleurs scores de chaque joueur. Pas de chat, seulement le nom affiché (spec §14).
"""

import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ExpressScore, FriendChallenge, FriendChallengeParticipant, User
from app.services.leagues import xp_between

CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 8
MAX_PARTICIPANTS = 10
CHALLENGE_DURATION = timedelta(days=7)
# Défis entre amis en cours créés par un même utilisateur.
MAX_ACTIVE_CREATED = 5

_DECODE_ALIASES = str.maketrans({"I": "1", "L": "1", "O": "0"})


class FriendChallengeError(Exception):
    """Refus métier (`challenge_not_found`, `challenge_ended`, `challenge_full`, `too_many_challenges`)."""


@dataclass(frozen=True)
class Participant:
    user_id: str
    display_name: str
    xp: int


def generate_code() -> str:
    return "".join(secrets.choice(CROCKFORD_ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(raw: str) -> str | None:
    code = raw.strip().replace("-", "").upper().translate(_DECODE_ALIASES)
    if len(code) != CODE_LENGTH or any(c not in CROCKFORD_ALPHABET for c in code):
        return None
    return code


def create_challenge(db: Session, user_id: str, kind: str, now: datetime) -> FriendChallenge:
    active = db.scalar(
        select(func.count())
        .select_from(FriendChallenge)
        .where(FriendChallenge.creator_id == user_id, FriendChallenge.ends_at > now)
    )
    if (active or 0) >= MAX_ACTIVE_CREATED:
        raise FriendChallengeError("too_many_challenges")
    for _ in range(5):
        challenge = FriendChallenge(
            kind=kind, invite_code=generate_code(), creator_id=user_id, starts_at=now, ends_at=now + CHALLENGE_DURATION
        )
        try:
            with db.begin_nested():
                db.add(challenge)
                db.flush()
                db.add(FriendChallengeParticipant(challenge_id=challenge.id, user_id=user_id, joined_at=now))
                db.flush()
        except IntegrityError:  # collision de code (32^8 : très improbable)
            continue
        return challenge
    raise FriendChallengeError("code_generation_failed")


def join_challenge(db: Session, user_id: str, raw_code: str, now: datetime) -> FriendChallenge:
    code = normalize_code(raw_code)
    challenge = db.scalar(select(FriendChallenge).where(FriendChallenge.invite_code == code)) if code else None
    if challenge is None:
        raise FriendChallengeError("challenge_not_found")
    if db.get(FriendChallengeParticipant, (challenge.id, user_id)) is not None:
        return challenge  # idempotent
    if challenge.ends_at <= now:
        raise FriendChallengeError("challenge_ended")
    count = db.scalar(
        select(func.count())
        .select_from(FriendChallengeParticipant)
        .where(FriendChallengeParticipant.challenge_id == challenge.id)
    )
    if (count or 0) >= MAX_PARTICIPANTS:
        raise FriendChallengeError("challenge_full")
    db.add(FriendChallengeParticipant(challenge_id=challenge.id, user_id=user_id, joined_at=now))
    db.flush()
    return challenge


def participants(db: Session, challenge: FriendChallenge) -> list[Participant]:
    rows = db.execute(
        select(User.id, User.display_name)
        .join(FriendChallengeParticipant, FriendChallengeParticipant.user_id == User.id)
        .where(FriendChallengeParticipant.challenge_id == challenge.id)
    ).all()
    xp = xp_between(db, [r.id for r in rows], challenge.starts_at, challenge.ends_at)
    ordered = sorted(rows, key=lambda r: (-xp[r.id], r.display_name.casefold(), r.id))
    return [Participant(r.id, r.display_name, xp[r.id]) for r in ordered]


def user_challenges(db: Session, user_id: str) -> list[FriendChallenge]:
    return list(
        db.scalars(
            select(FriendChallenge)
            .join(FriendChallengeParticipant, FriendChallengeParticipant.challenge_id == FriendChallenge.id)
            .where(FriendChallengeParticipant.user_id == user_id)
            .order_by(FriendChallenge.ends_at.desc(), FriendChallenge.id)
        )
    )


# --- Défi express ----------------------------------------------------------------------------


def record_express_score(
    db: Session, user_id: str, game: str, score: int, correct: int, total: int, local_date: date, now: datetime
) -> ExpressScore:
    row = ExpressScore(
        user_id=user_id, game=game, score=score, correct=correct, total=total, local_date=local_date, created_at=now
    )
    db.add(row)
    db.flush()
    return row


def best_today(db: Session, user_id: str, game: str, local_date: date) -> int:
    best = db.scalar(
        select(func.max(ExpressScore.score)).where(
            ExpressScore.user_id == user_id, ExpressScore.game == game, ExpressScore.local_date == local_date
        )
    )
    return int(best or 0)


def rank_today(db: Session, game: str, local_date: date, best: int) -> int:
    """1 + nombre de joueurs dont le meilleur score du jour est strictement supérieur."""
    bests = (
        select(func.max(ExpressScore.score).label("best"))
        .where(ExpressScore.game == game, ExpressScore.local_date == local_date)
        .group_by(ExpressScore.user_id)
        .subquery()
    )
    higher = db.scalar(select(func.count()).select_from(bests).where(bests.c.best > best))
    return 1 + int(higher or 0)
