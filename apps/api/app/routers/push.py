"""`/push/*` : abonnements Web Push (contrat Phase 2 §4). Clé publique VAPID publique, le reste sous JWT."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.deps import CurrentUser, DbDep, SettingsDep
from app.models import Profile, PushSubscription
from app.schemas.phase2 import PushSubscribeIn, PushUnsubscribeIn, VapidKeyOut
from app.services import push

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key", response_model=VapidKeyOut)
def vapid_public_key(settings: SettingsDep) -> VapidKeyOut:
    if not settings.vapid_public_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="push_disabled")
    return VapidKeyOut(key=settings.vapid_public_key)


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(body: PushSubscribeIn, user: CurrentUser, db: DbDep) -> Response:
    if not push.valid_timezone(body.timezone):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Fuseau inconnu : {body.timezone}")
    push.upsert_subscription(
        db, user, body.endpoint, body.keys.model_dump(), reminder_hour=body.reminder_hour, timezone=body.timezone
    )
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id, daily_goal_min=10, leagues_enabled=True)
        db.add(profile)
    profile.reminder_hour = body.reminder_hour
    profile.timezone = body.timezone
    profile.notifications_enabled = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(body: PushUnsubscribeIn, user: CurrentUser, db: DbDep) -> Response:
    row = db.scalar(
        select(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id)
    )
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
