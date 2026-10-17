"""Demo language jobs, provenance, and clinician action tracking."""
from alembic import op
import sqlalchemy as sa
from api.app.models import LanguageJob, SuggestedAction
revision = "003"
down_revision = "002"


def upgrade():
    inspector = sa.inspect(op.get_bind())
    additions = {
        "patients": [sa.Column("ai_demo_approved", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("ai_context_approved", sa.Boolean(), nullable=False, server_default=sa.false())],
        "messages": [sa.Column("data", sa.JSON(), nullable=False, server_default="{}")],
        "handovers": [sa.Column("origin", sa.String(), nullable=False, server_default="structured_template"), sa.Column("generation_id", sa.String(), nullable=True)],
    }
    # Migration 001 uses live metadata on fresh installs; existing installations need additions.
    for table, columns in additions.items():
        existing = {c["name"] for c in inspector.get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    LanguageJob.__table__.create(op.get_bind(), checkfirst=True)
    SuggestedAction.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    SuggestedAction.__table__.drop(op.get_bind())
    LanguageJob.__table__.drop(op.get_bind())
    for table, columns in [("patients", ["ai_demo_approved", "ai_context_approved"]), ("messages", ["data"]), ("handovers", ["origin", "generation_id"])]:
        with op.batch_alter_table(table) as batch:
            for column in columns:
                batch.drop_column(column)
