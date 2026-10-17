"""Clinician-only generation and explicit suggestion state transitions."""
import time
from fastapi import Depends, HTTPException
from sqlalchemy import select
from .models import LanguageJob, SuggestedAction, CareEvent
from .schemas import GenerationCommand, SuggestedActionCommand
from .security import clinician, writing_clinician, get_db
from .services import patient_or_404, require_replay, active_replay, event
from .language import CATALOGUE, queue_job, job_out, guidance_view, snapshot, stable_hash


def register_language_routes(app, settings):
    prefix = "/api/v1"

    @app.post(prefix + "/patients/{patient_id}/guidance", status_code=202)
    def generate(patient_id: str, body: GenerationCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        p, replay = patient_or_404(db, patient_id), require_replay(db, body.session_id)
        return job_out(db, queue_job(db, settings, p, replay, actor=user, retry=body.retry))

    @app.get(prefix + "/patients/{patient_id}/guidance")
    def retrieve(patient_id: str, user=Depends(clinician), db=Depends(get_db)):
        return guidance_view(db, patient_or_404(db, patient_id), active_replay(db))

    @app.get(prefix + "/language/jobs/{job_id}")
    def retrieve_job(job_id: str, user=Depends(clinician), db=Depends(get_db)):
        replay, job = active_replay(db), db.get(LanguageJob, job_id)
        if not job or job.replay_id != replay.id or job.hour > replay.hour or (job.operation == "question" and job.actor_id != user.id):
            raise HTTPException(404, "Generation not available in this timeline")
        return job_out(db, job)

    @app.post(prefix + "/guidance/{job_id}/actions/{action_id}")
    def action(job_id: str, action_id: str, body: SuggestedActionCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        replay, job = require_replay(db, body.session_id), db.get(LanguageJob, job_id)
        if not job or job.operation != "guidance" or job.status != "ok" or job.replay_id != replay.id or job.hour > replay.hour:
            raise HTTPException(404, "Guidance unavailable")
        if action_id not in CATALOGUE or action_id not in {a["action_id"] for a in job.result.get("actions", [])}:
            raise HTTPException(404, "Suggestion not found")
        item = db.scalar(select(SuggestedAction).where(SuggestedAction.job_id == job.id, SuggestedAction.action_key == action_id))
        if item and db.scalar(select(CareEvent.id).where(CareEvent.replay_id == replay.id, CareEvent.hour > replay.hour, CareEvent.data["generation_id"].as_string() == job.id, CareEvent.data["action_key"].as_string() == action_id).limit(1)):
            raise HTTPException(409, "This action has a later timeline update. Return to that hour before changing it.")
        if item and item.status == body.status:
            return {"status": item.status}
        if body.status == "accepted":
            if item:
                raise HTTPException(409, "Suggestion has already been reviewed")
            p = patient_or_404(db, job.patient_id)
            if job.snapshot_hash != stable_hash(snapshot(db, p, replay).model_dump()):
                raise HTTPException(409, "Refresh earlier guidance before accepting a new action")
            # Do not duplicate the same planned task across regenerated guidance.
            earlier = db.scalar(select(SuggestedAction).join(LanguageJob).where(LanguageJob.replay_id == replay.id, LanguageJob.patient_id == p.id, SuggestedAction.action_key == action_id, SuggestedAction.status == "accepted"))
            if earlier:
                raise HTTPException(409, "This action is already planned; complete its existing timeline item")
        elif body.status == "completed":
            if not item or item.status != "accepted":
                raise HTTPException(409, "Only a previously accepted action can be completed")
        elif item:
            raise HTTPException(409, "Suggestion has already been reviewed")
        if not item:
            item = SuggestedAction(job_id=job.id, action_key=action_id, actor_id=user.id, status=body.status)
            db.add(item)
        item.status, item.actor_id, item.updated = body.status, user.id, time.time()
        label = {"accepted": "Planned", "dismissed": "Dismissed", "completed": "Completed"}[body.status]
        transition = event(db, user, job.patient_id, replay, "Suggested action", f"{label}: {CATALOGUE[action_id]}", {"generation_id": job.id, "action_key": action_id, "status": body.status})
        transition.id = stable_hash(["suggested-action", job.id, action_id, body.status])
        db.commit()
        return {"status": item.status}
