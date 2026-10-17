import asyncio
from contextlib import asynccontextmanager, suppress
import hashlib
import logging
from pathlib import Path
import secrets
import time

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError

from .config import Settings
from .database import database, migrate
from .models import Alert, Assignment, AuthSession, CareEvent, FamilyUpdate, Handover, LoginAttempt, Message, Patient, Reading, Replay, User, identifier, LanguageJob
from .language import enqueue_alert_guidance, GeminiLanguage, approve_bundled_demo_sources, language_worker, queue_job, job_out, handover_draft_text, references as demo_references
from .language_routes import register_language_routes
from .providers import DisconnectedLanguage, ExampleLanguage, build_prompt, validate_language_result
from .schemas import AlertCommand, ApprovedUpdate, Command, FAMILY_COLUMNS, FamilyPatient, FamilyReading, FamilyView, FocusCommand, HandoverEdit, LanguageRequest, Login, PlaybackCommand, PriorityCommand, ProfileEdit, TextCommand, UserOut, HandoverCommand
from .security import COOKIE, clinician, current_user, digest, get_db, public_user, writing_clinician, writing_user
from .seed import parse_recording, passwords, seed, seed_alerts
from .services import active_replay, alerts_for, event, event_out, events_for, handover_out, latest_values, max_hour, patient_or_404, patient_out, prediction, prediction_request, replay_out, require_replay, rows_for, structured_handover, tick, update_out, workspace, score_through, integration_status

log = logging.getLogger(__name__)
PREFIX = "/api/v1"
DUMMY_HASH = passwords.hash(secrets.token_urlsafe(18))


def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    engine, sessions = database(settings.database_url)
    clock_lock = asyncio.Lock()

    async def clock():
        while True:
            await asyncio.sleep(.5)
            async with clock_lock:
                try:
                    with sessions() as db:
                        before = active_replay(db)
                        old_hour, was_playing = before.hour, before.playing
                        # Only the clock's newly raised alerts can trigger generation, not seeks/backfill.
                        known_alerts = set(db.scalars(select(Alert.id).where(Alert.replay_id == before.id)))
                        tick(db)
                        replay = active_replay(db)
                        score_through(db, replay)
                        enqueue_alert_guidance(db, settings, replay, old_hour, was_playing, known_alerts)
                except Exception:
                    log.exception("Replay scoring tick failed; retrying on the next tick")

    @asynccontextmanager
    async def lifespan(app):
        migrate(engine)
        if settings.prediction_provider == "lightgbm":
            from .inference import LightGBMPrediction
            provider = LightGBMPrediction(settings.model_path, settings.thresholds_path, settings.alert_policy)
        elif settings.prediction_provider == "disconnected":
            provider = None
        else:
            raise ValueError("PREDICTION_PROVIDER must be lightgbm or disconnected")
        language = GeminiLanguage(settings)
        app.state.language = language
        sessions.configure(info={"prediction_provider": provider, "language_provider": language})
        with sessions() as db:
            if settings.seed_demo:
                seed(db, settings)
            else:
                for replay in db.scalars(select(Replay).where(Replay.active.is_(True))):
                    replay.playing = False
                db.commit()
            if provider:
                for replay in db.scalars(select(Replay).where(Replay.active.is_(True))):
                    replay.example_mode = False
                    db.commit()
                    score_through(db, replay)
            approve_bundled_demo_sources(db)
            # Never silently resend jobs that were in flight when the process stopped.
            for job in db.scalars(select(LanguageJob).where(LanguageJob.status == "running")):
                job.status, job.error = "unavailable", "Generation interrupted by restart. Retry explicitly."
            db.commit()
        language_task = asyncio.create_task(language_worker(sessions, language)) if settings.start_clock else None
        task = asyncio.create_task(clock()) if settings.start_clock else None
        yield
        if language_task:
            language_task.cancel()
            with suppress(asyncio.CancelledError):
                await language_task
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        with sessions() as db:
            for replay in db.scalars(select(Replay).where(Replay.active.is_(True))):
                replay.playing = False
            db.commit()
        engine.dispose()

    app = FastAPI(title="VitalWatch API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.sessions = sessions
    app.state.engine = engine
    app.state.clock_lock = clock_lock
    app.state.settings = settings
    register_language_routes(app, settings)

    @app.middleware("http")
    async def browser_boundaries(request: Request, call_next):
        if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and origin not in settings.allowed_origins:
                return JSONResponse({"detail": "Untrusted request origin"}, status_code=403)
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, exc):
        return JSONResponse({"detail": "The record conflicts with an existing record. Refresh and retry."}, status_code=409)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "VitalWatch", "version": "1.0.0"}

    @app.get("/api/ready")
    def ready(db=Depends(get_db)):
        db.execute(text("SELECT 1"))
        return {"status": "ready"}

    @app.post(PREFIX + "/auth/login")
    def login(body: Login, request: Request, response: Response, db=Depends(get_db)):
        email = body.email.strip().lower()
        ip = request.client.host if request.client else "local"
        key = digest(ip + ":" + email)
        now = time.time()
        count = db.scalar(select(func.count()).select_from(LoginAttempt).where(LoginAttempt.key == key, LoginAttempt.created > now - 300))
        if count >= 10:
            raise HTTPException(429, "Too many sign-in attempts. Try again in five minutes.")
        user = db.scalar(select(User).where(User.email == email))
        valid = passwords.verify(body.password, user.password_hash if user else DUMMY_HASH)
        if not user or not valid:
            db.add(LoginAttempt(key=key))
            db.commit()
            raise HTTPException(401, "Email or password is incorrect")
        db.execute(delete(LoginAttempt).where(LoginAttempt.key == key))
        previous = request.cookies.get(COOKIE)
        if previous:
            db.execute(delete(AuthSession).where(AuthSession.token_hash == digest(previous)))
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        db.add(AuthSession(token_hash=digest(token), csrf=csrf, user_id=user.id, expires=now + settings.session_hours * 3600))
        db.commit()
        response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=settings.session_hours * 3600, path="/")
        return {"user": public_user(user), "csrf_token": csrf}

    @app.get(PREFIX + "/auth/me")
    def me(request: Request, user=Depends(current_user)):
        return {"user": public_user(user), "csrf_token": request.state.auth.csrf}

    @app.post(PREFIX + "/auth/logout", status_code=204)
    def logout(request: Request, response: Response, user=Depends(writing_user), db=Depends(get_db)):
        db.delete(request.state.auth)
        db.commit()
        response.delete_cookie(COOKIE, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")

    @app.get(PREFIX + "/workspace")
    def get_workspace(user=Depends(clinician), db=Depends(get_db)):
        return workspace(db, active_replay(db), user)

    @app.get(PREFIX + "/patients")
    def list_patients(q: str = Query(default="", max_length=200), offset: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=100), user=Depends(clinician), db=Depends(get_db)):
        replay = active_replay(db)
        condition = (Patient.name.contains(q, autoescape=True) | Patient.id.contains(q, autoescape=True) | Patient.bed.contains(q, autoescape=True))
        items = db.scalars(select(Patient).where(condition).order_by(Patient.bed).offset(offset).limit(limit))
        return {"items": [patient_out(db, p, replay) for p in items], "total": db.scalar(select(func.count()).select_from(Patient).where(condition)), "offset": offset, "limit": limit}

    @app.post(PREFIX + "/patients/import", status_code=201)
    def import_patient(file: UploadFile = File(...), user=Depends(writing_clinician), db=Depends(get_db)):
        if not file.filename or not file.filename.lower().endswith(".psv"):
            raise HTTPException(422, "Choose a .psv patient recording")
        content = file.file.read(5 * 1024 * 1024 + 1)
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(413, "One PSV file must be smaller than 5 MB")
        try:
            rows = parse_recording(content)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        file_hash = hashlib.sha256(content).hexdigest()
        if db.scalar(select(Patient).where(Patient.source_hash == file_hash)):
            raise HTTPException(409, "This recording is already in the workspace")
        number = (db.scalar(select(func.count()).select_from(Patient)) or 0) + 1
        row = rows[0]
        p = Patient(id="import-" + identifier(), name=f"Imported patient {number}", age=row.get("Age"), sex="Not specified", bed=str(number).zfill(2), source="recorded", provenance="Clinician-imported PhysioNet-format recording; identity not supplied", source_hash=file_hash, conditions=[], medications=[])
        db.add(p)
        db.flush()
        db.add_all([Reading(patient_id=p.id, hour=r["ICULOS"], values=r) for r in rows])
        db.commit()
        score_through(db, active_replay(db), p.id)
        return {"patient_id": p.id, "records": len(rows)}

    @app.get(PREFIX + "/patients/{patient_id}")
    def get_patient(patient_id: str, user=Depends(clinician), db=Depends(get_db)):
        return patient_out(db, patient_or_404(db, patient_id), active_replay(db))

    @app.patch(PREFIX + "/patients/{patient_id}")
    def edit_patient(patient_id: str, body: ProfileEdit, user=Depends(writing_clinician), db=Depends(get_db)):
        p = patient_or_404(db, patient_id)
        if not body.name.strip():
            raise HTTPException(422, "Patient name must not be blank")
        p.name, p.conditions, p.medications = body.name.strip(), body.conditions, body.medications
        p.ai_context_approved = False
        event(db, user, p.id, active_replay(db), "Profile updated", "Clinical profile updated by a clinician.")
        db.commit()
        return patient_out(db, p, active_replay(db))

    @app.get(PREFIX + "/patients/{patient_id}/history")
    def patient_history(patient_id: str, since: int = Query(default=0, ge=0), until: int | None = Query(default=None, ge=1), offset: int = Query(default=0, ge=0), limit: int = Query(default=1000, ge=1, le=20000), user=Depends(clinician), db=Depends(get_db)):
        patient_or_404(db, patient_id)
        replay = active_replay(db)
        cutoff = min(replay.hour, until) if until else replay.hour
        rows = rows_for(db, patient_id, cutoff, since)
        return {"patient_id": patient_id, "as_of_hour": cutoff, "items": rows[offset:offset + limit], "total": len(rows), "offset": offset, "limit": limit, "latest": latest_values(rows)}

    @app.get(PREFIX + "/patients/{patient_id}/comparisons")
    def patient_comparisons(patient_id: str, user=Depends(clinician), db=Depends(get_db)):
        patient_or_404(db, patient_id)
        replay = active_replay(db)
        rows = rows_for(db, patient_id, replay.hour, replay.hour - 12)
        current, previous = [r for r in rows if r["ICULOS"] > replay.hour - 6], [r for r in rows if r["ICULOS"] <= replay.hour - 6]
        results = {}
        for key in (k for k in rows[0] if k not in ("ICULOS", "Age", "Gender", "Unit1", "Unit2", "HospAdmTime")) if rows else []:
            a = [r[key] for r in previous if r.get(key) is not None]
            b = [r[key] for r in current if r.get(key) is not None]
            first, second = sum(a) / len(a) if a else None, sum(b) / len(b) if b else None
            results[key] = {"previous_mean": first, "current_mean": second, "previous_count": len(a), "current_count": len(b), "difference": second - first if first is not None and second is not None else None}
        return {"patient_id": patient_id, "as_of_hour": replay.hour, "measurements": results}

    @app.get(PREFIX + "/patients/{patient_id}/evidence")
    def evidence(patient_id: str, user=Depends(clinician), db=Depends(get_db)):
        p, replay = patient_or_404(db, patient_id), active_replay(db)
        rows = rows_for(db, p.id, replay.hour)
        return {"patient_id": p.id, "as_of_hour": replay.hour, "latest": latest_values(rows), "provenance": p.provenance, "prediction": prediction(db, p.id, replay, rows), "references": [], "reference_status": "not_configured"}

    @app.patch(PREFIX + "/replay")
    def patch_playback(body: PlaybackCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        replay = require_replay(db, body.session_id)
        if body.hour is not None and body.hour > max_hour(db):
            raise HTTPException(422, "Requested hour exceeds the available recording")
        if body.example_mode is True and db.info.get("prediction_provider"):
            raise HTTPException(422, "The trained model is configured; example prediction outputs cannot replace model results.")
        fields = body.model_dump(exclude_none=True, exclude={"session_id", "revision"})
        fields.update(revision=Replay.revision + 1, tick_at=time.time())
        result = db.execute(update(Replay).where(Replay.id == replay.id, Replay.revision == body.revision).values(**fields))
        if result.rowcount != 1:
            raise HTTPException(409, "Playback was changed by another clinician. Refresh and retry.")
        db.commit()
        db.refresh(replay)
        score_through(db, replay)
        return replay_out(db, replay)

    @app.post(PREFIX + "/replay/restart", status_code=201)
    def restart_playback(body: Command, user=Depends(writing_clinician), db=Depends(get_db)):
        old = require_replay(db, body.session_id)
        old.active, old.playing = False, False
        replay = Replay(hour=1, speed=old.speed, example_mode=old.example_mode)
        db.add(replay)
        db.flush()
        seed_alerts(db, replay)
        db.commit()
        score_through(db, replay)
        return replay_out(db, replay)

    @app.get(PREFIX + "/replays")
    def replays(user=Depends(clinician), db=Depends(get_db)):
        return [{"id": r.id, "hour": r.hour, "active": r.active} for r in db.scalars(select(Replay).order_by(Replay.id))]

    @app.get(PREFIX + "/replays/{replay_id}/events")
    def archived_events(replay_id: str, user=Depends(clinician), db=Depends(get_db)):
        replay = db.get(Replay, replay_id)
        if not replay:
            raise HTTPException(404, "Replay not found")
        query = select(CareEvent).where(CareEvent.replay_id == replay_id).order_by(CareEvent.created.desc())
        return [event_out(db, e) for e in db.scalars(query)]

    @app.post(PREFIX + "/patients/{patient_id}/notes", status_code=201)
    def add_note(patient_id: str, body: TextCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        patient_or_404(db, patient_id)
        item = event(db, user, patient_id, require_replay(db, body.session_id), "Care note", body.text, {"demo_content_confirmed": body.demo_content_confirmed})
        db.commit()
        return event_out(db, item)

    @app.put(PREFIX + "/patients/{patient_id}/focus")
    def set_focus(patient_id: str, body: FocusCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        patient_or_404(db, patient_id)
        focus = body.focus.strip()
        if not focus:
            raise HTTPException(422, "Focus must not be blank")
        item = event(db, user, patient_id, require_replay(db, body.session_id), "Focus updated", f"Clinician selected: {focus}.", {"focus": focus})
        db.commit()
        return event_out(db, item)

    @app.put(PREFIX + "/patients/{patient_id}/priority")
    def set_priority(patient_id: str, body: PriorityCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        patient_or_404(db, patient_id)
        if not body.reason.strip():
            raise HTTPException(422, "A reason is required")
        item = event(db, user, patient_id, require_replay(db, body.session_id), "Priority override", f"{body.priority or 'Override removed'}: {body.reason.strip()}", {"priority": body.priority})
        db.commit()
        return event_out(db, item)

    @app.patch(PREFIX + "/alerts/{alert_id}")
    def transition_alert(alert_id: str, body: AlertCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        replay = require_replay(db, body.session_id)
        alert = next((a for a in alerts_for(db, replay) if a["id"] == alert_id), None)
        if not alert:
            raise HTTPException(404, "Alert is not available in the current timeline")
        if alert["status"] != body.status:
            event(db, user, alert["patientId"], replay, "Alert update", f"{alert['title']}: {body.status.lower()}.", {"alert_id": alert_id, "status": body.status})
            db.commit()
        return {**alert, "status": body.status}

    @app.post(PREFIX + "/patients/{patient_id}/handovers", status_code=201)
    def generate_handover(patient_id: str, body: HandoverCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        p, replay = patient_or_404(db, patient_id), require_replay(db, body.session_id)
        if body.mode == "gemini":
            job = queue_job(db, settings, p, replay, operation="handover", actor=user, retry=True)
            if job.status == "ok":
                db.add(Handover(patient_id=p.id, replay_id=replay.id, actor_id=user.id, hour=job.hour, origin="gemini", generation_id=job.id, text=handover_draft_text(job.result["text"])))
                db.commit()
            return job_out(db, job)
        h = Handover(patient_id=p.id, replay_id=replay.id, actor_id=user.id, hour=replay.hour, text=structured_handover(db, p, replay))
        db.add(h)
        db.commit()
        return handover_out(h)

    @app.patch(PREFIX + "/handovers/{handover_id}")
    def edit_handover(handover_id: str, body: HandoverEdit, user=Depends(writing_clinician), db=Depends(get_db)):
        replay = require_replay(db, body.session_id)
        h = db.get(Handover, handover_id)
        if not h or h.replay_id != replay.id or h.hour > replay.hour:
            raise HTTPException(404, "Handover unavailable in the current timeline")
        result = db.execute(update(Handover).where(Handover.id == h.id, Handover.revision == body.revision).values(text=body.text, revision=Handover.revision + 1, actor_id=user.id))
        if result.rowcount != 1:
            raise HTTPException(409, "Another clinician changed this draft. Keep your edits or reload the saved version.")
        db.commit()
        db.refresh(h)
        return handover_out(h)

    @app.get(PREFIX + "/handovers/{handover_id}/export", response_class=PlainTextResponse)
    def export_handover(handover_id: str, user=Depends(clinician), db=Depends(get_db)):
        h, replay = db.get(Handover, handover_id), active_replay(db)
        if not h or h.replay_id != replay.id or h.hour > replay.hour:
            raise HTTPException(404, "Handover unavailable in the current timeline")
        return PlainTextResponse(h.text, headers={"Content-Disposition": f'attachment; filename="handover-{h.id}.txt"'})

    @app.post(PREFIX + "/patients/{patient_id}/updates", status_code=201)
    def approve_update(patient_id: str, body: TextCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        patient_or_404(db, patient_id)
        replay = require_replay(db, body.session_id)
        item = FamilyUpdate(patient_id=patient_id, replay_id=replay.id, actor_id=user.id, hour=replay.hour, text=body.text)
        db.add(item)
        event(db, user, patient_id, replay, "Family update", "A reviewed update was approved for family viewing.")
        db.commit()
        return update_out(db, item)

    @app.post(PREFIX + "/updates/{update_id}/withdraw")
    def withdraw_update(update_id: str, body: Command, user=Depends(writing_clinician), db=Depends(get_db)):
        replay = require_replay(db, body.session_id)
        item = db.get(FamilyUpdate, update_id)
        if not item or item.replay_id != replay.id:
            raise HTTPException(404, "Update not found")
        if item.withdrawn_at is None:
            item.withdrawn_at = time.time()
            event(db, user, item.patient_id, replay, "Family update", "A shared family update was withdrawn.")
        db.commit()
        return {"status": "withdrawn"}

    @app.post(PREFIX + "/patients/{patient_id}/messages", status_code=201)
    def send_message(patient_id: str, body: TextCommand, user=Depends(writing_clinician), db=Depends(get_db)):
        p, replay = patient_or_404(db, patient_id), require_replay(db, body.session_id)
        if settings.language_provider == "gemini":
            return job_out(db, queue_job(db, settings, p, replay, operation="question", actor=user, question=body.text, confirmed=body.demo_content_confirmed, retry=True))
        context = LanguageRequest(operation="question", patient_id=p.id, as_of_hour=replay.hour)
        result = DisconnectedLanguage().respond(context)
        for role, message in [("user", body.text), ("system", result.text)]:
            db.add(Message(user_id=user.id, patient_id=p.id, replay_id=replay.id, hour=replay.hour, role=role, text=message))
        db.commit()
        return result

    @app.post(PREFIX + "/patients/{patient_id}/messages/example", status_code=201)
    def example_conversation(patient_id: str, body: Command, user=Depends(writing_clinician), db=Depends(get_db)):
        patient_or_404(db, patient_id)
        replay = require_replay(db, body.session_id)
        result = ExampleLanguage().respond(LanguageRequest(operation="question", patient_id=patient_id, as_of_hour=replay.hour))
        db.add(Message(user_id=user.id, patient_id=patient_id, replay_id=replay.id, hour=replay.hour, role="system", text=result.text, origin="example"))
        db.commit()
        return result

    @app.get(PREFIX + "/integrations/status")
    def integrations(user=Depends(clinician), db=Depends(get_db)):
        return integration_status(db)

    @app.get(PREFIX + "/integrations/references")
    def references(user=Depends(clinician)):
        refs = demo_references()
        return {"status": "demo_library" if refs else "not_configured", "references": [r.model_dump() for r in refs]}

    def allowed_family_ids(db, user):
        return list(db.scalars(select(Assignment.patient_id).where(Assignment.user_id == user.id)))

    def family_patient(db, p, replay):
        readings = [FamilyReading(ICULOS=r["ICULOS"], **{key: r.get(key) for key in FAMILY_COLUMNS}) for r in rows_for(db, p.id, replay.hour)]
        updates = [ApprovedUpdate(id=u.id, text=u.text, hour=u.hour, approvedBy=db.get(User, u.actor_id).name) for u in db.scalars(select(FamilyUpdate).where(FamilyUpdate.patient_id == p.id, FamilyUpdate.replay_id == replay.id, FamilyUpdate.hour <= replay.hour, FamilyUpdate.withdrawn_at.is_(None)).order_by(FamilyUpdate.approved_at.desc()))]
        return FamilyPatient(id=p.id, name=p.name, initials="".join(w[0] for w in p.name.split()[:2]), bed=p.bed, source=p.source, readings=readings, updates=updates)

    @app.get(PREFIX + "/patients/{patient_id}/family-view", response_model=FamilyPatient)
    def clinical_family_preview(patient_id: str, user=Depends(clinician), db=Depends(get_db)):
        return family_patient(db, patient_or_404(db, patient_id), active_replay(db))

    @app.get(PREFIX + "/family", response_model=FamilyView)
    def family_workspace(user=Depends(current_user), db=Depends(get_db)):
        ids = allowed_family_ids(db, user)
        replay = active_replay(db)
        return FamilyView(user=UserOut(**public_user(user)), session_id=replay.id, hour=replay.hour, patients=[family_patient(db, p, replay) for p in db.scalars(select(Patient).where(Patient.id.in_(ids)).order_by(Patient.bed))])

    @app.get(PREFIX + "/family/patients/{patient_id}", response_model=FamilyPatient)
    def family_patient_detail(patient_id: str, user=Depends(current_user), db=Depends(get_db)):
        if patient_id not in allowed_family_ids(db, user):
            raise HTTPException(404, "Patient not found")
        return family_patient(db, patient_or_404(db, patient_id), active_replay(db))

    # Runtime records never live in the public frontend directory.
    @app.get("/data/{path:path}")
    def block_legacy_recordings(path: str):
        raise HTTPException(404, "Recordings are available only through authorized APIs")

    assets = settings.frontend_dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon():
        return FileResponse(settings.frontend_dist / "favicon.svg")

    @app.get("/", include_in_schema=False)
    def index():
        path = settings.frontend_dist / "index.html"
        if not path.is_file():
            return JSONResponse({"service": "VitalWatch API", "frontend": "Run the Vite frontend on port 5173, or build it to serve here."})
        return FileResponse(path)

    return app


app = create_app()
