"""Espace enseignant (spec §15 Phase 4, contrat Phase 4 §2).

- Code de classe : 6 caractères Crockford base32 (saisie tolérante : minuscules, I/L → 1, O → 0, tirets).
- 60 élèves au plus ; l'élève rejoint avec un consentement explicite (RGPD §14) et peut quitter à tout moment.
- L'enseignant ne voit que le nom affiché et des agrégats de progression (jamais l'email, aucun audio).
"""

import secrets
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Answer,
    Assignment,
    ClassMember,
    Enrollment,
    Exam,
    ExamAttempt,
    LessonProgress,
    SchoolClass,
    StreakRow,
    StudySession,
    User,
)
from app.services.content import Pack, concept_documents
from app.services.friends import CROCKFORD_ALPHABET
from app.services.leagues import week_bounds, week_start_date, xp_between

CODE_LENGTH = 6
MAX_STUDENTS = 60
WEAK_WINDOW = timedelta(days=30)
WEAK_MIN_ANSWERS = 3
WEAK_LIMIT = 5

_DECODE_ALIASES = str.maketrans({"I": "1", "L": "1", "O": "0"})


class ClassError(Exception):
    """Refus métier : class_not_found, class_full, own_class, consent_required, code_generation_failed."""


def generate_code() -> str:
    return "".join(secrets.choice(CROCKFORD_ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(raw: str) -> str | None:
    code = raw.strip().replace("-", "").upper().translate(_DECODE_ALIASES)
    if len(code) != CODE_LENGTH or any(c not in CROCKFORD_ALPHABET for c in code):
        return None
    return code


def _with_unique_code(db: Session, apply: Callable[[str], None]) -> None:
    for _ in range(8):
        try:
            with db.begin_nested():
                apply(generate_code())
                db.flush()
        except IntegrityError:  # collision (32^6 ≈ 10^9 : improbable)
            continue
        return
    raise ClassError("code_generation_failed")


def create_class(db: Session, teacher: User, name: str, pack_code: str, now: datetime) -> SchoolClass:
    klass = SchoolClass(teacher_id=teacher.id, name=name.strip(), pack_code=pack_code, created_at=now)

    def apply(code: str) -> None:
        klass.join_code = code
        db.add(klass)

    _with_unique_code(db, apply)
    return klass


def regenerate_code(db: Session, klass: SchoolClass) -> str:
    def apply(code: str) -> None:
        klass.join_code = code

    _with_unique_code(db, apply)
    return klass.join_code


def student_count(db: Session, class_id: str) -> int:
    return int(db.scalar(select(func.count()).select_from(ClassMember).where(ClassMember.class_id == class_id)) or 0)


def join_class(db: Session, user: User, raw_code: str, consent: bool, now: datetime) -> SchoolClass:
    if not consent:
        raise ClassError("consent_required")
    code = normalize_code(raw_code)
    klass = db.scalar(select(SchoolClass).where(SchoolClass.join_code == code)) if code else None
    if klass is None:
        raise ClassError("class_not_found")
    if klass.teacher_id == user.id:
        raise ClassError("own_class")
    if db.get(ClassMember, (klass.id, user.id)) is not None:
        return klass  # idempotent
    if student_count(db, klass.id) >= MAX_STUDENTS:
        raise ClassError("class_full")
    db.add(ClassMember(class_id=klass.id, user_id=user.id, joined_at=now, consent_at=now))
    db.flush()
    return klass


# --- Progression des élèves ------------------------------------------------------------------


@dataclass(frozen=True)
class StudentProgress:
    id: str
    display_name: str
    joined_at: datetime
    last_active_date: date | None
    streak: int
    xp_week: int
    lessons_completed: int
    current_lesson_id: str | None
    weak_concepts: list[dict[str, object]]
    exams: list[dict[str, object]]


def _completed_by_user(db: Session, user_ids: list[str], pack_code: str) -> dict[str, set[str]]:
    done: dict[str, set[str]] = defaultdict(set)
    if not user_ids:
        return done
    rows = db.execute(
        select(LessonProgress.user_id, LessonProgress.lesson_id).where(
            LessonProgress.user_id.in_(user_ids),
            LessonProgress.status == "completed",
            LessonProgress.lesson_id.like(f"{pack_code}.%"),
        )
    )
    for user_id, lesson_id in rows:
        done[user_id].add(lesson_id)
    return done


def _last_active(db: Session, user_id: str) -> date | None:
    row = db.execute(
        select(func.max(StudySession.local_date), func.max(StudySession.ended_at)).where(
            StudySession.user_id == user_id
        )
    ).one()
    local, ended = row
    if local is not None:
        return local  # type: ignore[no-any-return]
    if ended is not None:
        return (ended if isinstance(ended, datetime) else datetime.fromisoformat(str(ended))).date()
    return None


def weak_concepts(db: Session, user_id: str, pack: Pack | None, now: datetime) -> list[dict[str, object]]:
    """Concepts au plus fort taux d'erreur sur 30 jours (≥ 3 réponses, taux > 0), 5 au plus."""
    totals: dict[str, int] = defaultdict(int)
    wrong: dict[str, int] = defaultdict(int)
    rows = db.execute(
        select(Answer.concept_id, Answer.concept_ids, Answer.correct).where(
            Answer.user_id == user_id, Answer.created_at >= now - WEAK_WINDOW
        )
    )
    for concept_id, concept_ids, correct in rows:
        ids = [c for c in (concept_ids or []) if isinstance(c, str)] or ([concept_id] if concept_id else [])
        for cid in dict.fromkeys(ids):
            totals[cid] += 1
            if not correct:
                wrong[cid] += 1
    docs = concept_documents(pack) if pack is not None else {}
    candidates = [
        (wrong[cid] / n, n, cid)
        for cid, n in totals.items()
        if n >= WEAK_MIN_ANSWERS and wrong[cid] > 0 and cid in docs
    ]
    candidates.sort(key=lambda t: (-t[0], -t[1], t[2]))
    return [
        {"id": cid, "vi": str(docs[cid].get("vi", "")), "error_rate": round(rate, 3)}
        for rate, _, cid in candidates[:WEAK_LIMIT]
    ]


def exam_results(db: Session, user_id: str, pack_code: str) -> list[dict[str, object]]:
    """Dernière tentative soumise par niveau."""
    rows = db.execute(
        select(Exam.level, ExamAttempt.passed, ExamAttempt.score_json, ExamAttempt.submitted_at)
        .join(Exam, Exam.id == ExamAttempt.exam_id)
        .where(ExamAttempt.user_id == user_id, Exam.course_id == pack_code, ExamAttempt.submitted_at.is_not(None))
        .order_by(ExamAttempt.submitted_at)
    )
    latest: dict[str, dict[str, object]] = {}
    for level, passed, score, _ in rows:
        latest[level] = {"level": level, "passed": bool(passed), "global": float((score or {}).get("global", 0.0))}
    return [latest[k] for k in sorted(latest)]


def students_progress(db: Session, klass: SchoolClass, pack: Pack | None, now: datetime) -> list[StudentProgress]:
    members = db.execute(
        select(User.id, User.display_name, ClassMember.joined_at)
        .join(ClassMember, ClassMember.user_id == User.id)
        .where(ClassMember.class_id == klass.id)
    ).all()
    user_ids = [m.id for m in members]
    completed = _completed_by_user(db, user_ids, klass.pack_code)
    start, end = week_bounds(week_start_date(now))
    xp = xp_between(db, user_ids, start, end)
    out = []
    for m in sorted(members, key=lambda r: (r.display_name.casefold(), r.id)):
        streak = db.get(StreakRow, m.id)
        enrollment = db.get(Enrollment, (m.id, klass.pack_code))
        out.append(
            StudentProgress(
                id=m.id,
                display_name=m.display_name,
                joined_at=m.joined_at,
                last_active_date=_last_active(db, m.id),
                streak=streak.current if streak else 0,
                xp_week=xp.get(m.id, 0),
                lessons_completed=len(completed.get(m.id, set())),
                current_lesson_id=enrollment.current_lesson_id if enrollment else None,
                weak_concepts=weak_concepts(db, m.id, pack, now),
                exams=exam_results(db, m.id, klass.pack_code),
            )
        )
    return out


def assignments_of(db: Session, class_id: str) -> list[Assignment]:
    return list(
        db.scalars(
            select(Assignment)
            .where(Assignment.class_id == class_id)
            .order_by(Assignment.due_date.is_(None), Assignment.due_date, Assignment.created_at)
        )
    )


def assignment_completion(db: Session, klass: SchoolClass, assignments: list[Assignment]) -> dict[str, int]:
    """Nombre d'élèves ayant terminé toutes les leçons de chaque devoir."""
    user_ids = list(db.scalars(select(ClassMember.user_id).where(ClassMember.class_id == klass.id)))
    completed = _completed_by_user(db, user_ids, klass.pack_code)
    return {a.id: sum(1 for uid in user_ids if set(a.lesson_ids) <= completed.get(uid, set())) for a in assignments}


def completed_lessons_of(db: Session, user_id: str, pack_code: str) -> set[str]:
    return _completed_by_user(db, [user_id], pack_code).get(user_id, set())
