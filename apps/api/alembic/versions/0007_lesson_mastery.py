"""Maîtrise des leçons : la garder pour la rendre à un appareil neuf.

Le client exige la *maîtrise* d'une leçon — tous ses exercices notés réussis, réessais compris
(contrat phase10 §3) — pour ouvrir la suivante. Elle ne montait pas au serveur : un compte restauré
sur un autre appareil retrouvait ses leçons « terminées » mais plus aucune ouverte derrière. La
colonne la reçoit désormais avec `lesson_completed` (contrat phase25 §1).

Les lignes existantes partent à `false` : le serveur n'a jamais su lesquelles étaient maîtrisées.
Le client la redéduit d'un score parfait — qui l'implique — et la réécrit dès la prochaine leçon.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: str | Sequence[str] | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('lesson_progress', schema=None) as batch_op:
        batch_op.add_column(sa.Column('mastered', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('lesson_progress', schema=None) as batch_op:
        batch_op.drop_column('mastered')
