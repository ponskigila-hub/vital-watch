"""Per-clinician review checkpoints; factual changes, independent of alert resolution."""
import hashlib
import json

from fastapi import Depends, HTTPException
from pydantic import Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from .models import CareEvent, Replay
from .schemas import Command
from .security import clinician, writing_clinician, get_db
from .services import active_replay, require_replay, patient_or_404, rows_for, latest_values, prediction, alerts_for, events_for, event, VITALS
from .language import CATALOGUE

REVIEW_KIND = "Review checkpoint"
LAB_KEYS = "BaseExcess HCO3 FiO2 pH PaCO2 SaO2 AST BUN Alkalinephos Calcium Chloride Creatinine Bilirubin_direct Glucose Lactate Magnesium Phosphate Potassium Bilirubin_total TroponinI Hct Hgb PTT WBC Fibrinogen Platelets".split()
VITAL_KEYS = [key for key, _, _ in VITALS] + ["DBP", "EtCO2"]


class ReviewCommand(Command):
    hour: int = Field(ge=1)
    checkpoint_id: str | None = Field(default=None, max_length=64)
    fingerprint: str = Field(min_length=64, max_length=64)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def last_review(db, patient_id, replay, user):
    return db.scalar(select(CareEvent).where(CareEvent.patient_id == patient_id, CareEvent.replay_id == replay.id, CareEvent.actor_id == user.id, CareEvent.kind == REVIEW_KIND).order_by(CareEvent.created.desc(), CareEvent.id.desc()).limit(1))


def review_data(db, patient, replay, user):
    checkpoint = last_review(db, patient.id, replay, user)
    rows = rows_for(db, patient.id, replay.hour)
    latest = {k: v for k, v in latest_values(rows).items() if k in VITAL_KEYS + LAB_KEYS}
    alerts = alerts_for(db, replay, patient.id)
    care = [e for e in events_for(db, replay, patient.id) if e.kind != REVIEW_KIND]
    result = prediction(db, patient.id, replay, rows)
    provider = db.info.get("prediction_provider")
    score = {"score": result.sepsis.score, "threshold": result.sepsis.alert_threshold, "hour": result.as_of_hour, "model": [result.origin, result.model_version, result.feature_version, result.sepsis.alert_policy, getattr(provider, "key", None)]}
    current = {"hour": replay.hour, "latest": latest, "alerts": sorted([{"id": a["id"], "status": a["status"]} for a in alerts], key=lambda a: a["id"]), "care_ids": [e.id for e in care], "score": score}
    rewind = bool(checkpoint and checkpoint.hour > replay.hour)
    baseline = checkpoint.data["snapshot"] if checkpoint and not rewind else None
    new_alerts = [a for a in alerts if a["id"] not in {a["id"] for a in baseline["alerts"]}] if baseline else []
    new_care = [e for e in care if e.id not in set(baseline["care_ids"])] if baseline else []
    vitals, labs = [], []
    if baseline:
        for key in VITAL_KEYS:
            previous, last = baseline["latest"].get(key), latest.get(key)
            if last and last["hour"] > checkpoint.hour and (not previous or last["value"] != previous["value"]):
                vitals.append({"key": key, "previous": previous, "current": last, "difference": last["value"] - previous["value"] if previous else None})
        for key in LAB_KEYS:
            values = [r for r in rows if r["ICULOS"] > checkpoint.hour and r.get(key) is not None]
            if values:
                labs.append({"key": key, "count": len(values), "value": values[-1][key], "hour": values[-1]["ICULOS"]})
    latest_actions = {}
    for e in care:
        if e.kind == "Suggested action" and e.data.get("generation_id") and e.data.get("action_key") in CATALOGUE:
            latest_actions.setdefault((e.data["generation_id"], e.data["action_key"]), e)
    planned = [{"id": e.id, "hour": e.hour, "label": CATALOGUE[e.data["action_key"]]} for e in latest_actions.values() if e.data.get("status") == "accepted"]
    quality = {"missing": [key for key, _, _ in VITALS if key not in latest], "older": [{"key": key, **latest[key], "age_hours": replay.hour - latest[key]["hour"]} for key, _, _ in VITALS if key in latest and replay.hour - latest[key]["hour"] > 3]}
    changed_score = None
    if baseline and any(baseline["score"].get(k) != score[k] for k in ("score", "threshold", "model")):
        previous = baseline["score"]
        changed_score = {"previous": previous, "current": score, "comparable": previous["model"] == score["model"]}
    view = {
        "patient_id": patient.id, "session_id": replay.id, "hour": replay.hour,
        "checkpoint": {"id": checkpoint.id, "hour": checkpoint.hour, "created": checkpoint.created} if checkpoint else None,
        "rewind": rewind, "fingerprint": digest(current),
        "can_mark": not rewind and (not checkpoint or checkpoint.data.get("fingerprint") != digest(current)),
        "counts": {"alerts": len(new_alerts), "lab_results": sum(l["count"] for l in labs), "care_updates": len(new_care)},
        "new_alerts": [{"id": a["id"], "hour": a["hour"], "status": a["status"]} for a in new_alerts],
        "vital_changes": vitals, "labs": labs, "score_change": changed_score,
        "care_updates": [{"id": e.id, "hour": e.hour, "kind": e.kind, "text": e.text} for e in new_care[:30]],
        "unresolved_alerts": [{"id": a["id"], "hour": a["hour"], "status": a["status"]} for a in alerts if a["status"] != "Resolved"],
        "planned_actions": planned, "quality": quality,
        "scheduled_followups": [{"id": a["id"], "due_hour": a["workflow"]["due_hour"], "overdue": a["workflow"]["overdue"], "due_now": a["workflow"]["due_now"]} for a in alerts if a["workflow"]["follow_up"] == "scheduled"],
    }
    return view, current


def register_review_routes(app):
    @app.get("/api/v1/patients/{patient_id}/review")
    def get_review(patient_id: str, user=Depends(clinician), db=Depends(get_db)):
        return review_data(db, patient_or_404(db, patient_id), active_replay(db), user)[0]

    @app.post("/api/v1/patients/{patient_id}/review")
    def mark_reviewed(patient_id: str, body: ReviewCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        replay = require_replay(db, body.session_id)
        patient = patient_or_404(db, patient_id)
        # Lock/check the shared hour before capturing a checkpoint. Never mark unseen later data.
        locked = db.execute(update(Replay).where(Replay.id == replay.id, Replay.active.is_(True), Replay.hour == body.hour).values(revision=Replay.revision))
        if locked.rowcount != 1:
            raise HTTPException(409, "Replay advanced. Refresh the briefing before marking reviewed.")
        db.refresh(replay)
        view, snapshot = review_data(db, patient, replay, user)
        if view["rewind"]:
            raise HTTPException(409, "Return to your last review hour before creating another checkpoint.")
        if (view["checkpoint"]["id"] if view["checkpoint"] else None) != body.checkpoint_id or view["fingerprint"] != body.fingerprint:
            raise HTTPException(409, "The briefing changed. Review the refreshed information and try again.")
        if not view["can_mark"]:
            return view
        item = event(db, user, patient.id, replay, REVIEW_KIND, f"Reviewed available information through patient hour {replay.hour}.", {"snapshot": snapshot, "fingerprint": view["fingerprint"]})
        item.id = digest([REVIEW_KIND, user.id, patient.id, replay.id, body.checkpoint_id, body.fingerprint])
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "This briefing was already marked reviewed. Refresh the panel.")
        return review_data(db, patient, replay, user)[0]
