"""Examens certifiants (spec §5.5, contrat Phase 2 §2).

- Fichiers `CONTENT_DIR/<pack>/exams/*.json` (schéma `content/schema/exam.schema.json`), lus à la demande ;
  un dossier absent ou un fichier invalide n'empêche pas les autres examens d'être servis.
- Ouvert quand le test d'unité (`kind: unit_test`) de chaque unité requise est **réussi** (meilleur score ≥ 0,7)
  ou que l'unité a été sautée grâce au placement (contrat parcours §2).
- Médias (contrat parcours §1) : un item oral sans référence F0 et un item d'écoute tonal sans audio natif ne sont
  pas notés (retirés du dénominateur) ; une compétence sans item noté a un score null et est exclue de la règle
  « chaque compétence ≥ 0,5 ». Moins de 15 items notés : examen indisponible (`media_missing`).
- Une tentative soumise verrouille l'examen `retryAfterHours` ; une tentative expire après
  `durationMinutes` + 2 min de grâce.
- Le serveur note : il reconstruit chaque exercice avec la graine de la tentative (identique au client)
  et rejoue `evaluate` — portage de `buildExam`/`gradeExam` (packages/core/src/exams.ts) : leçon synthétique
  d'id `examId` dont l'étape k est le k-ième item tous items confondus (ordre des sections), donc graine
  d'un item `${attemptId}:${examId}:${flatIndex}`.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ExamAttempt
from app.services import progression
from app.services.content import Pack, concept_documents
from app.services.engine import (
    SPEAK_PASS_SCORE,
    ContentError,
    Exercise,
    build_exercise,
    content_index,
    evaluate,
    lesson_concepts_for_units,
)
from app.services.media import exam_item_graded

logger = logging.getLogger(__name__)

SKILLS = ("listening", "reading", "vocabulary", "speaking")
SPEECH_TYPES = frozenset({"speak_repeat", "tone_produce"})
GRACE = timedelta(minutes=2)
MIN_SKILL_SCORE = 0.5
# En dessous, l'examen est « indisponible pour le moment » (médias manquants).
MIN_GRADED_ITEMS = 15
MEDIA_MISSING = "media_missing"
# Tolérance de comparaison flottante (EPSILON de exams.ts).
EPSILON = 1e-9


@dataclass(frozen=True)
class ExamSpec:
    id: str
    level: str
    certificate: dict[str, str]
    requires_units: list[str]
    duration_minutes: int
    pass_threshold: float
    retry_after_hours: int
    sections: list[dict[str, Any]]
    raw: dict[str, Any]

    def items(self) -> list[tuple[str, int]]:
        return [(s["skill"], i) for s in self.sections for i in range(len(s["items"]))]

    def steps(self, skill: str) -> list[dict[str, Any]]:
        section = next((s for s in self.sections if s["skill"] == skill), None)
        return [item["step"] for item in section["items"]] if section else []


def parse_exam(raw: dict[str, Any]) -> ExamSpec:
    """Lecture tolérante mais stricte sur ce que la notation utilise ; ValueError si inexploitable."""
    try:
        sections = raw["sections"]
        for section in sections:
            if section["skill"] not in SKILLS:
                raise ValueError(f"compétence inconnue : {section['skill']}")
            for item in section["items"]:
                if not isinstance(item.get("step"), dict) or "type" not in item["step"]:
                    raise ValueError("item sans step")
        return ExamSpec(
            id=str(raw["id"]),
            level=str(raw["level"]),
            certificate=dict(raw["certificate"]),
            requires_units=list(raw["requiresUnits"]),
            duration_minutes=int(raw["durationMinutes"]),
            pass_threshold=float(raw["passThreshold"]),
            retry_after_hours=int(raw.get("retryAfterHours", 48)),
            sections=list(sections),
            raw=raw,
        )
    except (KeyError, TypeError) as exc:
        raise ValueError(f"examen invalide : {exc!r}") from exc


def load_exams(pack: Pack) -> dict[str, ExamSpec]:
    """Examens du pack, triés par niveau. Fichiers invalides ignorés (journalisés)."""
    directory = pack.directory / "exams"
    exams: dict[str, ExamSpec] = {}
    if not directory.is_dir():
        return exams
    for path in sorted(directory.glob("*.json")):
        try:
            exam = parse_exam(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            logger.warning("Examen ignoré %s : %s", path, exc)
            continue
        exams[exam.id] = exam
    return dict(sorted(exams.items(), key=lambda kv: kv[1].level))


# --- Ouverture et verrou --------------------------------------------------------------------


def unit_test_lessons(pack: Pack, unit_id: str) -> list[str]:
    """Tests d'unité (`kind: unit_test`) ; à défaut toutes les leçons de l'unité ; unité vide → liste vide."""
    unit = next((u for u in pack.units if u.id == unit_id), None)
    if unit is None:
        return []
    tests = progression.unit_test_lessons(pack, unit)
    return tests or [lid for lid in unit.lessons if lid in pack.lessons]


def is_unlocked(db: Session, user_id: str, pack: Pack, exam: ExamSpec) -> bool:
    """Tests d'unité réussis (≥ 0,7) ou unités sautées grâce au placement, pour chaque unité requise."""
    from app.services.learner import progress_state  # import local : learner dépend du planificateur

    if not exam.requires_units:
        return False
    return progression.done_units(pack, progress_state(db, user_id, pack), exam.requires_units)


def last_submitted(db: Session, user_id: str, exam_id: str) -> ExamAttempt | None:
    return db.scalar(
        select(ExamAttempt)
        .where(ExamAttempt.user_id == user_id, ExamAttempt.exam_id == exam_id, ExamAttempt.submitted_at.is_not(None))
        .order_by(ExamAttempt.submitted_at.desc())
        .limit(1)
    )


def next_attempt_at(exam: ExamSpec, last: ExamAttempt | None, now: datetime) -> datetime | None:
    if last is None or last.submitted_at is None:
        return None
    at = last.submitted_at + timedelta(hours=exam.retry_after_hours)
    return at if at > now else None


def active_attempt(db: Session, user_id: str, exam_id: str, now: datetime) -> ExamAttempt | None:
    """Tentative démarrée, non soumise et encore dans le temps imparti (reprise après fermeture de l'app)."""
    rows = db.scalars(
        select(ExamAttempt)
        .where(ExamAttempt.user_id == user_id, ExamAttempt.exam_id == exam_id, ExamAttempt.submitted_at.is_(None))
        .order_by(ExamAttempt.started_at.desc())
    )
    for row in rows:
        if row.expires_at is not None and row.expires_at > now:
            return row
    return None


def expires_at(exam: ExamSpec, started_at: datetime) -> datetime:
    """Heure limite annoncée au client (sans la grâce, appliquée à la soumission)."""
    return started_at + timedelta(minutes=exam.duration_minutes)


def is_expired(attempt: ExamAttempt, now: datetime) -> bool:
    return attempt.expires_at is not None and now > attempt.expires_at + GRACE


# --- Notation -------------------------------------------------------------------------------


@dataclass(frozen=True)
class GradeResult:
    passed: bool
    global_score: float
    scores: dict[str, float | None]
    gaps: list[dict[str, Any]]
    graded_items: int = 0


def graded_refs(pack: Pack, exam: ExamSpec, index: frozenset[str] | set[str]) -> set[tuple[str, int]]:
    """Items notés compte tenu des médias présents (§1)."""
    concepts = concept_documents(pack)
    return {
        (section["skill"], i)
        for section in exam.sections
        for i, item in enumerate(section["items"])
        if exam_item_graded(item["step"], concepts, index)
    }


def unavailable_reason(pack: Pack, exam: ExamSpec, index: frozenset[str] | set[str]) -> str | None:
    return MEDIA_MISSING if len(graded_refs(pack, exam, index)) < MIN_GRADED_ITEMS else None


def build_items(pack: Pack, exam: ExamSpec, seed: str) -> dict[tuple[str, int], Exercise]:
    """Tous les exercices de la tentative ; ContentError si le contenu est incohérent."""
    content = content_index(pack)
    concepts = lesson_concepts_for_units(pack, exam.requires_units)
    steps = [item["step"] for section in exam.sections for item in section["items"]]
    refs = exam.items()
    return {
        ref: build_exercise(content, exam.id, concepts, steps, flat_index, seed) for flat_index, ref in enumerate(refs)
    }


def item_correct(exercise: Exercise, response: dict[str, Any] | None) -> bool:
    """Réponse manquante, non notée (micro refusé, type inattendu) ou fausse → item faux."""
    if response is None:
        return False
    if exercise.type in SPEECH_TYPES:
        score = response.get("score") if response.get("kind") == "speech" else None
        if not isinstance(score, int | float) or isinstance(score, bool):
            return False
        # Score calculé localement : on lui fait confiance, borné à 0..100.
        return min(100.0, max(0.0, float(score))) >= SPEAK_PASS_SCORE
    result = evaluate(exercise, response)
    return result.graded and result.correct


def grade(
    pack: Pack,
    exam: ExamSpec,
    seed: str,
    answers: list[dict[str, Any]],
    index: frozenset[str] | set[str] | None = None,
) -> GradeResult:
    """Note une tentative ; `index` = médias présents (défaut : ceux du pack publié)."""
    exercises = build_items(pack, exam, seed)
    graded = graded_refs(pack, exam, pack.media_index if index is None else index)
    by_item: dict[tuple[str, int], dict[str, Any]] = {}
    for answer in answers:
        by_item[(answer["section"], answer["index"])] = answer["response"]  # la dernière réponse compte

    totals = dict.fromkeys(SKILLS, 0)
    rights = dict.fromkeys(SKILLS, 0)
    wrong_concepts: dict[str, dict[str, None]] = {}
    for (skill, item_index), exercise in exercises.items():
        if (skill, item_index) not in graded:
            continue  # média manquant : item non noté, hors dénominateur
        totals[skill] += 1
        if item_correct(exercise, by_item.get((skill, item_index))):
            rights[skill] += 1
        else:
            bucket = wrong_concepts.setdefault(skill, {})
            for cid in exercise.concept_ids:
                bucket.setdefault(cid, None)

    scores: dict[str, float | None] = {
        skill: rights[skill] / totals[skill] if totals[skill] else None for skill in SKILLS
    }
    total_items = sum(totals.values())
    global_score = sum(rights.values()) / total_items if total_items else 0.0
    passed = (
        total_items > 0
        and global_score >= exam.pass_threshold - EPSILON
        and all((score or 0.0) >= MIN_SKILL_SCORE - EPSILON for score in scores.values() if score is not None)
    )
    gaps = [{"skill": skill, "conceptIds": list(wrong_concepts[skill])} for skill in SKILLS if skill in wrong_concepts]
    return GradeResult(passed=passed, global_score=global_score, scores=scores, gaps=gaps, graded_items=total_items)


__all__ = [
    "SKILLS",
    "ContentError",
    "ExamSpec",
    "GradeResult",
    "active_attempt",
    "build_items",
    "expires_at",
    "grade",
    "graded_refs",
    "is_expired",
    "is_unlocked",
    "last_submitted",
    "load_exams",
    "next_attempt_at",
    "parse_exam",
    "unavailable_reason",
]
