"""Phase 1 : cache de Cô Mai, jour local des séances (objectif quotidien), badges de la Phase 1.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-14
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: str | Sequence[str] | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copie figée de app/services/badges.py (une migration ne dépend pas du code applicatif courant).
_BADGE_NAMESPACE = uuid.UUID("5b0f6f7e-2c1a-4d4e-9a4b-7061726c6f00")
_BADGES = [
    ("streak_7", "assiduity", {"streakDays": 7}),
    ("streak_30", "assiduity", {"streakDays": 30}),
    ("first_lesson", "assiduity", {"lessonsCompleted": 1}),
    ("unit_1_done", "competence", {"unitCompleted": "vi-south.u01"}),
    ("words_50", "competence", {"conceptsLearned": 50}),
    ("tone_ear", "competence", {"toneItems": 50, "toneAccuracy": 0.95}),
]


def upgrade() -> None:
    op.create_table('tutor_cache',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('locale', sa.String(length=8), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_tutor_cache_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('key', name=op.f('pk_tutor_cache'))
    )
    with op.batch_alter_table('tutor_cache', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tutor_cache_expires_at'), ['expires_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_tutor_cache_user_id'), ['user_id'], unique=False)

    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('local_date', sa.Date(), nullable=True))

    badges = sa.table(
        'badges',
        sa.column('id', sa.String(36)),
        sa.column('code', sa.String(64)),
        sa.column('family', sa.String(16)),
        sa.column('criteria_json', sa.JSON()),
    )
    conn = op.get_bind()
    existing = set(conn.execute(sa.select(badges.c.code)).scalars())
    rows = [
        {'id': str(uuid.uuid5(_BADGE_NAMESPACE, code)), 'code': code, 'family': family, 'criteria_json': criteria}
        for code, family, criteria in _BADGES
        if code not in existing
    ]
    if rows:
        op.bulk_insert(badges, rows)


def downgrade() -> None:
    badges = sa.table('badges', sa.column('id', sa.String(36)), sa.column('code', sa.String(64)))
    user_badges = sa.table('user_badges', sa.column('badge_id', sa.String(36)))
    codes = [code for code, _, _ in _BADGES]
    ids = sa.select(badges.c.id).where(badges.c.code.in_(codes))
    op.execute(user_badges.delete().where(user_badges.c.badge_id.in_(ids)))
    op.execute(badges.delete().where(badges.c.code.in_(codes)))

    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_column('local_date')

    with op.batch_alter_table('tutor_cache', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tutor_cache_user_id'))
        batch_op.drop_index(batch_op.f('ix_tutor_cache_expires_at'))

    op.drop_table('tutor_cache')
