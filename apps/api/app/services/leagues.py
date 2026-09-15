"""Ligues hebdomadaires (spec §5.3, contrat Phase 3 §2).

- Semaine UTC : lundi 00:00 → lundi suivant (comme le défi de la semaine).
- XP de la semaine = somme des `xpGained` des séances terminées dans la semaine (`sessions.ended_at`)
  + XP des défis réclamés dans la semaine (`challenge_progress.claimed_at` × 50).
- Divisions 1 (entrée) à 5 (sommet). Classement : XP décroissante, puis nom affiché, puis id (déterministe).
- Les utilisateurs qui ont désactivé les ligues (`leaguesEnabled = false`) n'apparaissent dans aucun classement
  et ne reçoivent pas d'issue (ni promotion ni relégation).
- Passage de semaine (`rollover`, tâche du lundi 00:00 UTC ou `python -m app.maintenance leagues-rollover`) :
  1. classement final de la semaine écoulée figé sur `league_members` ; dans chaque groupe, les 5 premiers
     (avec XP > 0) montent, les 5 derniers (hors promus) descendent, bornés à 1..5 ;
  2. nouveaux groupes parmi les utilisateurs `leaguesEnabled` actifs la semaine écoulée (au moins une séance
     terminée) : division = issue de la semaine écoulée, sinon dernière division connue, sinon 1 ;
  3. par division, utilisateurs triés par SHA-256(semaine, id) puis répartis en ⌈n/30⌉ groupes équilibrés
     (i-ème utilisateur → groupe i mod g) : mélange hebdomadaire, reproductible.
  Idempotent : sans effet si des groupes existent déjà pour la semaine.
- Un utilisateur actif arrivé en cours de semaine (ou si le planificateur est désactivé) rejoint à la lecture
  de `/leagues/me` le premier groupe non plein de sa division, sinon un nouveau groupe.
"""

import hashlib
import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ChallengeProgress, LeagueGroup, LeagueMember, Profile, StudySession, User
from app.services.challenges import CLAIM_XP

GROUP_SIZE = 30
PROMOTE_TOP = 5
RELEGATE_BOTTOM = 5
MIN_DIVISION = 1
MAX_DIVISION = 5
_WEEK = timedelta(days=7)


@dataclass(frozen=True)
class Standing:
    rank: int
    user_id: str
    display_name: str
    xp: int


def week_start_date(now: datetime) -> date:
    day = now.astimezone(UTC).date()
    return day - timedelta(days=day.weekday())


def week_bounds(week: date) -> tuple[datetime, datetime]:
    start = datetime.combine(week, time(0), tzinfo=UTC)
    return start, start + _WEEK


def xp_between(db: Session, user_ids: list[str], start: datetime, end: datetime) -> dict[str, int]:
    """XP gagnée sur [start, end) : séances terminées + défis réclamés."""
    totals = dict.fromkeys(user_ids, 0)
    if not user_ids:
        return totals
    sessions = db.execute(
        select(StudySession.user_id, func.coalesce(func.sum(StudySession.xp_gained), 0))
        .where(StudySession.user_id.in_(user_ids), StudySession.ended_at >= start, StudySession.ended_at < end)
        .group_by(StudySession.user_id)
    )
    for user_id, xp in sessions:
        totals[user_id] += int(xp or 0)
    claims = db.execute(
        select(ChallengeProgress.user_id, func.count())
        .where(
            ChallengeProgress.user_id.in_(user_ids),
            ChallengeProgress.claimed_at >= start,
            ChallengeProgress.claimed_at < end,
        )
        .group_by(ChallengeProgress.user_id)
    )
    for user_id, count in claims:
        totals[user_id] += int(count or 0) * CLAIM_XP
    return totals


def _rank(rows: list[tuple[str, str]], xp: dict[str, int]) -> list[Standing]:
    ordered = sorted(rows, key=lambda r: (-xp.get(r[0], 0), r[1].casefold(), r[0]))
    return [Standing(i + 1, user_id, name, xp.get(user_id, 0)) for i, (user_id, name) in enumerate(ordered)]


def group_standings(db: Session, group_id: str, week: date) -> list[Standing]:
    """Classement d'un groupe, sans les membres qui ont désactivé les ligues."""
    rows = db.execute(
        select(LeagueMember.user_id, User.display_name)
        .join(User, User.id == LeagueMember.user_id)
        .join(Profile, Profile.user_id == LeagueMember.user_id)
        .where(LeagueMember.group_id == group_id, Profile.leagues_enabled.is_(True))
    ).all()
    start, end = week_bounds(week)
    xp = xp_between(db, [r.user_id for r in rows], start, end)
    return _rank([(r.user_id, r.display_name) for r in rows], xp)


def outcome_for(rank: int, size: int, xp: int) -> str:
    if rank <= PROMOTE_TOP and xp > 0:
        return "promoted"
    if rank > PROMOTE_TOP and rank > size - RELEGATE_BOTTOM:
        return "relegated"
    return "stayed"


def next_division(division: int, outcome: str | None) -> int:
    step = {"promoted": 1, "relegated": -1}.get(outcome or "", 0)
    return min(MAX_DIVISION, max(MIN_DIVISION, division + step))


def _finalize_week(db: Session, week: date) -> None:
    """Classement final de tous les groupes de la semaine en trois requêtes (membres, XP, défis)."""
    rows = db.execute(
        select(LeagueMember, User.display_name, Profile.leagues_enabled)
        .join(User, User.id == LeagueMember.user_id)
        .outerjoin(Profile, Profile.user_id == LeagueMember.user_id)
        .where(LeagueMember.week_start == week)
    ).all()
    if not rows:
        return
    start, end = week_bounds(week)
    xp = xp_between(db, [m.user_id for m, _, enabled in rows if enabled], start, end)
    groups: dict[str, list[tuple[LeagueMember, str]]] = {}
    for member, name, enabled in rows:
        if enabled:
            groups.setdefault(member.group_id, []).append((member, name))
    for members in groups.values():
        by_user = {m.user_id: m for m, _ in members}
        standings = _rank([(m.user_id, name) for m, name in members], xp)
        for st in standings:
            member = by_user[st.user_id]
            member.final_xp = st.xp
            member.final_rank = st.rank
            member.outcome = outcome_for(st.rank, len(standings), st.xp)


def _sort_key(week: date, user_id: str) -> str:
    return hashlib.sha256(f"{week.isoformat()}:{user_id}".encode()).hexdigest()


def last_division(db: Session, user_id: str, before: date) -> int | None:
    member = db.scalar(
        select(LeagueMember)
        .where(LeagueMember.user_id == user_id, LeagueMember.week_start < before)
        .order_by(LeagueMember.week_start.desc())
        .limit(1)
    )
    if member is None:
        return None
    return next_division(member.division, member.outcome)


def _active_enabled_users(db: Session, start: datetime, end: datetime) -> list[str]:
    return list(
        db.scalars(
            select(StudySession.user_id)
            .join(Profile, Profile.user_id == StudySession.user_id)
            .where(Profile.leagues_enabled.is_(True), StudySession.ended_at >= start, StudySession.ended_at < end)
            .distinct()
        )
    )


def last_divisions(db: Session, user_ids: list[str], before: date) -> dict[str, int]:
    """`last_division` pour plusieurs utilisateurs en une requête (par paquets)."""
    latest: dict[str, LeagueMember] = {}
    for i in range(0, len(user_ids), 500):
        chunk = user_ids[i : i + 500]
        for member in db.scalars(
            select(LeagueMember).where(LeagueMember.user_id.in_(chunk), LeagueMember.week_start < before)
        ):
            current = latest.get(member.user_id)
            if current is None or member.week_start > current.week_start:
                latest[member.user_id] = member
    return {uid: next_division(m.division, m.outcome) for uid, m in latest.items()}


def rollover(db: Session, now: datetime) -> int:
    """Forme les groupes de la semaine de `now` (idempotent). Retourne le nombre de membres placés."""
    week = week_start_date(now)
    if db.scalar(select(func.count()).select_from(LeagueGroup).where(LeagueGroup.week_start == week)):
        return 0
    previous = week - _WEEK
    _finalize_week(db, previous)
    db.flush()

    prev_start, prev_end = week_bounds(previous)
    by_division: dict[int, list[str]] = {}
    active = _active_enabled_users(db, prev_start, prev_end)
    divisions = last_divisions(db, active, week)
    for user_id in active:
        by_division.setdefault(divisions.get(user_id, MIN_DIVISION), []).append(user_id)

    placed = 0
    for division in sorted(by_division):
        users = sorted(by_division[division], key=lambda uid: _sort_key(week, uid))
        count = math.ceil(len(users) / GROUP_SIZE)
        groups = [LeagueGroup(week_start=week, division=division, group_index=i) for i in range(count)]
        db.add_all(groups)
        db.flush()
        for i, user_id in enumerate(users):
            db.add(LeagueMember(week_start=week, user_id=user_id, group_id=groups[i % count].id, division=division))
            placed += 1
    db.flush()
    return placed


def _has_activity(db: Session, user_id: str, since: datetime) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(StudySession)
            .where(StudySession.user_id == user_id, StudySession.ended_at >= since)
        )
        or 0
    ) > 0


def ensure_membership(db: Session, user_id: str, now: datetime) -> LeagueMember | None:
    """Membre de la semaine courante ; place un utilisateur actif (séance depuis la semaine dernière) au besoin."""
    week = week_start_date(now)
    member = db.get(LeagueMember, (week, user_id))
    if member is not None:
        return member
    try:
        with db.begin_nested():
            rollover(db, now)  # planificateur désactivé ou pas encore passé
    except IntegrityError:  # passage de semaine concurrent : ses groupes font foi
        pass
    member = db.get(LeagueMember, (week, user_id))
    if member is not None:
        return member
    if not _has_activity(db, user_id, week_bounds(week - _WEEK)[0]):
        return None

    division = last_division(db, user_id, week) or MIN_DIVISION
    groups = list(
        db.scalars(
            select(LeagueGroup)
            .where(LeagueGroup.week_start == week, LeagueGroup.division == division)
            .order_by(LeagueGroup.group_index)
        )
    )
    target = None
    for group in groups:
        size = db.scalar(select(func.count()).select_from(LeagueMember).where(LeagueMember.group_id == group.id))
        if (size or 0) < GROUP_SIZE:
            target = group
            break
    try:
        with db.begin_nested():
            if target is None:
                target = LeagueGroup(week_start=week, division=division, group_index=len(groups))
                db.add(target)
                db.flush()
            member = LeagueMember(week_start=week, user_id=user_id, group_id=target.id, division=division)
            db.add(member)
    except IntegrityError:  # placement concurrent
        return db.get(LeagueMember, (week, user_id))
    return member
