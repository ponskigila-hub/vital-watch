import datetime
import math
import time

from fastapi import HTTPException
from sqlalchemy import func, select

from .models import LanguageJob, Alert, CareEvent, FamilyUpdate, Handover, Message, Patient, PredictionRun, Reading, Replay, User
from .providers import DisconnectedPrediction, ExamplePrediction
from .schemas import FAMILY_COLUMNS, PredictionRequest, PredictionResult, READING_COLUMNS

VITALS = [("HR", "Heart rate", "bpm"), ("O2Sat", "Oxygen saturation", "%"), ("SBP", "Systolic pressure", "mmHg"), ("MAP", "Mean arterial pressure", "mmHg"), ("Resp", "Respiratory rate", "/min"), ("Temp", "Temperature", "°C")]


def active_replay(db):
    replay = db.scalar(select(Replay).where(Replay.active.is_(True)))
    if replay is None:
        raise HTTPException(503, "Workspace has not been initialized")
    return replay


def require_replay(db, expected: str):
    replay = active_replay(db)
    if replay.id != expected:
        raise HTTPException(409, "The ward replay session changed. Refresh and try again.")
    return replay


def patient_or_404(db, patient_id):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(404, "Patient not found")
    return patient


def rows_for(db, patient_id, cutoff, since=0):
    return [dict(row.values) for row in db.scalars(select(Reading).where(Reading.patient_id == patient_id, Reading.hour <= cutoff, Reading.hour > since).order_by(Reading.hour))]


def prediction_request(patient_id, hour, rows):
    window = [row for row in rows if hour - 24 < row["ICULOS"] <= hour][-24:]
    return PredictionRequest(patient_id=patient_id, as_of_hour=hour, history=[{key: row.get(key) for key in READING_COLUMNS} for row in window])


def prediction(db, patient_id, replay, rows):
    provider = db.info.get("prediction_provider")
    request = prediction_request(patient_id, replay.hour, rows)
    if provider:
        run = db.scalar(select(PredictionRun).where(PredictionRun.replay_id == replay.id, PredictionRun.patient_id == patient_id, PredictionRun.hour == replay.hour, PredictionRun.model_key == provider.key))
        result = PredictionResult.model_validate(run.result) if run else provider.unavailable(request, None if not provider.ready else "No new observation at this hour, or scoring is pending.")
    else:
        result = (ExamplePrediction() if replay.example_mode else DisconnectedPrediction()).score(request)
    observed = latest_values(request.history)
    result.data_quality.update(
        history_rows=len(request.history),
        last_observed_hour={key: observed.get(key, {}).get("hour") for key, _, _ in VITALS},
        unobserved_vitals=[key for key, _, _ in VITALS if key not in observed],
        stale_vitals=[key for key, _, _ in VITALS if key in observed and replay.hour - observed[key]["hour"] > 3],
        freshness_policy="Demo display freshness only: older than three patient-hours within the scoring window. Not a clinical alert rule.",
    )
    return result


def latest_values(rows):
    result = {}
    for row in rows:
        for key, value in row.items():
            if key != "ICULOS" and value is not None:
                result[key] = {"value": value, "hour": row["ICULOS"]}
    return result


def max_hour(db):
    return db.scalar(select(func.max(Reading.hour))) or 1


def replay_out(db, replay):
    return {"id": replay.id, "hour": replay.hour, "max_hour": max_hour(db), "playing": replay.playing, "speed": replay.speed, "revision": replay.revision, "example_mode": replay.example_mode}


def tick(db, now=None):
    replay = active_replay(db)
    now = time.time() if now is None else now
    if replay.playing:
        elapsed = max(0, math.floor((now - replay.tick_at) / replay.speed))
        if elapsed:
            replay.hour = min(max_hour(db), replay.hour + elapsed)
            replay.tick_at += elapsed * replay.speed
            if replay.hour >= max_hour(db):
                replay.playing = False
            db.commit()


def event(db, user, patient_id, replay, kind, text, data=None):
    item = CareEvent(patient_id=patient_id, replay_id=replay.id, actor_id=user.id, hour=replay.hour, kind=kind, text=text, data=data or {})
    db.add(item)
    return item


def events_for(db, replay, patient_id=None):
    query = select(CareEvent).where(CareEvent.replay_id == replay.id, CareEvent.hour <= replay.hour)
    if patient_id:
        query = query.where(CareEvent.patient_id == patient_id)
    return list(db.scalars(query.order_by(CareEvent.hour.desc(), CareEvent.created.desc(), CareEvent.id.desc())))


def event_out(db, e):
    actor = db.get(User, e.actor_id)
    return {"id": e.id, "patientId": e.patient_id, "hour": e.hour, "kind": e.kind, "text": e.text, "created": datetime.datetime.fromtimestamp(e.created, datetime.timezone.utc).isoformat(), "session": e.replay_id, "actorName": actor.name if actor else "Care team", "alertId": e.data.get("alert_id"), "alertStatus": e.data.get("status"), "generationId": e.data.get("generation_id"), "actionKey": e.data.get("action_key"), "actionStatus": e.data.get("status") if e.kind == "Suggested action" else None}


def care_maps(events):
    focuses, priorities = {}, {}
    seen_priorities = set()
    for e in events:
        if e.kind == "Focus updated" and e.patient_id not in focuses:
            focuses[e.patient_id] = e.data["focus"]
        if e.kind == "Priority override" and e.patient_id not in seen_priorities:
            seen_priorities.add(e.patient_id)
            if e.data.get("priority"):
                priorities[e.patient_id] = e.data["priority"]
    return focuses, priorities


def alerts_for(db, replay, patient_id=None):
    provider = db.info.get("prediction_provider")
    if not provider and not replay.example_mode:
        return []
    query = select(Alert).where(Alert.replay_id == replay.id, Alert.hour <= replay.hour, Alert.origin == ("model" if provider else "example"))
    if provider:
        query = query.where(Alert.title == model_alert_title(provider))
    if patient_id:
        query = query.where(Alert.patient_id == patient_id)
    events = events_for(db, replay, patient_id)
    result = []
    for a in db.scalars(query.order_by(Alert.hour.desc())):
        transition = next((e for e in events if e.data.get("alert_id") == a.id), None)
        result.append({"id": a.id, "patientId": a.patient_id, "hour": a.hour, "title": a.title, "detail": a.detail, "band": a.band, "origin": a.origin, "status": transition.data["status"] if transition else "Open"})
    return result


def patient_out(db, patient, replay, rows=None):
    rows = rows_for(db, patient.id, replay.hour) if rows is None else rows
    result = prediction(db, patient.id, replay, rows)
    provider = db.info.get("prediction_provider")
    score_history = []
    if provider:
        for run in db.scalars(select(PredictionRun).where(PredictionRun.replay_id == replay.id, PredictionRun.patient_id == patient.id, PredictionRun.model_key == provider.key, PredictionRun.hour <= replay.hour, PredictionRun.hour > replay.hour - 24).order_by(PredictionRun.hour)):
            sepsis = run.result["sepsis"]
            score_history.append({"ICULOS": run.hour, "score": sepsis["score"], "threshold": sepsis.get("alert_threshold")})
    return {"score_history": score_history, "id": patient.id, "name": patient.name, "initials": "".join(w[0] for w in patient.name.split()[:2]), "age": patient.age, "sex": patient.sex, "bed": patient.bed, "color": patient.color, "source": patient.source, "provenance": patient.provenance, "focus": patient.focus, "conditions": patient.conditions, "medications": patient.medications, "readings": rows, "band": result.sepsis.band, "score": result.sepsis.score, "prediction": result.model_dump()}


def handover_out(h):
    return {"id": h.id, "patientId": h.patient_id, "session": h.replay_id, "hour": h.hour, "text": h.text, "revision": h.revision, "origin": h.origin, "generation_id": h.generation_id}


def update_out(db, update):
    actor = db.get(User, update.actor_id)
    return {"id": update.id, "patientId": update.patient_id, "session": update.replay_id, "hour": update.hour, "text": update.text, "approved": True, "approvedBy": actor.name if actor else "Care team"}


def workspace(db, replay, user):
    patients = list(db.scalars(select(Patient).order_by(Patient.bed).limit(100)))
    events = events_for(db, replay)
    focuses, priorities = care_maps(events)
    drafts, draft_meta = {}, {}
    for h in db.scalars(select(Handover).where(Handover.replay_id == replay.id, Handover.hour <= replay.hour).order_by(Handover.created.desc(), Handover.id.desc())):
        key = f"{replay.id}:{h.patient_id}"
        if key not in drafts:
            drafts[key] = h.text
            draft_meta[key] = handover_out(h)
    messages = {}
    for m in db.scalars(select(Message).where(Message.replay_id == replay.id, Message.user_id == user.id, Message.hour <= replay.hour).order_by(Message.created, Message.id)):
        messages.setdefault(f"{replay.id}:{m.patient_id}", []).append({"role": m.role, "text": m.text, "origin": m.origin, "hour": m.hour, "evidence": m.data})
    updates = [update_out(db, u) for u in db.scalars(select(FamilyUpdate).where(FamilyUpdate.replay_id == replay.id, FamilyUpdate.hour <= replay.hour, FamilyUpdate.withdrawn_at.is_(None)).order_by(FamilyUpdate.approved_at.desc()))]
    return {"integrations": integration_status(db), "replay": replay_out(db, replay), "patients": [patient_out(db, p, replay) for p in patients], "patient_count": db.scalar(select(func.count()).select_from(Patient)), "alerts": alerts_for(db, replay), "care": {"events": [event_out(db, e) for e in events], "focuses": focuses, "priorities": priorities, "drafts": drafts, "updates": updates, "messages": messages}, "draft_meta": draft_meta, "language_jobs": [{"id": j.id, "patient_id": j.patient_id, "operation": j.operation, "hour": j.hour, "status": j.status, "error": j.error} for j in db.scalars(select(LanguageJob).where(LanguageJob.replay_id == replay.id, LanguageJob.hour <= replay.hour, LanguageJob.actor_id == user.id).order_by(LanguageJob.created.desc()).limit(20))]}


def structured_handover(db, patient, replay):
    rows = rows_for(db, patient.id, replay.hour)
    latest = latest_values(rows)
    events = events_for(db, replay, patient.id)
    focuses, _ = care_maps(events)
    alerts = alerts_for(db, replay, patient.id)
    scored = prediction(db, patient.id, replay, rows)
    values = []
    for key, label, unit in VITALS:
        item = latest.get(key)
        values.append(f"{label}: {item['value']:g} {unit} (hour {item['hour']})" if item else f"{label}: no measurement available")
    actions = [f"Hour {e.hour}: {e.text}" for e in reversed(events)]
    return "\n".join([
        "VITALWATCH HANDOVER — STRUCTURED DRAFT", f"{patient.name} · Bed {patient.bed} · Patient hour {replay.hour}",
        "Patient identity and added clinical context are fictional.", f"Source: {patient.provenance}", "", "MONITORING FOCUS", focuses.get(patient.id, patient.focus), "", "LATEST AVAILABLE READINGS", *values, "", "SEPSIS MODEL",
        f"Model {scored.model_version}: score {scored.sepsis.score:.4f}, band {scored.sepsis.band}; threshold {scored.sepsis.alert_threshold:g}. Uncalibrated research score; clinician review required." if scored.origin == "model" and scored.sepsis.score is not None else "No computed model score available at this hour.", "", "ALERTS",
        *([f"{a['title']}: {a['status']} [{a['origin']} output]" for a in alerts] or ["No alert crossings recorded through this hour; this does not establish absence of sepsis."]), "", "RECORDED ACTIONS", *(actions or ["No caregiver actions recorded in this replay session."]), "", "PENDING FOLLOW-UP",
        *([f"Review: {a['title'].lower()} ({a['origin']} alert)." for a in alerts if a["status"] != "Resolved"] or ["Add clinician-confirmed follow-up tasks here."]), "", "Review and edit before sharing. Wording uses a structured template; no language model was used. Available sepsis results come from the prediction model."
    ])


def integration_status(db):
    from .language import references
    provider = db.info.get("prediction_provider")
    return {"backend": "connected", "database": "connected", "prediction": provider.status() if provider else {"provider": "disconnected", "status": "disconnected"}, "baseline": "disconnected", "language": db.info["language_provider"].status() if db.info.get("language_provider") else {"status": "disconnected"}, "references": "demo_library" if references() else "not_configured", "external_calls_enabled": bool(db.info.get("language_provider") and db.info["language_provider"].status()["external_calls_enabled"]), "linuxone": "not_deployed"}


def model_alert_title(provider):
    return f"Sepsis score threshold crossed · v1/{provider.key[-6:]} · {provider.policy.split('pct')[0]}% validation policy"


def score_through(db, replay, patient_id=None):
    """Persist causal scores and rising-edge alerts, including hours skipped by accelerated playback."""
    provider = db.info.get("prediction_provider")
    if not provider or not provider.ready:
        return
    query = select(Patient.id)
    if patient_id:
        query = query.where(Patient.id == patient_id)
    for pid in db.scalars(query):
        rows = rows_for(db, pid, replay.hour)
        existing = {r.hour: r for r in db.scalars(select(PredictionRun).where(PredictionRun.replay_id == replay.id, PredictionRun.patient_id == pid, PredictionRun.model_key == provider.key, PredictionRun.hour <= replay.hour))}
        needed = [r["ICULOS"] for r in rows if r["ICULOS"] not in existing or (existing[r["ICULOS"]].result["status"] == "unavailable" and time.time() - existing[r["ICULOS"]].created >= 30)]
        if not needed:
            continue
        results = provider.score_recording(pid, rows, needed)
        title = model_alert_title(provider)
        alerted_hours = set(db.scalars(select(Alert.hour).where(Alert.replay_id == replay.id, Alert.patient_id == pid, Alert.title == title)))
        for hour in sorted(needed):
            result = results[hour]
            previous = existing.get(hour - 1)
            previous_alert = previous.result["sepsis"].get("alert") if previous else False
            run = existing.get(hour) or PredictionRun(replay_id=replay.id, patient_id=pid, hour=hour, model_key=provider.key)
            run.result, run.created = result.model_dump(), time.time()
            db.add(run)
            existing[hour] = run
            if result.sepsis.alert and not previous_alert and hour not in alerted_hours:
                db.add(Alert(replay_id=replay.id, patient_id=pid, hour=hour, title=title, band="High", origin="model", detail=f"LightGBM v1 score {result.sepsis.score:.4f} crossed threshold {provider.threshold:.4f} at patient hour {hour}. Model/feature key: {provider.key}. This is an uncalibrated research score requiring clinician review, not a diagnosis. Continued above-threshold hours do not create repeated alerts."))
    db.commit()
