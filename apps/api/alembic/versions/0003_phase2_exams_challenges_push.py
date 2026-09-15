"""Phase 2 : examens, certificats, défis de la semaine, rappels push, parties de mini-jeux, fuseau du profil.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-14
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: str | Sequence[str] | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copie figée de app/services/badges.py (badges des défis de la semaine, décernés par le serveur).
_BADGE_NAMESPACE = uuid.UUID("5b0f6f7e-2c1a-4d4e-9a4b-7061726c6f00")
_BADGES = [
    ("challenge_words_theme", "challenge", {"challengeKind": "words_theme"}),
    ("challenge_streak_days", "challenge", {"challengeKind": "streak_days"}),
    ("challenge_speaking_minutes", "challenge", {"challengeKind": "speaking_minutes"}),
    ("challenge_lessons", "challenge", {"challengeKind": "lessons"}),
    ("challenge_game_score", "challenge", {"challengeKind": "game_score"}),
]


def upgrade() -> None:
    op.create_table('game_plays',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('game', sa.String(length=32), nullable=False),
    sa.Column('correct', sa.Integer(), nullable=False),
    sa.Column('total', sa.Integer(), nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('played_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_game_plays_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_game_plays'))
    )
    with op.batch_alter_table('game_plays', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_game_plays_played_at'), ['played_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_game_plays_user_id'), ['user_id'], unique=False)

    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.add_column(sa.Column('course_id', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('attempt_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('display_name', sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column('certificate_name', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('scores_json', sa.JSON(), nullable=True))
        batch_op.create_foreign_key(batch_op.f('fk_certificates_attempt_id_exam_attempts'), 'exam_attempts', ['attempt_id'], ['id'], ondelete='SET NULL')

    with op.batch_alter_table('challenge_progress', schema=None) as batch_op:
        batch_op.add_column(sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('unit_id', sa.String(length=128), nullable=True))

    with op.batch_alter_table('exam_attempts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('answers_json', sa.JSON(), nullable=True))

    with op.batch_alter_table('processed_events', schema=None) as batch_op:
        batch_op.create_index('ix_processed_events_user_type_occurred', ['user_id', 'type', 'occurred_at'], unique=False)

    with op.batch_alter_table('profiles', schema=None) as batch_op:
        batch_op.add_column(sa.Column('timezone', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('notifications_enabled', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column('placement_entry_lesson_id', sa.String(length=128), nullable=True))

    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('reminder_hour', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('timezone', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('last_notified_on', sa.Date(), nullable=True))

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

    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.drop_column('last_notified_on')
        batch_op.drop_column('timezone')
        batch_op.drop_column('reminder_hour')

    with op.batch_alter_table('profiles', schema=None) as batch_op:
        batch_op.drop_column('placement_entry_lesson_id')
        batch_op.drop_column('notifications_enabled')
        batch_op.drop_column('timezone')

    with op.batch_alter_table('processed_events', schema=None) as batch_op:
        batch_op.drop_index('ix_processed_events_user_type_occurred')

    with op.batch_alter_table('exam_attempts', schema=None) as batch_op:
        batch_op.drop_column('answers_json')
        batch_op.drop_column('expires_at')

    with op.batch_alter_table('challenge_progress', schema=None) as batch_op:
        batch_op.drop_column('unit_id')
        batch_op.drop_column('claimed_at')

    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_certificates_attempt_id_exam_attempts'), type_='foreignkey')
        batch_op.drop_column('scores_json')
        batch_op.drop_column('certificate_name')
        batch_op.drop_column('display_name')
        batch_op.drop_column('attempt_id')
        batch_op.drop_column('course_id')

    with op.batch_alter_table('game_plays', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_game_plays_user_id'))
        batch_op.drop_index(batch_op.f('ix_game_plays_played_at'))

    op.drop_table('game_plays')
