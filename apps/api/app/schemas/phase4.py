"""Schémas du contrat Phase 4 : rôles, studio de contenu, espace enseignant."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from app.schemas import CamelModel

Role = Literal["learner", "reviewer", "editor", "teacher", "admin"]
DocumentKind = Literal["lesson", "concept", "culture", "curriculum", "lexical-variants", "exam", "pack"]

# --- Rôles ---------------------------------------------------------------------------------


class RolesIn(CamelModel):
    roles: Annotated[list[Role], Field(max_length=5)]


class UserRolesOut(CamelModel):
    id: str
    display_name: str
    roles: list[str]


# --- Studio --------------------------------------------------------------------------------


class StudioPackOut(CamelModel):
    code: str
    name: str
    version: int


class TreeLessonOut(CamelModel):
    id: str
    title: str
    kind: str
    reviewed: bool
    draft: bool


class TreeUnitOut(CamelModel):
    id: str
    title: str
    status: str
    lessons: list[TreeLessonOut]


class TreeConceptOut(CamelModel):
    id: str
    vi: str
    reviewed: bool
    draft: bool


class TreeCultureOut(CamelModel):
    id: str
    reviewed: bool
    draft: bool


class StudioTreeOut(CamelModel):
    units: list[TreeUnitOut]
    concepts: list[TreeConceptOut]
    culture: list[TreeCultureOut]


class DraftOut(CamelModel):
    data: dict[str, Any]
    updated_at: datetime
    # Nom affiché de l'auteur (jamais l'email) ; null si le compte a été supprimé.
    updated_by: str | None


class DocumentOut(CamelModel):
    kind: DocumentKind
    id: str
    published: dict[str, Any] | None
    draft: DraftOut | None


class DocumentPut(CamelModel):
    data: dict[str, Any]
    base_updated_at: datetime | None = None


class DocumentPutOut(CamelModel):
    updated_at: datetime


class IssueOut(CamelModel):
    where: str
    message: str


class ValidationOut(CamelModel):
    errors: list[IssueOut]
    warnings: list[IssueOut]


class DocumentRef(CamelModel):
    kind: DocumentKind
    id: Annotated[str, Field(min_length=1, max_length=128)]


class PublishIn(CamelModel):
    documents: Annotated[list[DocumentRef], Field(min_length=1, max_length=500)]
    message: Annotated[str, Field(min_length=1, max_length=2000)]


class PublishOut(CamelModel):
    written: list[str]
    pack_version: int


class ReviewQueueItemOut(CamelModel):
    kind: DocumentKind
    id: str
    title: str
    vi: list[str]
    doubts: list[str]


class ReviewIn(CamelModel):
    verdict: Literal["approve", "changes"]
    comment: Annotated[str, Field(max_length=4000)] | None = None


class ReviewOut(CamelModel):
    reviewed_by: str
    reviewed_at: datetime


class AudioFileOut(CamelModel):
    path: str
    duration_ms: int


class PitchPathOut(CamelModel):
    path: str


class AudioUploadOut(CamelModel):
    files: list[AudioFileOut]
    pitch: PitchPathOut | None


# --- Espace enseignant ---------------------------------------------------------------------


class ClassCreate(CamelModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    pack_code: Annotated[str, Field(min_length=1, max_length=64)]


class ClassCreated(CamelModel):
    id: str
    name: str
    join_code: str
    pack_code: str


class ClassSummaryOut(ClassCreated):
    student_count: int


class WeakConceptOut(CamelModel):
    id: str
    vi: str
    error_rate: float


class ExamResultSummaryOut(CamelModel):
    level: str
    passed: bool
    # Score global 0–1 de la dernière tentative soumise.
    global_: float = Field(alias="global")


class StudentOut(CamelModel):
    id: str
    display_name: str
    joined_at: datetime
    last_active_date: date | None
    streak: int
    xp_week: int
    lessons_completed: int
    current_lesson_id: str | None
    weak_concepts: list[WeakConceptOut]
    exams: list[ExamResultSummaryOut]


class AssignmentOut(CamelModel):
    id: str
    title: str
    lesson_ids: list[str]
    unit_id: str | None
    due_date: date | None
    created_at: datetime
    # Vue enseignant : élèves ayant terminé toutes les leçons du devoir / nombre d'élèves.
    completed: int
    total: int


class ClassDetailOut(CamelModel):
    id: str
    name: str
    join_code: str
    pack_code: str
    students: list[StudentOut]
    assignments: list[AssignmentOut]


class AssignmentCreate(CamelModel):
    title: Annotated[str, Field(min_length=1, max_length=120)]
    lesson_ids: Annotated[list[Annotated[str, Field(min_length=1, max_length=128)]], Field(max_length=200)] | None = (
        None
    )
    unit_id: Annotated[str, Field(min_length=1, max_length=128)] | None = None
    due_date: date | None = None

    @model_validator(mode="after")
    def _one_target(self) -> "AssignmentCreate":
        if bool(self.lesson_ids) == bool(self.unit_id):
            raise ValueError("lessonIds (non vide) ou unitId, exactement un des deux")
        return self


class IdOut(CamelModel):
    id: str


class JoinCodeOut(CamelModel):
    join_code: str


class JoinIn(CamelModel):
    consent: bool = False


class JoinOut(CamelModel):
    class_id: str
    name: str
    teacher_name: str


class MyAssignmentOut(CamelModel):
    id: str
    title: str
    lesson_ids: list[str]
    due_date: date | None
    # Vue élève : leçons du devoir terminées / leçons du devoir.
    completed: int
    total: int


class MyClassOut(CamelModel):
    id: str
    name: str
    teacher_name: str
    assignments: list[MyAssignmentOut]
