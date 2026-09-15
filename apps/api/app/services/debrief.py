"""Débriefing hebdomadaire de Cô Mai (spec §5.7, contrat Phase 3 §1) : ce qui progresse, ce qui coince, l'objectif.

- Données des 7 derniers jours : leçons terminées, séances (minutes, XP), série, points faibles (réponses ratées),
  prochaine leçon et objectif quotidien.
- Cache par (utilisateur, semaine UTC, langue) jusqu'au lundi suivant ; un repli n'est pas mis en cache.
- Modèle : un objet JSON {progress, struggles, goal}, garde du Sud et contrôles de forme (une régénération),
  sinon repli construit à partir des mêmes données, sans modèle.
"""

import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import LessonProgress, Profile, StudySession, User
from app.services import learner
from app.services.content import Pack, concept_documents, lesson_document, localized
from app.services.leagues import week_bounds, week_start_date
from app.services.tutor import (
    _FORBIDDEN_PHRASINGS,
    _LANGUAGE_NAME,
    _cache_get,
    _cache_key,
    _cache_put,
    _generate,
    lint_south,
    model_calls_today,
    weakest_concepts,
)
from app.services.tutor_llm import TutorLLM

logger = logging.getLogger(__name__)

DEBRIEF_MAX_TOKENS = 500
DEBRIEF_MAX_CHARS = 900
FIELD_MAX_CHARS = 240
_FIELDS = ("progress", "struggles", "goal")


@dataclass(frozen=True)
class WeekData:
    lessons: list[str]
    sessions: int
    minutes: int
    xp: int
    streak: int
    weak: list[str]
    next_lesson: str | None
    daily_goal_min: int


@dataclass(frozen=True)
class Debrief:
    week_start: date
    progress: str
    struggles: str
    goal: str
    source: str
    cached: bool


def collect(db: Session, user: User, pack: Pack | None, locale: str, now: datetime) -> WeekData:
    since = now - timedelta(days=7)
    lessons = []
    rows = db.scalars(
        select(LessonProgress.lesson_id)
        .where(
            LessonProgress.user_id == user.id,
            LessonProgress.status == "completed",
            LessonProgress.completed_at >= since,
        )
        .order_by(LessonProgress.completed_at)
    )
    for lesson_id in rows:
        doc = lesson_document(pack, lesson_id) if pack else None
        lessons.append((localized(doc.get("title"), locale) if doc else None) or lesson_id)
    sessions = db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(StudySession.duration_ms), 0),
            func.coalesce(func.sum(StudySession.xp_gained), 0),
        ).where(StudySession.user_id == user.id, StudySession.ended_at >= since)
    ).one()
    weak = []
    concepts = concept_documents(pack) if pack else {}
    for cid in weakest_concepts(db, user.id, now):
        concept = concepts.get(cid)
        if concept and concept.get("vi"):
            gloss = localized(concept.get("gloss"), locale)
            weak.append(concept["vi"] + (f" ({gloss})" if gloss else ""))
    enrollment = learner.primary_enrollment(db, user.id)
    next_doc = (
        lesson_document(pack, enrollment.current_lesson_id)
        if pack and enrollment and enrollment.current_lesson_id
        else None
    )
    profile = db.get(Profile, user.id)
    return WeekData(
        lessons=lessons,
        sessions=int(sessions[0] or 0),
        minutes=round(int(sessions[1] or 0) / 60_000),
        xp=int(sessions[2] or 0),
        streak=learner.displayed_streak(db, user.id, learner.current_local_date(db, user.id, now)),
        weak=weak,
        next_lesson=(localized(next_doc.get("title"), locale) if next_doc else None),
        daily_goal_min=profile.daily_goal_min if profile else 10,
    )


def fallback(data: WeekData, locale: str) -> dict[str, str]:
    en = locale == "en"
    shown = ", ".join(data.lessons[:3])
    if data.lessons:
        progress = (
            f"{len(data.lessons)} lesson(s) completed this week ({shown}), {data.minutes} min of practice."
            if en
            else f"{len(data.lessons)} leçon(s) terminée(s) cette semaine ({shown}), {data.minutes} min de pratique."
        )
    elif data.sessions:
        progress = (
            f"{data.sessions} session(s) and {data.minutes} min of practice: regularity pays off."
            if en
            else f"{data.sessions} séance(s) et {data.minutes} min de pratique : la régularité paie."
        )
    else:
        progress = (
            "A new week begins: one short session is enough to get going."
            if en
            else "Une nouvelle semaine commence : une courte séance suffit pour lancer l'élan."
        )
    if data.weak:
        struggles = ("To review: " if en else "À revoir : ") + "; ".join(data.weak) + "."
    else:
        struggles = (
            "Nothing is really getting in your way: keep it up."
            if en
            else "Rien ne coince vraiment : continue comme ça."
        )
    if data.next_lesson:
        goal = (
            f"This week: “{data.next_lesson}”, and {data.daily_goal_min} min a day."
            if en
            else f"Cette semaine : « {data.next_lesson} », et {data.daily_goal_min} min par jour."
        )
    else:
        goal = (
            f"This week: {data.daily_goal_min} min a day and your reviews."
            if en
            else f"Cette semaine : {data.daily_goal_min} min par jour et tes révisions."
        )
    return {"progress": progress, "struggles": struggles, "goal": goal}


def _prompt(user: User, data: WeekData, locale: str) -> str:
    language = _LANGUAGE_NAME[locale]
    return "\n".join(
        [
            "Task: write the learner's weekly debrief.",
            f"Interface language: {language}.",
            'Output only one JSON object {"progress": "...", "struggles": "...", "goal": "..."}: each value is '
            f"one or two short sentences in {language} (at most 200 characters): what improved, what is still "
            "hard, and one concrete goal for the coming week. Use only the learner data below.",
            "",
            "Learner data:",
            f"- Display name: {json.dumps(user.display_name, ensure_ascii=False)}",
            f"- Lessons completed in the last 7 days: {json.dumps(data.lessons, ensure_ascii=False)}",
            f"- Sessions: {data.sessions}, minutes: {data.minutes}, XP: {data.xp}, "
            f"current streak: {data.streak} day(s)",
            "- Weak points (Southern Vietnamese forms): " + ("; ".join(data.weak) if data.weak else "none"),
            f"- Next lesson: {json.dumps(data.next_lesson, ensure_ascii=False)}",
            f"- Daily goal: {data.daily_goal_min} minutes",
        ]
    )


def _parse(text: str, pack: Pack) -> dict[str, str] | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    out = {}
    for key in _FIELDS:
        value = data.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > FIELD_MAX_CHARS:
            return None
        if lint_south(pack, value) or _FORBIDDEN_PHRASINGS.search(value):
            return None
        out[key] = value.strip()
    return out


def weekly_debrief(
    db: Session,
    llm: TutorLLM | None,
    settings: Settings,
    packs: dict[str, Pack],
    user: User,
    locale: str,
    now: datetime | None = None,
) -> Debrief:
    now = now or datetime.now(UTC)
    week = week_start_date(now)
    key = _cache_key("debrief", user.id, week.isoformat(), locale)
    cached = _cache_get(db, key, now)
    if cached is not None:
        try:
            values = json.loads(cached)
            return Debrief(week, values["progress"], values["struggles"], values["goal"], "model", True)
        except (ValueError, KeyError, TypeError):
            logger.warning("Débriefing en cache illisible, régénéré")

    enrollment = learner.primary_enrollment(db, user.id)
    pack = packs.get(enrollment.course_id if enrollment else settings.default_course)
    data = collect(db, user, pack, locale, now)
    values = None
    if (
        llm is not None
        and pack is not None
        and pack.tutor is not None
        and model_calls_today(db, user.id, now) < settings.tutor_daily_quota
    ):
        text = _generate(
            db, llm, pack, user.id, _prompt(user, data, locale), DEBRIEF_MAX_TOKENS, DEBRIEF_MAX_CHARS, now
        )
        values = _parse(text, pack) if text else None
    if values is None:
        db.commit()
        values = fallback(data, locale)
        return Debrief(week, values["progress"], values["struggles"], values["goal"], "fallback", False)
    _, week_end = week_bounds(week)
    _cache_put(db, key, "debrief", locale, json.dumps(values, ensure_ascii=False), now, user.id, week_end - now)
    db.commit()
    return Debrief(week, values["progress"], values["struggles"], values["goal"], "model", False)
