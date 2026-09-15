"""Défis entre amis, défi express et partage public (contrat Phase 3 §3)."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status

from app.deps import CurrentUser, DbDep, SettingsDep
from app.models import ExpressScore, FriendChallenge, Profile, User
from app.schemas.phase3 import (
    ExpressScoreIn,
    ExpressScoreOut,
    ExpressShareOut,
    FriendChallengeCreate,
    FriendChallengeCreated,
    FriendChallengeJoined,
    FriendChallengeOut,
    ParticipantOut,
)
from app.services import friends

router = APIRouter(tags=["social"])

_ERROR_STATUS = {
    "challenge_not_found": status.HTTP_404_NOT_FOUND,
    "challenge_ended": status.HTTP_409_CONFLICT,
    "challenge_full": status.HTTP_409_CONFLICT,
    "too_many_challenges": status.HTTP_409_CONFLICT,
}


def _participants(db: DbDep, challenge: FriendChallenge, user_id: str) -> list[ParticipantOut]:
    return [
        ParticipantOut(display_name=p.display_name, xp=p.xp, is_me=p.user_id == user_id)
        for p in friends.participants(db, challenge)
    ]


@router.post("/challenges/friends", response_model=FriendChallengeCreated, status_code=status.HTTP_201_CREATED)
def create_friend_challenge(
    body: FriendChallengeCreate, user: CurrentUser, db: DbDep, settings: SettingsDep
) -> FriendChallengeCreated:
    try:
        challenge = friends.create_challenge(db, user.id, body.kind, datetime.now(UTC))
    except friends.FriendChallengeError as exc:
        db.rollback()
        code = _ERROR_STATUS.get(str(exc), status.HTTP_503_SERVICE_UNAVAILABLE)
        raise HTTPException(code, detail=str(exc)) from exc
    db.commit()
    return FriendChallengeCreated(
        id=challenge.id,
        invite_code=challenge.invite_code,
        invite_url=f"{settings.public_web_url.rstrip('/')}/defi/{challenge.invite_code}",
        ends_at=challenge.ends_at,
    )


@router.post("/challenges/friends/join/{code}", response_model=FriendChallengeJoined)
def join_friend_challenge(code: str, user: CurrentUser, db: DbDep) -> FriendChallengeJoined:
    try:
        challenge = friends.join_challenge(db, user.id, code, datetime.now(UTC))
    except friends.FriendChallengeError as exc:
        db.rollback()
        raise HTTPException(_ERROR_STATUS.get(str(exc), status.HTTP_409_CONFLICT), detail=str(exc)) from exc
    db.commit()
    return FriendChallengeJoined(
        id=challenge.id, participants=_participants(db, challenge, user.id), ends_at=challenge.ends_at
    )


@router.get("/challenges/friends", response_model=list[FriendChallengeOut])
def list_friend_challenges(user: CurrentUser, db: DbDep) -> list[FriendChallengeOut]:
    return [
        FriendChallengeOut(
            id=c.id,
            invite_code=c.invite_code,
            ends_at=c.ends_at,
            participants=_participants(db, c, user.id),
        )
        for c in friends.user_challenges(db, user.id)
    ]


@router.post("/challenges/express/scores", response_model=ExpressScoreOut)
def post_express_score(body: ExpressScoreIn, user: CurrentUser, db: DbDep) -> ExpressScoreOut:
    row = friends.record_express_score(
        db, user.id, body.game, body.score, body.correct, body.total, body.local_date, datetime.now(UTC)
    )
    best = friends.best_today(db, user.id, body.game, body.local_date)
    profile = db.get(Profile, user.id)
    # Classement du jour masqué pour qui a désactivé la compétition (ligue désactivée, spec §5.3).
    competitive = profile is None or profile.leagues_enabled
    rank = friends.rank_today(db, body.game, body.local_date, best) if competitive else None
    db.commit()
    return ExpressScoreOut(id=row.id, best=best, rank_today=rank)


@router.get("/share/express/{score_id}", response_model=ExpressShareOut)
def share_express(score_id: str, db: DbDep) -> ExpressShareOut:
    """Public : page de partage d'un score de défi express (nom affiché seulement)."""
    row = db.get(ExpressScore, score_id)
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="score_not_found")
    return ExpressShareOut(display_name=user.display_name, game=row.game, score=row.score, created_at=row.created_at)
