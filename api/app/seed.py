import csv
import hashlib
import io
import json
import math
import os
import secrets

from pwdlib import PasswordHash
from sqlalchemy import func, select

from .config import ROOT, Settings
from .models import Alert, Assignment, Patient, Reading, Replay, User
from .schemas import READING_COLUMNS

passwords = PasswordHash.recommended()


def parse_recording(content: bytes) -> list[dict]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("The PSV file must use UTF-8 text") from exc
    reader = csv.DictReader(io.StringIO(text), delimiter="|")
    headers = reader.fieldnames or []
    if len(headers) != len(set(headers)) or set(headers) - set(READING_COLUMNS + ["SepsisLabel"]) or not set(READING_COLUMNS).issubset(headers):
        raise ValueError("Expected the 40 PhysioNet 2019 columns, with optional SepsisLabel")
    result, previous = [], 0
    for line, raw in enumerate(reader, 2):
        if None in raw or any(raw.get(key) is None for key in headers):
            raise ValueError(f"Unexpected number of columns on line {line}")
        row = {}
        for key in READING_COLUMNS:
            value = raw[key].strip()
            if value.lower() in ("", "nan", "na"):
                row[key] = None
                continue
            try:
                number = float(value)
            except ValueError as exc:
                raise ValueError(f"Invalid number on line {line}") from exc
            if not math.isfinite(number):
                raise ValueError(f"Non-finite number on line {line}; use NaN for missing values")
            row[key] = number
        hour = row["ICULOS"]
        if hour is None or hour != int(hour) or hour <= previous:
            raise ValueError("Patient hours must be positive, unique, increasing integers")
        row["ICULOS"] = int(hour)
        previous = hour
        result.append(row)
        if len(result) > 20000:
            raise ValueError("One recording may contain at most 20,000 hourly rows")
    if not result:
        raise ValueError("The recording has no hourly rows")
    return result


def synthetic(index: int) -> list[dict]:
    rows = []
    for hour in range(1, 55):
        wave = math.sin(hour / 3 + index)
        change = max(0, hour - 25) * .35 if index == 1 else 0
        row = dict.fromkeys(READING_COLUMNS)
        row.update(ICULOS=hour, HR=round(70 + index * 6 + wave * 6 + change), O2Sat=round(98 - index * .4 + math.sin(hour / 5 + index)), SBP=round(122 - index * 3 + wave * 8 - change), MAP=round(84 - index + wave * 4 - change / 2), Resp=round(16 + index + math.sin(hour / 4) * 2), Temp=round(36.6 + index * .12 + math.sin(hour / 8) * .2, 1) if hour % 4 == 0 else None)
        if hour % 12 == 0:
            row.update(WBC=round(7.2 + index * .8, 1), Glucose=106 + index * 8, Creatinine=.8 + index * .1, Platelets=240 + index * 12)
        rows.append(row)
    return rows


def seed_alerts(db, replay):
    fixtures = [
        ("p000001", 28, "Review suggested", "High", "Example sepsis-model output for demonstrating the review workflow. This is not a computed prediction."),
        ("demo002", 25, "Personal pattern change", "Moderate", "Example baseline-detector output. Compare the recorded window before making a decision."),
        ("demo004", 22, "Monitoring review", "Moderate", "Synthetic alert provided to demonstrate acknowledgement and handover."),
    ]
    for patient_id, hour, title, band, detail in fixtures:
        if db.get(Patient, patient_id):
            db.add(Alert(replay_id=replay.id, patient_id=patient_id, hour=hour, title=title, band=band, detail=detail))


# Neutral fictional identities. Outcome categories and onset times are intentionally
# absent: the trainer's evaluation manifest must not enter clinical context.
HELD_OUT_IDENTITIES = [
    ("p000574", "Avery Morgan", "sage"),
    ("p000679", "Casey Patel", "blue"),
    ("p000185", "Riley Bennett", "sand"),
    ("p000346", "Morgan Ellis", "lilac"),
    ("p000021", "Taylor Reed", "rose"),
    ("p000132", "Jamie Park", "blue"),
    ("p000802", "Alex Rivera", "sage"),
]


def seed_held_out_patients(db):
    """Add the bundled recordings without resetting existing patients or replay state."""
    prepared = []
    for patient_id, name, color in HELD_OUT_IDENTITIES:
        content = (ROOT / "demo" / "held_out" / f"{patient_id}.psv").read_bytes()
        file_hash = hashlib.sha256(content).hexdigest()
        if db.scalar(select(Patient).where(Patient.source_hash == file_hash)):
            continue
        if db.get(Patient, patient_id):
            raise ValueError(f"Demo recording ID {patient_id} conflicts with a different existing patient; existing data was not replaced")
        prepared.append((patient_id, name, color, file_hash, parse_recording(content)))
    beds = set(db.scalars(select(Patient.bed)))
    number = 1
    for patient_id, name, color, file_hash, rows in prepared:
        while str(number).zfill(2) in beds:
            number += 1
        bed = str(number).zfill(2)
        beds.add(bed)
        first = rows[0]
        patient = Patient(ai_demo_approved=True, ai_context_approved=True, id=patient_id, name=name, age=first.get("Age"), sex={0: "Female", 1: "Male"}.get(first.get("Gender"), "Not specified"), bed=bed, color=color, source="recorded", source_hash=file_hash, provenance=f"PhysioNet Challenge 2019 · held-out demo recording {patient_id}.psv; fictional display identity; split designation supplied by trainer", focus="General monitoring", conditions=[], medications=[])
        db.add(patient)
        db.flush()
        db.add_all([Reading(patient_id=patient_id, hour=row["ICULOS"], values=row) for row in rows])
    return len(prepared)


def seed(db, settings: Settings):
    if not db.scalar(select(func.count()).select_from(Patient)):
        records = [
            ("p000001", "Eleanor Brooks", 83, "Female", "rose", "Sepsis monitoring", ["Demo: hypertension", "Demo: COPD"]),
            ("demo002", "James Chen", 67, "Male", "blue", "Respiratory monitoring", ["Demo: pneumonia"]),
            ("demo003", "Amara Okafor", 54, "Female", "sand", "General monitoring", ["Demo: post-operative observation"]),
            ("demo004", "William Davis", 72, "Male", "sage", "Cardiovascular monitoring", ["Demo: hypertension"]),
            ("demo005", "Sofia Ramirez", 46, "Female", "lilac", "General monitoring", ["Demo: observation"]),
            ("demo006", "Noah Williams", 61, "Male", "blue", "General monitoring", ["Demo: observation"]),
        ]
        for index, (id_, name, age, sex, color, focus, conditions) in enumerate(records):
            content = (ROOT / "demo/p000001.psv").read_bytes() if index == 0 else None
            db.add(Patient(ai_demo_approved=True, ai_context_approved=True, id=id_, name=name, age=age, sex=sex, bed=str(index + 1).zfill(2), color=color, focus=focus, conditions=conditions, medications=["Fictional medication list — not supplied by dataset"], source="recorded" if content else "synthetic", source_hash=hashlib.sha256(content).hexdigest() if content else None, provenance="PhysioNet Challenge 2019 · p000001.psv; fictional identity and clinical context" if content else "Deterministic synthetic demo readings; fictional identity and context"))
            db.flush()
            for row in parse_recording(content) if content else synthetic(index):
                db.add(Reading(patient_id=id_, hour=row["ICULOS"], values=row))
        db.flush()
    if settings.seed_held_out:
        seed_held_out_patients(db)
        db.flush()
    credentials = []
    for email, name, role, override in [("clinician@vitalwatch.local", "Dr. Alex Lee", "clinician", settings.clinician_password), ("family@vitalwatch.local", "Jordan Brooks", "family", settings.family_password)]:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            password = override or secrets.token_urlsafe(15)
            user = User(email=email, name=name, role=role, password_hash=passwords.hash(password))
            db.add(user)
            db.flush()
            credentials.append({"email": email, "password": password, "role": role})
            if role == "family" and db.get(Patient, "p000001"):
                db.add(Assignment(user_id=user.id, patient_id="p000001"))
    replay = db.scalar(select(Replay).where(Replay.active.is_(True)))
    if replay is None:
        replay = Replay()
        db.add(replay)
        db.flush()
        seed_alerts(db, replay)
    replay.playing = False
    db.commit()
    if credentials:
        settings.credentials_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(settings.credentials_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as out:
            json.dump(credentials, out, indent=2)
        settings.credentials_path.chmod(0o600)
