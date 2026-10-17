"""Initial VitalWatch application schema."""
from alembic import op
from api.app.models import Base

revision = "001"
down_revision = None


def upgrade():
    Base.metadata.create_all(op.get_bind())


def downgrade():
    Base.metadata.drop_all(op.get_bind())
