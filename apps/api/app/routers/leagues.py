"""`/leagues/me` : ligue hebdomadaire (contrat Phase 3 §2). JWT obligatoire."""

from datetime import UTC, datetime

from fastapi import APIRouter

from app.deps import CurrentUser, DbDep, PacksDep
from app.models import LeagueGroup, Profile
from app.schemas.phase3 import LeagueOut, Localized, StandingOut
from app.services import leagues, learner
from app.services.content import league_division_names

router = APIRouter(prefix="/leagues", tags=["leagues"])


def division_name(names: list[dict[str, str]] | None, division: int) -> Localized:
    """Nom venu du pack (`leagueDivisions`), sinon libellé neutre (le thème appartient au contenu)."""
    if names is not None:
        return Localized(**names[division - 1])
    return Localized(fr=f"Division {division}", en=f"Division {division}")


@router.get("/me", response_model=LeagueOut, response_model_exclude_none=True)
def my_league(user: CurrentUser, db: DbDep, packs: PacksDep) -> LeagueOut:
    profile = db.get(Profile, user.id)
    if profile is None or not profile.leagues_enabled:
        return LeagueOut(enabled=False)
    now = datetime.now(UTC)
    member = leagues.ensure_membership(db, user.id, now)
    week = leagues.week_start_date(now)
    start, end = leagues.week_bounds(week)
    enrollment = learner.primary_enrollment(db, user.id)
    names = league_division_names(packs.get(enrollment.course_id) if enrollment else None)
    if member is None:
        # Pas d'activité récente : dernière division connue (sinon entrée), classement vide jusqu'à la prochaine séance.
        db.commit()
        division = leagues.last_division(db, user.id, week) or leagues.MIN_DIVISION
        standings: list[StandingOut] = []
    else:
        group = db.get(LeagueGroup, member.group_id)
        assert group is not None  # noqa: S101  (clé étrangère)
        division = member.division
        standings = [
            StandingOut(rank=s.rank, display_name=s.display_name, xp=s.xp, is_me=s.user_id == user.id)
            for s in leagues.group_standings(db, group.id, week)
        ]
        db.commit()
    return LeagueOut(
        enabled=True,
        division=division,
        division_name=division_name(names, division),
        week_start=start,
        week_end=end,
        standings=standings,
        promote_top=leagues.PROMOTE_TOP,
        relegate_bottom=leagues.RELEGATE_BOTTOM,
    )
