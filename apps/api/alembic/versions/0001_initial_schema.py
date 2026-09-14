"""Schéma initial (spec §11) : comptes, progression, SRS, journal d'événements et tables des phases suivantes.

Revision ID: 0001
Revises:
Create Date: 2026-09-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('badges',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('family', sa.String(length=16), nullable=False),
    sa.Column('criteria_json', sa.JSON(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_badges')),
    sa.UniqueConstraint('code', name=op.f('uq_badges_code'))
    )
    op.create_table('challenges',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
    sa.Column('period_end', sa.DateTime(timezone=True), nullable=False),
    sa.Column('spec_json', sa.JSON(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_challenges'))
    )
    op.create_table('courses',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('lang_code', sa.String(length=16), nullable=False),
    sa.Column('variant', sa.String(length=32), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_courses'))
    )
    op.create_table('exams',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('course_id', sa.String(length=64), nullable=False),
    sa.Column('level', sa.String(length=4), nullable=False),
    sa.Column('spec_json', sa.JSON(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_exams'))
    )
    op.create_table('users',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('display_name', sa.String(length=80), nullable=False),
    sa.Column('locale', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('is_guest', sa.Boolean(), nullable=False),
    sa.Column('apple_sub', sa.String(length=255), nullable=True),
    sa.Column('google_sub', sa.String(length=255), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('apple_sub', name=op.f('uq_users_apple_sub')),
    sa.UniqueConstraint('email', name=op.f('uq_users_email')),
    sa.UniqueConstraint('google_sub', name=op.f('uq_users_google_sub'))
    )
    op.create_table('answers',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('session_id', sa.String(length=64), nullable=True),
    sa.Column('lesson_id', sa.String(length=128), nullable=True),
    sa.Column('step_index', sa.Integer(), nullable=False),
    sa.Column('exercise_type', sa.String(length=32), nullable=False),
    sa.Column('concept_id', sa.String(length=128), nullable=True),
    sa.Column('concept_ids', sa.JSON(), nullable=False),
    sa.Column('correct', sa.Boolean(), nullable=False),
    sa.Column('near_miss', sa.Boolean(), nullable=False),
    sa.Column('response_ms', sa.Integer(), nullable=False),
    sa.Column('attempt', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_answers_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_answers'))
    )
    with op.batch_alter_table('answers', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_answers_concept_id'), ['concept_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_answers_session_id'), ['session_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_answers_user_id'), ['user_id'], unique=False)

    op.create_table('certificates',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('level', sa.String(length=4), nullable=False),
    sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('verification_code', sa.String(length=32), nullable=False),
    sa.Column('pdf_url', sa.String(length=512), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_certificates_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_certificates')),
    sa.UniqueConstraint('verification_code', name=op.f('uq_certificates_verification_code'))
    )
    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_certificates_user_id'), ['user_id'], unique=False)

    op.create_table('challenge_progress',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('challenge_id', sa.String(length=36), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['challenge_id'], ['challenges.id'], name=op.f('fk_challenge_progress_challenge_id_challenges'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_challenge_progress_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'challenge_id', name=op.f('pk_challenge_progress'))
    )
    op.create_table('enrollments',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('course_id', sa.String(length=64), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('current_lesson_id', sa.String(length=128), nullable=True),
    sa.Column('xp_total', sa.Integer(), nullable=False),
    sa.Column('level', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_enrollments_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'course_id', name=op.f('pk_enrollments'))
    )
    op.create_table('exam_attempts',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('exam_id', sa.String(length=36), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('score_json', sa.JSON(), nullable=True),
    sa.Column('passed', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['exam_id'], ['exams.id'], name=op.f('fk_exam_attempts_exam_id_exams'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_exam_attempts_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_exam_attempts'))
    )
    with op.batch_alter_table('exam_attempts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_exam_attempts_user_id'), ['user_id'], unique=False)

    op.create_table('lesson_progress',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('lesson_id', sa.String(length=128), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('score', sa.Float(), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_lesson_progress_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'lesson_id', name=op.f('pk_lesson_progress'))
    )
    op.create_table('processed_events',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('type', sa.String(length=32), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('payload_json', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_processed_events_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_processed_events'))
    )
    with op.batch_alter_table('processed_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_processed_events_user_id'), ['user_id'], unique=False)

    op.create_table('profiles',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('motivation', sa.String(length=16), nullable=True),
    sa.Column('daily_goal_min', sa.Integer(), nullable=False),
    sa.Column('reminder_hour', sa.Integer(), nullable=True),
    sa.Column('level_estimate', sa.String(length=16), nullable=True),
    sa.Column('path_variant', sa.String(length=32), nullable=True),
    sa.Column('leagues_enabled', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_profiles_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_profiles'))
    )
    op.create_table('pronunciation_scores',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('concept_id', sa.String(length=128), nullable=False),
    sa.Column('score', sa.Float(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_pronunciation_scores_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_pronunciation_scores'))
    )
    with op.batch_alter_table('pronunciation_scores', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_pronunciation_scores_user_id'), ['user_id'], unique=False)

    op.create_table('push_subscriptions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('endpoint', sa.String(length=1024), nullable=False),
    sa.Column('keys_json', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_push_subscriptions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_push_subscriptions')),
    sa.UniqueConstraint('endpoint', name=op.f('uq_push_subscriptions_endpoint'))
    )
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_push_subscriptions_user_id'), ['user_id'], unique=False)

    op.create_table('refresh_tokens',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_refresh_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_refresh_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_refresh_tokens_token_hash'))
    )
    with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_refresh_tokens_user_id'), ['user_id'], unique=False)

    op.create_table('sessions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('xp_gained', sa.Integer(), nullable=False),
    sa.Column('items_count', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=True),
    sa.Column('planned_seconds', sa.Integer(), nullable=True),
    sa.Column('duration_ms', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sessions'))
    )
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_sessions_user_id'), ['user_id'], unique=False)

    op.create_table('srs_cards',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('concept_id', sa.String(length=128), nullable=False),
    sa.Column('stability', sa.Float(), nullable=False),
    sa.Column('difficulty', sa.Float(), nullable=False),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reps', sa.Integer(), nullable=False),
    sa.Column('lapses', sa.Integer(), nullable=False),
    sa.Column('last_review', sa.DateTime(timezone=True), nullable=True),
    sa.Column('state', sa.String(length=16), nullable=False),
    sa.Column('scheduled_days', sa.Float(), nullable=False),
    sa.Column('learning_steps', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_srs_cards_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'concept_id', name=op.f('pk_srs_cards'))
    )
    with op.batch_alter_table('srs_cards', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_srs_cards_due_at'), ['due_at'], unique=False)

    op.create_table('streaks',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('current', sa.Integer(), nullable=False),
    sa.Column('longest', sa.Integer(), nullable=False),
    sa.Column('last_active_date', sa.Date(), nullable=True),
    sa.Column('freezes_available', sa.Integer(), nullable=False),
    sa.Column('frozen_until', sa.Date(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_streaks_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_streaks'))
    )
    op.create_table('tutor_messages',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('tokens', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_tutor_messages_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tutor_messages'))
    )
    with op.batch_alter_table('tutor_messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tutor_messages_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_tutor_messages_user_id'), ['user_id'], unique=False)

    op.create_table('user_badges',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('badge_id', sa.String(length=36), nullable=False),
    sa.Column('earned_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['badge_id'], ['badges.id'], name=op.f('fk_user_badges_badge_id_badges'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_badges_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'badge_id', name=op.f('pk_user_badges'))
    )


def downgrade() -> None:
    op.drop_table('user_badges')
    with op.batch_alter_table('tutor_messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tutor_messages_user_id'))
        batch_op.drop_index(batch_op.f('ix_tutor_messages_created_at'))

    op.drop_table('tutor_messages')
    op.drop_table('streaks')
    with op.batch_alter_table('srs_cards', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_srs_cards_due_at'))

    op.drop_table('srs_cards')
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_sessions_user_id'))

    op.drop_table('sessions')
    with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_refresh_tokens_user_id'))

    op.drop_table('refresh_tokens')
    with op.batch_alter_table('push_subscriptions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_push_subscriptions_user_id'))

    op.drop_table('push_subscriptions')
    with op.batch_alter_table('pronunciation_scores', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_pronunciation_scores_user_id'))

    op.drop_table('pronunciation_scores')
    op.drop_table('profiles')
    with op.batch_alter_table('processed_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_processed_events_user_id'))

    op.drop_table('processed_events')
    op.drop_table('lesson_progress')
    with op.batch_alter_table('exam_attempts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_exam_attempts_user_id'))

    op.drop_table('exam_attempts')
    op.drop_table('enrollments')
    op.drop_table('challenge_progress')
    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_certificates_user_id'))

    op.drop_table('certificates')
    with op.batch_alter_table('answers', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_answers_user_id'))
        batch_op.drop_index(batch_op.f('ix_answers_session_id'))
        batch_op.drop_index(batch_op.f('ix_answers_concept_id'))

    op.drop_table('answers')
    op.drop_table('users')
    op.drop_table('exams')
    op.drop_table('courses')
    op.drop_table('challenges')
    op.drop_table('badges')
