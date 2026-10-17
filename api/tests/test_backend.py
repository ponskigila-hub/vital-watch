import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select

from api.app.config import ROOT, Settings
from api.app.main import create_app
from api.app.models import AuthSession, Replay
from api.app.providers import DisconnectedLanguage, DisconnectedPrediction, ExamplePrediction, build_prompt, validate_language_result
from api.app.schemas import LanguageRequest, LanguageResult, ObservationReference, PredictionRequest, ReferencePassage
from api.app.security import COOKIE
from api.app.services import tick


def login(client, role="clinician"):
    response = client.post("/api/v1/auth/login", json={"email": f"{role}@vitalwatch.local", "password": f"test-{role}-password"})
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["csrf_token"]}


@pytest.fixture
def app_case(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}", credentials_path=tmp_path / "credentials.json", clinician_password="test-clinician-password", family_password="test-family-password", start_clock=False, prediction_provider="disconnected", seed_held_out=False)
    app = create_app(settings)
    with TestClient(app) as client:
        yield app, client, settings


def workspace(client):
    response = client.get("/api/v1/workspace")
    assert response.status_code == 200, response.text
    return response.json()


def command(client, headers, path, data=None, method="POST"):
    body = {"session_id": workspace(client)["replay"]["id"], **(data or {})}
    return client.request(method, "/api/v1" + path, headers=headers, json=body)


def seek(client, headers, hour):
    replay = workspace(client)["replay"]
    response = client.patch("/api/v1/replay", headers=headers, json={"session_id": replay["id"], "revision": replay["revision"], "hour": hour, "playing": False})
    assert response.status_code == 200, response.text
    return response.json()


def test_authentication_csrf_origins_and_logout(app_case):
    _, client, _ = app_case
    assert client.get("/api/v1/workspace").status_code == 401
    assert client.get("/api/health").status_code == 200
    assert client.get("/data/p000001.psv").status_code == 404
    assert client.post("/api/v1/auth/login", headers={"Origin": "https://untrusted.example"}, json={"email": "clinician@vitalwatch.local", "password": "test-clinician-password"}).status_code == 403
    headers = login(client)
    me = client.get("/api/v1/auth/me").json()
    assert me["user"]["role"] == "clinician"
    replay = workspace(client)["replay"]
    payload = {"session_id": replay["id"], "revision": replay["revision"], "hour": 10}
    assert client.patch("/api/v1/replay", json=payload).status_code == 403
    assert client.patch("/api/v1/replay", headers={**headers, "Origin": "https://untrusted.example"}, json=payload).status_code == 403
    cookie = client.cookies.get(COOKIE)
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    client.cookies.set(COOKIE, cookie)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_expired_sessions_and_login_throttling(app_case):
    app, client, _ = app_case
    login(client)
    with app.state.sessions() as db:
        for session in db.scalars(select(AuthSession)):
            session.expires = 0
        db.commit()
    assert client.get("/api/v1/auth/me").status_code == 401
    for _ in range(10):
        assert client.post("/api/v1/auth/login", json={"email": "unknown@vitalwatch.local", "password": "wrong"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "unknown@vitalwatch.local", "password": "wrong"}).status_code == 429


def test_family_allowlist_and_clinical_endpoint_denial(app_case):
    _, client, _ = app_case
    headers = login(client, "family")
    response = client.get("/api/v1/family")
    assert response.status_code == 200
    view = response.json()
    assert len(view["patients"]) == 1
    patient = view["patients"][0]
    assert patient["id"] == "p000001"
    assert set(patient) == {"id", "name", "initials", "bed", "source", "readings", "updates"}
    assert all(set(r) == {"ICULOS", "HR", "O2Sat", "SBP"} for r in patient["readings"])
    assert all(r["ICULOS"] <= view["hour"] for r in patient["readings"])
    for route in ["/workspace", "/patients", "/patients/p000001", "/patients/p000001/history", "/patients/p000001/comparisons", "/patients/p000001/evidence", "/integrations/status", "/integrations/references", "/replays", "/patients/p000001/family-view"]:
        assert client.get("/api/v1" + route).status_code == 403, route
    assert client.get("/api/v1/family/patients/demo002").status_code == 404
    assert client.get("/api/v1/family/patients/p000001").status_code == 200
    for route, data in [("/patients/p000001/notes", {"text": "Not permitted"}), ("/patients/p000001/updates", {"text": "Not permitted"}), ("/replay/restart", {})]:
        assert client.post("/api/v1" + route, headers=headers, json={"session_id": view["session_id"], **data}).status_code == 403
    assert client.get("/api/v1/handovers/anything/export").status_code == 403


def test_clinical_history_comparisons_and_missing_values(app_case):
    _, client, _ = app_case
    login(client)
    data = workspace(client)
    assert len(data["patients"]) == 6
    p = next(p for p in data["patients"] if p["id"] == "p000001")
    assert len(p["readings"]) == 34
    assert all("SepsisLabel" not in r for r in p["readings"])
    assert all(r["DBP"] is None for r in p["readings"])
    response = client.get("/api/v1/patients/p000001/history?until=999&since=22").json()
    assert response["as_of_hour"] == 34
    assert len(response["items"]) == 12
    assert response["latest"]["Temp"]["hour"] == 32
    comparisons = client.get("/api/v1/patients/p000001/comparisons").json()["measurements"]
    assert len(comparisons) == 34
    assert comparisons["HR"]["difference"] == pytest.approx(4.166666666666671)
    assert comparisons["WBC"]["current_mean"] is None
    assert comparisons["DBP"]["difference"] is None
    assert "SepsisLabel" not in json.dumps(client.get("/api/v1/patients/p000001/evidence").json())
    assert client.get("/api/v1/patients?q=Eleanor").json()["total"] == 1


def test_atomic_imports_duplicate_detection_and_size_limit(app_case):
    _, client, _ = app_case
    headers = login(client)
    content = (ROOT / "demo/p000001.psv").read_bytes()
    assert client.post("/api/v1/patients/import", headers=headers, files={"file": ("same.psv", content)}).status_code == 409
    assert client.post("/api/v1/patients/import", headers=headers, files={"file": ("bad.psv", b"HR|ICULOS\n80|1")} ).status_code == 422
    assert client.post("/api/v1/patients/import", headers=headers, files={"file": ("large.psv", b"x" * (5 * 1024 * 1024 + 1))}).status_code == 413
    assert workspace(client)["patient_count"] == 6
    result = client.post("/api/v1/patients/import", headers=headers, files={"file": ("new.psv", content.replace(b"83.14", b"82.14"))})
    assert result.status_code == 201, result.text
    patient = client.get("/api/v1/patients/" + result.json()["patient_id"]).json()
    assert patient["score"] is None and patient["band"] is None
    assert len(patient["readings"]) == 34
    assert workspace(client)["patient_count"] == 7


def test_future_events_hidden_and_replay_archival(app_case):
    _, client, _ = app_case
    headers = login(client)
    old = workspace(client)["replay"]["id"]
    assert command(client, headers, "/patients/p000001/notes", {"text": "Reviewed the previous six hours."}).status_code == 201
    assert command(client, headers, "/patients/p000001/focus", {"focus": "Respiratory monitoring"}, "PUT").status_code == 200
    assert command(client, headers, "/patients/p000001/priority", {"priority": "Urgent", "reason": "Clinician review requested"}, "PUT").status_code == 200
    alert_id = workspace(client)["alerts"][0]["id"]
    assert command(client, headers, f"/alerts/{alert_id}", {"status": "Acknowledged"}, "PATCH").status_code == 200
    count = len(workspace(client)["care"]["events"])
    assert command(client, headers, f"/alerts/{alert_id}", {"status": "Acknowledged"}, "PATCH").status_code == 200
    assert len(workspace(client)["care"]["events"]) == count
    seek(client, headers, 28)
    before = workspace(client)
    assert before["care"]["events"] == []
    assert before["care"]["priorities"] == {}
    assert before["care"]["focuses"] == {}
    assert next(a for a in before["alerts"] if a["id"] == alert_id)["status"] == "Open"
    seek(client, headers, 34)
    assert workspace(client)["care"]["priorities"]["p000001"] == "Urgent"
    new = command(client, headers, "/replay/restart")
    assert new.status_code == 201
    assert new.json()["id"] != old and new.json()["hour"] == 1
    assert workspace(client)["care"]["events"] == []
    assert len(client.get(f"/api/v1/replays/{old}/events").json()) == count
    assert client.post("/api/v1/patients/p000001/notes", headers=headers, json={"session_id": old, "text": "Stale action"}).status_code == 409


def test_playback_revision_control_and_server_clock(app_case):
    app, client, _ = app_case
    headers = login(client)
    r = workspace(client)["replay"]
    body = {"session_id": r["id"], "revision": r["revision"], "playing": True, "speed": 1}
    assert client.patch("/api/v1/replay", headers=headers, json=body).status_code == 200
    assert client.patch("/api/v1/replay", headers=headers, json=body).status_code == 409
    with app.state.sessions() as db:
        replay = db.get(Replay, r["id"])
        tick(db, replay.tick_at + 3.1)
    assert workspace(client)["replay"]["hour"] == 37
    assert command(client, headers, "/patients/p000001/notes", {"text": "note", "actor_id": "forged"}).status_code == 422
    assert client.patch("/api/v1/replay", headers=headers, json={"session_id": r["id"], "revision": workspace(client)["replay"]["revision"], "hour": 9999}).status_code == 422


def test_family_approval_cutoff_and_withdrawal(app_case):
    app, client, _ = app_case
    headers = login(client)
    family = TestClient(app)
    login(family, "family")
    assert family.get("/api/v1/family").json()["patients"][0]["updates"] == []
    result = command(client, headers, "/patients/p000001/updates", {"text": "A reviewed demonstration update."})
    assert result.status_code == 201
    update_id = result.json()["id"]
    assert len(family.get("/api/v1/family").json()["patients"][0]["updates"]) == 1
    seek(client, headers, 10)
    assert family.get("/api/v1/family").json()["patients"][0]["updates"] == []
    seek(client, headers, 34)
    assert command(client, headers, f"/updates/{update_id}/withdraw").status_code == 200
    seek(client, headers, 10)
    seek(client, headers, 34)
    assert family.get("/api/v1/family").json()["patients"][0]["updates"] == []
    family.close()


def test_handover_snapshots_edit_conflicts_and_export(app_case):
    _, client, _ = app_case
    headers = login(client)
    assert command(client, headers, "/patients/p000001/notes", {"text": "A saved observation"}).status_code == 201
    h = command(client, headers, "/patients/p000001/handovers").json()
    assert h["origin"] == "structured_template"
    assert "A saved observation" in h["text"]
    assert "hour 32" in h["text"]
    assert "no language model was used" in h["text"]
    response = command(client, headers, f"/handovers/{h['id']}", {"text": "Reviewed draft", "revision": 1}, "PATCH")
    assert response.status_code == 200 and response.json()["revision"] == 2
    assert command(client, headers, f"/handovers/{h['id']}", {"text": "Stale overwrite", "revision": 1}, "PATCH").status_code == 409
    assert client.get(f"/api/v1/handovers/{h['id']}/export").text == "Reviewed draft"
    seek(client, headers, 10)
    assert client.get(f"/api/v1/handovers/{h['id']}/export").status_code == 404
    assert workspace(client)["care"]["drafts"] == {}


def test_disconnected_and_example_modes_never_return_live_answers(app_case, monkeypatch):
    import socket
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: pytest.fail("Unexpected external connection"))
    _, client, _ = app_case
    headers = login(client)
    assert workspace(client)["patients"][0]["prediction"]["origin"] == "example"
    r = workspace(client)["replay"]
    assert client.patch("/api/v1/replay", headers=headers, json={"session_id": r["id"], "revision": r["revision"], "example_mode": False}).status_code == 200
    data = workspace(client)
    assert data["alerts"] == []
    assert all(p["score"] is None and p["band"] is None for p in data["patients"])
    response = command(client, headers, "/patients/p000001/messages", {"text": "What changed?"})
    assert response.status_code == 201 and response.json()["status"] == "disconnected"
    messages = next(iter(workspace(client)["care"]["messages"].values()))
    assert messages[-1]["role"] == "system" and "No AI answer" in messages[-1]["text"]
    assert client.get("/api/v1/integrations/status").json()["external_calls_enabled"] is False
    refs = client.get("/api/v1/integrations/references").json()["references"]
    assert refs and all(r["approved_for_demo"] and not r["reviewed"] for r in refs)


def test_restart_persistence_and_idempotent_seed(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'persist.db'}", credentials_path=tmp_path / "creds.json", clinician_password="test-clinician-password", family_password="test-family-password", start_clock=False, prediction_provider="disconnected", seed_held_out=False)
    with TestClient(create_app(settings)) as first:
        headers = login(first)
        assert command(first, headers, "/patients/p000001/notes", {"text": "Persistent record"}).status_code == 201
        r = workspace(first)["replay"]
        first.patch("/api/v1/replay", headers=headers, json={"session_id": r["id"], "revision": r["revision"], "playing": True})
    original_creds = settings.credentials_path.read_text()
    with TestClient(create_app(settings)) as second:
        login(second)
        data = workspace(second)
        assert len(data["patients"]) == 6
        assert data["replay"]["playing"] is False
        assert any(e["text"] == "Persistent record" for e in data["care"]["events"])
        assert settings.credentials_path.read_text() == original_creds


def test_provider_contracts_reject_labels_future_rows_and_unknown_citations():
    request = PredictionRequest(patient_id="p000001", as_of_hour=2, history=[{"ICULOS": 1, "HR": 80}, {"ICULOS": 2, "HR": None}])
    assert DisconnectedPrediction().score(request).sepsis.score is None
    assert ExamplePrediction().score(request).origin == "example"
    for rows in [[{"ICULOS": 3}], [{"ICULOS": 1, "SepsisLabel": 1}], [{"ICULOS": 2}, {"ICULOS": 1}], [{"ICULOS": 1, "HR": float("inf")}]]:
        with pytest.raises(ValueError):
            PredictionRequest(patient_id="p", as_of_hour=2, history=rows)
    language = LanguageRequest(operation="question", patient_id="p", as_of_hour=2, observations=[{"ICULOS": 1, "HR": 80}], references=[ReferencePassage(id="r1", title="Test", url="https://example.org", passage="Test fixture", provenance="Test", reviewed=True)])
    assert "UNTRUSTED EVIDENCE DATA" in build_prompt(language)
    assert DisconnectedLanguage().respond(language).status == "disconnected"
    with pytest.raises(ValueError):
        validate_language_result(language, LanguageResult(status="ok", text="Bad source", citations=["invented"]))
    with pytest.raises(ValueError):
        validate_language_result(language, LanguageResult(status="ok", text="Bad observation", observation_references=[ObservationReference(measurement="HR", hour=2)]))
    with pytest.raises(ValueError):
        LanguageRequest(operation="focus", patient_id="p", as_of_hour=2, observations=[{"ICULOS": 3}])


def test_concurrent_clinical_writes_share_clock_without_losing_events(app_case):
    from concurrent.futures import ThreadPoolExecutor

    _, client, _ = app_case
    headers = login(client)
    session_id = workspace(client)["replay"]["id"]

    def save_note(number):
        return client.post("/api/v1/patients/p000001/notes", headers=headers, json={"session_id": session_id, "text": f"Concurrent note {number}"})

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(save_note, range(12)))
    assert all(response.status_code == 201 for response in responses), [response.text for response in responses]
    events = workspace(client)["care"]["events"]
    notes = [event for event in events if event["text"].startswith("Concurrent note ")]
    assert len(notes) == 12
    assert len({event["id"] for event in notes}) == 12
    assert {event["hour"] for event in notes} == {34}
