import time
import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def identifier() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(Text)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    csrf: Mapped[str] = mapped_column(String)
    expires: Mapped[float] = mapped_column(Float)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String, index=True)
    created: Mapped[float] = mapped_column(Float, default=time.time)


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    age: Mapped[float | None] = mapped_column(Float, nullable=True)
    sex: Mapped[str] = mapped_column(String, default="Not specified")
    bed: Mapped[str] = mapped_column(String, unique=True)
    color: Mapped[str] = mapped_column(String, default="sage")
    source: Mapped[str] = mapped_column(String)
    provenance: Mapped[str] = mapped_column(Text)
    source_hash: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    focus: Mapped[str] = mapped_column(String, default="General monitoring")
    conditions: Mapped[list] = mapped_column(JSON, default=list)
    medications: Mapped[list] = mapped_column(JSON, default=list)


class Assignment(Base):
    __tablename__ = "assignments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    __table_args__ = (UniqueConstraint("user_id", "patient_id"),)


class Reading(Base):
    __tablename__ = "readings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    hour: Mapped[int] = mapped_column(Integer)
    values: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("patient_id", "hour"), Index("reading_patient_hour", "patient_id", "hour"))


class Replay(Base):
    __tablename__ = "replays"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    hour: Mapped[int] = mapped_column(Integer, default=34)
    playing: Mapped[bool] = mapped_column(Boolean, default=False)
    speed: Mapped[int] = mapped_column(Integer, default=3)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    example_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    tick_at: Mapped[float] = mapped_column(Float, default=time.time)


class CareEvent(Base):
    __tablename__ = "care_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    replay_id: Mapped[str] = mapped_column(ForeignKey("replays.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    hour: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created: Mapped[float] = mapped_column(Float, default=time.time)
    __table_args__ = (Index("care_event_replay_patient_hour", "replay_id", "patient_id", "hour"),)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    replay_id: Mapped[str] = mapped_column(ForeignKey("replays.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    hour: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(Text)
    band: Mapped[str] = mapped_column(String)
    origin: Mapped[str] = mapped_column(String, default="example")
    __table_args__ = (UniqueConstraint("replay_id", "patient_id", "title", "hour"),)


class Handover(Base):
    __tablename__ = "handovers"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    replay_id: Mapped[str] = mapped_column(ForeignKey("replays.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    hour: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created: Mapped[float] = mapped_column(Float, default=time.time)


class FamilyUpdate(Base):
    __tablename__ = "family_updates"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    replay_id: Mapped[str] = mapped_column(ForeignKey("replays.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    hour: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    approved_at: Mapped[float] = mapped_column(Float, default=time.time)
    withdrawn_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    replay_id: Mapped[str] = mapped_column(ForeignKey("replays.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    hour: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String, default="disconnected")
    created: Mapped[float] = mapped_column(Float, default=time.time)
