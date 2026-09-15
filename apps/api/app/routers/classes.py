"""Espace enseignant `/classes/*` (rôle teacher) et côté élève `/classes/join`, `/me/classes` (contrat Phase 4 §2)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select

from app.deps import CurrentUser, DbDep, PacksDep, require_roles, user_roles
from app.models import Assignment, ClassMember, SchoolClass, User
from app.schemas.phase4 import (
    AssignmentCreate,
    AssignmentOut,
    ClassCreate,
    ClassCreated,
    ClassDetailOut,
    ClassSummaryOut,
    ExamResultSummaryOut,
    IdOut,
    JoinCodeOut,
    JoinIn,
    JoinOut,
    MyAssignmentOut,
    MyClassOut,
    StudentOut,
    WeakConceptOut,
)
from app.services import classes

router = APIRouter(tags=["classes"])

TeacherUser = Annotated[User, Depends(require_roles("teacher"))]

_ERROR_STATUS = {
    "class_not_found": status.HTTP_404_NOT_FOUND,
    "class_full": status.HTTP_409_CONFLICT,
    "own_class": status.HTTP_409_CONFLICT,
    "consent_required": status.HTTP_400_BAD_REQUEST,
    "code_generation_failed": status.HTTP_503_SERVICE_UNAVAILABLE,
}


def _owned_class(db: DbDep, user: User, class_id: str) -> SchoolClass:
    """Classe de l'enseignant (un admin voit toutes les classes) ; 404 sinon, sans révéler l'existence."""
    klass = db.get(SchoolClass, class_id)
    if klass is None or (klass.teacher_id != user.id and "admin" not in user_roles(user)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="class_not_found")
    return klass


def _error(db: DbDep, exc: classes.ClassError) -> HTTPException:
    db.rollback()
    return HTTPException(_ERROR_STATUS.get(str(exc), status.HTTP_409_CONFLICT), detail=str(exc))


@router.post("/classes", response_model=ClassCreated, status_code=status.HTTP_201_CREATED)
def create_class(body: ClassCreate, user: TeacherUser, db: DbDep, packs: PacksDep) -> ClassCreated:
    if body.pack_code not in packs:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown_pack")
    if not body.name.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="name_required")
    try:
        klass = classes.create_class(db, user, body.name, body.pack_code, datetime.now(UTC))
    except classes.ClassError as exc:
        raise _error(db, exc) from exc
    db.commit()
    return ClassCreated(id=klass.id, name=klass.name, join_code=klass.join_code, pack_code=klass.pack_code)


@router.get("/classes", response_model=list[ClassSummaryOut])
def list_classes(user: TeacherUser, db: DbDep) -> list[ClassSummaryOut]:
    counts = select(ClassMember.class_id, func.count().label("n")).group_by(ClassMember.class_id).subquery()
    rows = db.execute(
        select(SchoolClass, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.class_id == SchoolClass.id)
        .where(SchoolClass.teacher_id == user.id)
        .order_by(SchoolClass.created_at, SchoolClass.id)
    ).all()
    return [
        ClassSummaryOut(id=k.id, name=k.name, join_code=k.join_code, pack_code=k.pack_code, student_count=int(n))
        for k, n in rows
    ]


@router.get("/classes/{class_id}", response_model=ClassDetailOut)
def get_class(class_id: str, user: TeacherUser, db: DbDep, packs: PacksDep) -> ClassDetailOut:
    klass = _owned_class(db, user, class_id)
    now = datetime.now(UTC)
    students = classes.students_progress(db, klass, packs.get(klass.pack_code), now)
    assignments = classes.assignments_of(db, klass.id)
    done = classes.assignment_completion(db, klass, assignments)
    return ClassDetailOut(
        id=klass.id,
        name=klass.name,
        join_code=klass.join_code,
        pack_code=klass.pack_code,
        students=[
            StudentOut(
                id=s.id,
                display_name=s.display_name,
                joined_at=s.joined_at,
                last_active_date=s.last_active_date,
                streak=s.streak,
                xp_week=s.xp_week,
                lessons_completed=s.lessons_completed,
                current_lesson_id=s.current_lesson_id,
                weak_concepts=[WeakConceptOut.model_validate(w) for w in s.weak_concepts],
                exams=[ExamResultSummaryOut.model_validate(e) for e in s.exams],
            )
            for s in students
        ],
        assignments=[
            AssignmentOut(
                id=a.id,
                title=a.title,
                lesson_ids=a.lesson_ids,
                unit_id=a.unit_id,
                due_date=a.due_date,
                created_at=a.created_at,
                completed=done.get(a.id, 0),
                total=len(students),
            )
            for a in assignments
        ],
    )


@router.post("/classes/{class_id}/assignments", response_model=IdOut, status_code=status.HTTP_201_CREATED)
def create_assignment(class_id: str, body: AssignmentCreate, user: TeacherUser, db: DbDep, packs: PacksDep) -> IdOut:
    klass = _owned_class(db, user, class_id)
    pack = packs.get(klass.pack_code)
    if pack is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="pack_unavailable")
    if body.unit_id:
        unit = next((u for u in pack.units if u.id == body.unit_id), None)
        if unit is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown_unit")
        lesson_ids = list(unit.lessons)
    else:
        lesson_ids = list(dict.fromkeys(body.lesson_ids or []))
        unknown = [lid for lid in lesson_ids if lid not in pack.lessons]
        if unknown:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "unknown_lessons", "ids": unknown}
            )
    if not lesson_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="no_lessons")
    assignment = Assignment(
        class_id=klass.id,
        title=body.title.strip(),
        lesson_ids=lesson_ids,
        unit_id=body.unit_id,
        due_date=body.due_date,
        created_at=datetime.now(UTC),
    )
    db.add(assignment)
    db.commit()
    return IdOut(id=assignment.id)


@router.delete("/classes/{class_id}/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(class_id: str, assignment_id: str, user: TeacherUser, db: DbDep) -> Response:
    klass = _owned_class(db, user, class_id)
    assignment = db.get(Assignment, assignment_id)
    if assignment is None or assignment.class_id != klass.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="assignment_not_found")
    db.delete(assignment)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/classes/{class_id}/regenerate-code", response_model=JoinCodeOut)
def regenerate_code(class_id: str, user: TeacherUser, db: DbDep) -> JoinCodeOut:
    klass = _owned_class(db, user, class_id)
    try:
        code = classes.regenerate_code(db, klass)
    except classes.ClassError as exc:
        raise _error(db, exc) from exc
    db.commit()
    return JoinCodeOut(join_code=code)


@router.delete("/classes/{class_id}/students/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_student(class_id: str, user_id: str, user: TeacherUser, db: DbDep) -> Response:
    klass = _owned_class(db, user, class_id)
    member = db.get(ClassMember, (klass.id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="student_not_found")
    db.delete(member)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Côté élève ----------------------------------------------------------------------------


@router.post("/classes/join/{join_code}", response_model=JoinOut)
def join_class(join_code: str, user: CurrentUser, db: DbDep, body: JoinIn | None = None) -> JoinOut:
    try:
        klass = classes.join_class(db, user, join_code, bool(body and body.consent), datetime.now(UTC))
    except classes.ClassError as exc:
        raise _error(db, exc) from exc
    teacher = db.get(User, klass.teacher_id)
    db.commit()
    return JoinOut(class_id=klass.id, name=klass.name, teacher_name=teacher.display_name if teacher else "")


@router.get("/me/classes", response_model=list[MyClassOut])
def my_classes(user: CurrentUser, db: DbDep) -> list[MyClassOut]:
    rows = db.execute(
        select(SchoolClass, User.display_name)
        .join(ClassMember, ClassMember.class_id == SchoolClass.id)
        .join(User, User.id == SchoolClass.teacher_id)
        .where(ClassMember.user_id == user.id)
        .order_by(ClassMember.joined_at, SchoolClass.id)
    ).all()
    out = []
    for klass, teacher_name in rows:
        done = classes.completed_lessons_of(db, user.id, klass.pack_code)
        out.append(
            MyClassOut(
                id=klass.id,
                name=klass.name,
                teacher_name=teacher_name,
                assignments=[
                    MyAssignmentOut(
                        id=a.id,
                        title=a.title,
                        lesson_ids=a.lesson_ids,
                        due_date=a.due_date,
                        completed=len(set(a.lesson_ids) & done),
                        total=len(a.lesson_ids),
                    )
                    for a in classes.assignments_of(db, klass.id)
                ],
            )
        )
    return out


@router.delete("/me/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
def leave_class(class_id: str, user: CurrentUser, db: DbDep) -> Response:
    member = db.get(ClassMember, (class_id, user.id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="class_not_found")
    db.delete(member)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
