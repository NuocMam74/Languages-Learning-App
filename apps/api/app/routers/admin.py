"""`/admin/*` : attribution des rôles (contrat Phase 4 §0). Rôle `admin` requis."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import GRANTABLE_ROLES, DbDep, require_roles, user_roles
from app.models import User
from app.schemas.phase4 import RolesIn, UserRolesOut

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_roles("admin"))])


@router.put("/users/{user_id}/roles", response_model=UserRolesOut)
def put_user_roles(user_id: str, body: RolesIn, db: DbDep) -> UserRolesOut:
    """Remplace les rôles attribués (`learner` est implicite et ignoré)."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user_not_found")
    user.roles = [r for r in GRANTABLE_ROLES if r in set(body.roles)]
    db.commit()
    return UserRolesOut(id=user.id, display_name=user.display_name, roles=user_roles(user))
