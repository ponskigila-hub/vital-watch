import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

READING_COLUMNS = "HR O2Sat Temp SBP MAP DBP Resp EtCO2 BaseExcess HCO3 FiO2 pH PaCO2 SaO2 AST BUN Alkalinephos Calcium Chloride Creatinine Bilirubin_direct Glucose Lactate Magnesium Phosphate Potassium Bilirubin_total TroponinI Hct Hgb PTT WBC Fibrinogen Platelets Age Gender Unit1 Unit2 HospAdmTime ICULOS".split()
FAMILY_COLUMNS = ("HR", "O2Sat", "SBP")


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Input):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class UserOut(Input):
    id: str
    email: str
    name: str
    role: Literal["clinician", "family"]


class Command(Input):
    session_id: str = Field(min_length=1, max_length=64)


class TextCommand(Command):
    text: str = Field(min_length=1, max_length=16000)
    demo_content_confirmed: bool = False

    @model_validator(mode="after")
    def trim(self):
        self.text = self.text.strip()
        if not self.text:
            raise ValueError("Text must not be blank")
        return self


class FocusCommand(Command):
    focus: str = Field(min_length=1, max_length=200)


class PriorityCommand(Command):
    priority: Literal["Urgent", "Review soon", "Routine"] | None
    reason: str = Field(min_length=1, max_length=2000)


class AlertCommand(Command):
    status: Literal["Open", "Acknowledged", "In progress", "Resolved"]


class AlertWorkflowCommand(Command):
    hour: int = Field(ge=1)
    version: str | None = Field(default=None, max_length=64)
    operation: Literal["claim", "release", "schedule", "complete"]
    due_hour: int | None = Field(default=None, ge=1)


class PlaybackCommand(Command):
    revision: int = Field(ge=1)
    hour: int | None = Field(default=None, ge=1)
    playing: bool | None = None
    speed: Literal[1, 3, 5, 10] | None = None
    example_mode: bool | None = None


class HandoverEdit(TextCommand):
    revision: int = Field(ge=1)


class ProfileEdit(Input):
    name: str = Field(min_length=1, max_length=120)
    conditions: list[str] = Field(max_length=30)
    medications: list[str] = Field(max_length=50)


class FamilyReading(Input):
    ICULOS: int
    HR: float | None = None
    O2Sat: float | None = None
    SBP: float | None = None


class ApprovedUpdate(Input):
    id: str
    text: str
    hour: int
    approvedBy: str


class FamilyPatient(Input):
    id: str
    name: str
    initials: str
    bed: str
    source: Literal["recorded", "synthetic"]
    readings: list[FamilyReading]
    updates: list[ApprovedUpdate]


class FamilyView(Input):
    user: UserOut
    session_id: str
    hour: int
    patients: list[FamilyPatient]


class PredictionRequest(Input):
    schema_version: str = "1"
    patient_id: str
    as_of_hour: int = Field(ge=1)
    history: list[dict[str, float | None]] = Field(max_length=24)

    @model_validator(mode="after")
    def causal_history(self):
        previous = 0
        for row in self.history:
            if set(row) - set(READING_COLUMNS):
                raise ValueError("Only the 40 PhysioNet input columns are allowed; labels and clinical context are excluded")
            hour = row.get("ICULOS")
            if hour is None or hour != int(hour) or not previous < hour <= self.as_of_hour or hour <= self.as_of_hour - 24:
                raise ValueError("Rows must be ordered and unique, within the last 24 patient-hours, and no later than as_of_hour")
            if any(v is not None and not math.isfinite(v) for v in row.values()):
                raise ValueError("Missing values must be null; non-finite numbers are not allowed")
            previous = hour
        return self


class Factor(Input):
    feature: str
    value: float | None = None
    measurement_direction: Literal["up", "down", "unchanged"] | None = None
    contribution: float | None = None
    observation_hours: list[int] = Field(default_factory=list)


class SepsisOutput(Input):
    status: Literal["unavailable", "insufficient_history", "ok", "example"] = "unavailable"
    score: float | None = Field(default=None, ge=0, le=1)
    band: Literal["High", "Moderate", "Low"] | None = None
    alert: bool | None = None
    alert_threshold: float | None = Field(default=None, ge=0, le=1)
    alert_policy: str | None = None
    factors: list[Factor] = Field(default_factory=list)


class BaselineOutput(Input):
    status: Literal["unavailable", "insufficient_history", "ok", "example"] = "unavailable"
    deviations: dict[str, float | None] = Field(default_factory=dict)


class PredictionResult(Input):
    schema_version: str = "1"
    patient_id: str
    as_of_hour: int
    status: Literal["unavailable", "insufficient_history", "ok", "partial", "example"]
    sepsis: SepsisOutput = Field(default_factory=SepsisOutput)
    baseline: BaselineOutput = Field(default_factory=BaselineOutput)
    data_quality: dict = Field(default_factory=dict)
    model_version: str | None = None
    feature_version: str | None = None
    origin: Literal["disconnected", "example", "model"] = "disconnected"
    limitations: list[str] = Field(default_factory=list)


class ReferencePassage(Input):
    id: str
    title: str
    url: str
    passage: str
    provenance: str
    reviewed: bool = False
    approved_for_demo: bool = False


class LanguageRequest(Input):
    operation: Literal["question", "explanation", "focus", "handover", "guidance"]
    patient_id: str
    as_of_hour: int = Field(ge=1)
    question: str = Field(default="", max_length=16000)
    observations: list[dict[str, float | None]] = Field(default_factory=list)
    clinical_context: dict = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    prediction: PredictionResult | None = None
    references: list[ReferencePassage] = Field(default_factory=list)
    evidence: dict = Field(default_factory=dict)
    conversation: list[dict[str, str]] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_context(self):
        for row in self.observations:
            if set(row) - set(READING_COLUMNS) or not 0 < (row.get("ICULOS") or 0) <= self.as_of_hour:
                raise ValueError("AI observations must be label-free and within the replay cutoff")
        if self.prediction and (self.prediction.patient_id != self.patient_id or self.prediction.as_of_hour > self.as_of_hour):
            raise ValueError("Prediction evidence must match the patient and cutoff")
        ids = [ref.id for ref in self.references]
        if len(ids) != len(set(ids)):
            raise ValueError("Reference IDs must be unique")
        return self


class ObservationReference(Input):
    measurement: str
    hour: int


class GroundedStatement(Input):
    text: str = Field(min_length=1, max_length=1000)
    evidence_ids: list[str] = Field(min_length=1, max_length=12)
    citations: list[str] = Field(default_factory=list, max_length=5)


class SuggestedStep(Input):
    action_id: str
    reason: str = Field(min_length=1, max_length=700)
    evidence_ids: list[str] = Field(min_length=1, max_length=12)
    citations: list[str] = Field(min_length=1, max_length=5)


class LanguageResult(Input):
    _model_used: str | None = PrivateAttr(default=None)
    status: Literal["disconnected", "example", "ok", "unavailable"]
    text: str = Field(max_length=8000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=30)
    observations: list[GroundedStatement] = Field(default_factory=list, max_length=3)
    actions: list[SuggestedStep] = Field(default_factory=list, max_length=3)
    citations: list[str] = Field(default_factory=list)
    observation_references: list[ObservationReference] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    proposed_focus: str | None = None
    requires_clinician_confirmation: bool = True


class GenerationCommand(Command):
    retry: bool = False


class HandoverCommand(Command):
    mode: Literal["template", "gemini"] = "template"


class SuggestedActionCommand(Command):
    status: Literal["accepted", "dismissed", "completed"]
