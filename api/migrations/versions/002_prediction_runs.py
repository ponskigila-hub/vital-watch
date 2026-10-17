"""Persist versioned model results without replacing care records."""
from alembic import op
from api.app.models import PredictionRun

revision = "002"
down_revision = "001"


def upgrade():
    PredictionRun.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    PredictionRun.__table__.drop(op.get_bind(), checkfirst=True)
