"""`/challenges/*` : défi de la semaine (contrat Phase 2 §3). JWT obligatoire."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status

from app.deps import CurrentUser, DbDep, PacksDep
from app.models import Challenge, ChallengeProgress
from app.schemas.phase2 import ChallengeOut, ClaimOut
from app.services import challenges

router = APIRouter(prefix="/challenges", tags=["challenges"])


def _out(challenge: Challenge, progress: ChallengeProgress) -> ChallengeOut:
    spec = challenge.spec_json
    return ChallengeOut(
        id=challenge.id,
        kind=challenge.kind,  # type: ignore[arg-type]
        title=spec.get("title", {}),
        target=int(spec.get("target", 0)),
        unit=progress.unit_id if challenge.kind == "words_theme" else None,
        progress=progress.progress,
        completed_at=progress.completed_at,
        claimed_at=progress.claimed_at,
        period_start=challenge.period_start,
        period_end=challenge.period_end,
        badge_code=spec.get("badgeCode", f"challenge_{challenge.kind}"),
    )


@router.get("/current", response_model=list[ChallengeOut])
def current(user: CurrentUser, db: DbDep, packs: PacksDep) -> list[ChallengeOut]:
    now = datetime.now(UTC)
    challenge = challenges.ensure_week_challenge(db, now)
    progress = challenges.refresh_progress(db, user.id, challenge, packs, now)
    db.commit()
    return [_out(challenge, progress)]


@router.post("/{challenge_id}/claim", response_model=ClaimOut)
def claim(challenge_id: str, user: CurrentUser, db: DbDep, packs: PacksDep) -> ClaimOut:
    challenge = db.get(Challenge, challenge_id)
    if challenge is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="challenge_not_found")
    now = datetime.now(UTC)
    try:
        row = challenges.claim(db, user.id, challenge, packs, now)
    except challenges.ClaimError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    db.commit()
    return ClaimOut(claimed_at=row.claimed_at or now, xp=challenges.CLAIM_XP)
