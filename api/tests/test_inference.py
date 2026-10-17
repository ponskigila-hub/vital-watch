"""Real artifact integration and temporal/alert regression tests."""
import json
from pathlib import Path

from fastapi.testclient import TestClient
import numpy as np
import pandas as pd
import pytest
from sqlalchemy import func, select

from api.app.config import ROOT, Settings
from api.app.inference import LightGBMPrediction, feature_observation_hours
from api.app.main import create_app
from api.app.models import Alert, PredictionRun, Replay
from api.app.schemas import PredictionRequest, PredictionResult, SepsisOutput
from api.app.seed import parse_recording
from api.app.services import prediction_request, score_through, tick
from api.tests.test_backend import login, workspace, seek
from src.features import FEATURE_NAMES, build_features, build_features_many


@pytest.fixture(scope="module")
def rows():
    return parse_recording((ROOT / "demo/p000001.psv").read_bytes())


@pytest.fixture(scope="module")
def provider():
    settings = Settings()
    result = LightGBMPrediction(settings.model_path, settings.thresholds_path, settings.alert_policy)
    assert result.ready
    return result


@pytest.fixture
def real_case(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'real.db'}", credentials_path=tmp_path / "credentials.json", clinician_password="test-clinician-password", family_password="test-family-password", prediction_provider="lightgbm", start_clock=False)
    app = create_app(settings)
    with TestClient(app) as client:
        yield app, client, settings


def test_serving_matches_training_and_model_contributions(provider, rows):
    frame = pd.DataFrame(rows).astype(float)
    full = build_features(frame)
    batch_training = build_features_many([frame, frame])
    assert list(full.columns) == provider.booster.feature_name() == FEATURE_NAMES
    np.testing.assert_allclose(full, batch_training.iloc[:len(frame)], rtol=1e-5, atol=1e-4, equal_nan=True)
    batch = provider.score_recording("patient", rows, list(range(1, 55)))
    for hour in range(2, 55, 3):
        request = prediction_request("patient", hour, rows)
        if provider.eligible(request):
            continue
        window_features = build_features(pd.DataFrame(request.history).astype(float)).iloc[[-1]][FEATURE_NAMES]
        np.testing.assert_allclose(window_features.values[0], full.iloc[hour - 1].values, rtol=1e-5, atol=1e-4, equal_nan=True)
        expected = float(provider.booster.predict(window_features.values, num_threads=1)[0])
        single = provider.score(request)
        assert single.sepsis.score == pytest.approx(expected, abs=1e-12)
        assert batch[hour].sepsis.score == pytest.approx(expected, abs=1e-12)
        assert all(h <= hour for factor in single.sepsis.factors for h in factor.observation_hours)
    evidence = prediction_request("patient", 41, rows)
    assert feature_observation_hours("ICULOS", evidence) == [41]
    assert feature_observation_hours("Temp_last", evidence) == [40]
    assert feature_observation_hours("shock_index", evidence) == [40, 41]
    assert all(35 < h <= 41 for h in feature_observation_hours("Resp_mean6", evidence))
    raw = provider.booster.predict(full.iloc[[33]].values, raw_score=True, num_threads=1)[0]
    contributions = provider.booster.predict(full.iloc[[33]].values, pred_contrib=True, num_threads=1)[0]
    assert contributions.sum() == pytest.approx(raw, abs=1e-10)
    mutated = [dict(r) for r in rows]
    for row in mutated[34:]:
        row["HR"] = 250
    assert provider.score_recording("patient", mutated, [34])[34].sepsis.score == batch[34].sepsis.score


def test_no_fabricated_scores_for_missing_gapped_or_invalid_model(provider, rows, tmp_path):
    assert provider.score(PredictionRequest(patient_id="empty", as_of_hour=1, history=[])).sepsis.score is None
    gapped = prediction_request("gap", 10, [r for r in rows if r["ICULOS"] != 8])
    assert provider.score(gapped).status == "insufficient_history"
    stale = prediction_request("ended", 55, rows)
    assert provider.score(stale).sepsis.score is None
    assert "No new observation" in provider.score(stale).data_quality["reason"]
    bad = LightGBMPrediction(tmp_path / "missing.txt", Path("models/thresholds_v1.json"))
    assert not bad.ready
    result = bad.score(prediction_request("p", 34, rows))
    assert result.origin == "model" and result.status == "unavailable"
    assert result.sepsis.score is None and result.sepsis.alert is None
    with pytest.raises(ValueError):
        PredictionRequest(patient_id="bad", as_of_hour=34, history=[{"ICULOS":34, "SepsisLabel":1}])


def test_real_scores_persist_seek_and_do_not_leak_to_family(real_case, provider, rows):
    app, client, _ = real_case
    headers = login(client)
    first = workspace(client)
    assert first["integrations"]["prediction"]["status"] == "connected"
    assert first["replay"]["example_mode"] is False
    patient = next(p for p in first["patients"] if p["id"] == "p000001")
    expected = provider.score(prediction_request("p000001", 34, rows)).sepsis.score
    assert patient["prediction"]["origin"] == "model"
    assert patient["score"] == pytest.approx(expected)
    assert patient["score"] != .82
    draft = client.post('/api/v1/patients/p000001/handovers', headers=headers, json={"session_id":first['replay']['id']}).json()
    assert f"score {expected:.4f}" in draft['text']
    assert "no language model was used" in draft['text']
    assert patient["prediction"]["baseline"]["status"] == "unavailable"
    assert all(item["ICULOS"] <= 34 for item in patient["score_history"])
    with app.state.sessions() as db:
        count = db.scalar(select(func.count()).select_from(PredictionRun))
    workspace(client)
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(PredictionRun)) == count
    seek(client, headers, 41)
    later = next(p for p in workspace(client)["patients"] if p["id"] == "p000001")
    assert later["score"] != patient["score"]
    seek(client, headers, 10)
    earlier = next(p for p in workspace(client)["patients"] if p["id"] == "p000001")
    assert all(item["ICULOS"] <= 10 for item in earlier["score_history"])
    replay = workspace(client)["replay"]
    assert client.patch("/api/v1/replay", headers=headers, json={"session_id":replay["id"], "revision":replay["revision"], "example_mode":True}).status_code == 422
    login(client, "family")
    family = client.get("/api/v1/family").json()
    assert all(set(r) == {"ICULOS", "HR", "O2Sat", "SBP"} for r in family["patients"][0]["readings"])
    assert "score" not in family["patients"][0] and "prediction" not in family["patients"][0]
    assert client.get("/api/v1/patients/p000001/evidence").status_code == 403


def test_rising_edge_alerts_survive_seek_acknowledgment_and_skipped_ticks(real_case):
    app, client, _ = real_case
    class CrossingProvider:
        ready = True
        key = "controlled-crossing-test"
        threshold = .1
        policy = "5pct_false_alert_patients"
        def status(self):
            return {"provider":"lightgbm", "status":"connected"}
        def score_recording(self, patient_id, rows, hours):
            output = {}
            for hour in hours:
                high = patient_id == "p000001" and (5 <= hour <= 8 or hour >= 12)
                output[hour] = PredictionResult(patient_id=patient_id, as_of_hour=hour, origin="model", status="partial", model_version="v1", feature_version="v1", sepsis=SepsisOutput(status="ok", score=.2 if high else .01, alert=high, band="High" if high else "Low", alert_threshold=.1))
            return output
    app.state.sessions.configure(info={"prediction_provider":CrossingProvider()})
    headers = login(client)
    with app.state.sessions() as db:
        replay = db.scalar(select(Replay).where(Replay.active.is_(True)))
        replay.hour, replay.playing, replay.tick_at, replay.speed = 1, True, 100, 1
        db.commit()
        tick(db, now=115)  # Clock skips 15 observations in one tick.
        score_through(db, replay)
        score_through(db, replay)
        alerts = list(db.scalars(select(Alert).where(Alert.origin == "model", Alert.title.contains("5%"), Alert.patient_id == "p000001")))
        controlled = [a for a in alerts if "controlled-crossing-test" in a.detail]
        assert sorted(a.hour for a in controlled) == [5, 12]
    data = workspace(client)
    controlled = [a for a in data["alerts"] if "controlled-crossing-test" in a["detail"]]
    assert [a["hour"] for a in controlled] == [12, 5]
    alert = controlled[0]
    response = client.patch(f"/api/v1/alerts/{alert['id']}", headers=headers, json={"session_id":data["replay"]["id"], "status":"Acknowledged"})
    assert response.status_code == 200
    seek(client, headers, 4)
    assert workspace(client)["alerts"] == []
    seek(client, headers, 16)
    final = workspace(client)
    assert len(final["alerts"]) == 2
    assert next(a for a in final["alerts"] if a["id"] == alert["id"])["status"] == "Acknowledged"


def test_model_results_survive_restart_without_rescoring(real_case):
    app, client, settings = real_case
    login(client)
    before = next(p for p in workspace(client)["patients"] if p["id"] == "p000001")["score"]
    with app.state.sessions() as db:
        ids = set(db.scalars(select(PredictionRun.id)))
    # New app instance simulates startup against the existing persistent database.
    with TestClient(create_app(settings)) as restarted:
        login(restarted)
        assert next(p for p in workspace(restarted)["patients"] if p["id"] == "p000001")["score"] == before
    with app.state.sessions() as db:
        assert set(db.scalars(select(PredictionRun.id))) == ids


def test_background_replay_scores_without_an_open_dashboard(tmp_path):
    import time
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'background.db'}", credentials_path=tmp_path / "credentials.json", clinician_password="test-clinician-password", family_password="test-family-password", prediction_provider="lightgbm", start_clock=True)
    app = create_app(settings)
    with TestClient(app):
        with app.state.sessions() as db:
            replay = db.scalar(select(Replay).where(Replay.active.is_(True)))
            replay.playing, replay.speed, replay.tick_at = True, 1, time.time() - 3
            db.commit()
        # No browser or workspace request triggers this work.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with app.state.sessions() as db:
                hour = db.scalar(select(func.max(PredictionRun.hour)))
            if hour >= 37:
                break
            time.sleep(.1)
        assert hour >= 37


def test_schema_upgrade_preserves_existing_care_records(real_case):
    from sqlalchemy import text
    app, client, settings = real_case
    headers = login(client)
    state = workspace(client)
    response = client.post('/api/v1/patients/p000001/notes', headers=headers, json={"session_id":state['replay']['id'], "text":"Preserve this care record through migration"})
    assert response.status_code == 201
    # Recreate the previous installation's schema version without the new table.
    with app.state.engine.begin() as connection:
        connection.execute(text('DROP TABLE prediction_runs'))
        connection.execute(text("UPDATE alembic_version SET version_num='001'"))
    with TestClient(create_app(settings)) as upgraded:
        login(upgraded)
        state = workspace(upgraded)
        assert any(e['text'] == 'Preserve this care record through migration' for e in state['care']['events'])
        assert state['patients'][0]['prediction']['origin'] == 'model'
        assert any(p['score'] is not None for p in state['patients'])


def test_load_failure_is_visible_and_does_not_reenable_fixtures(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'failure.db'}", credentials_path=tmp_path / 'credentials.json', clinician_password='test-clinician-password', family_password='test-family-password', prediction_provider='lightgbm', model_path=tmp_path / 'missing.txt', start_clock=False)
    with TestClient(create_app(settings)) as client:
        login(client)
        state = workspace(client)
        assert state['integrations']['prediction']['status'] == 'unavailable'
        assert state['replay']['example_mode'] is False
        assert state['alerts'] == []
        assert all(p['score'] is None and p['prediction']['origin'] == 'model' for p in state['patients'])


def test_import_is_scored_with_labels_excluded(real_case, provider, rows):
    import csv
    import io
    from api.app.schemas import READING_COLUMNS
    _, client, _ = real_case
    headers = login(client)
    changed = [dict(r) for r in rows]
    changed[33]['HR'] = 145
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=READING_COLUMNS + ['SepsisLabel'], delimiter='|')
    writer.writeheader()
    writer.writerows([{**{k: 'NaN' if v is None else v for k,v in row.items()}, 'SepsisLabel':1} for row in changed])
    response = client.post('/api/v1/patients/import', headers=headers, files={'file':('held-out.psv',buffer.getvalue().encode())})
    assert response.status_code == 201, response.text
    pid = response.json()['patient_id']
    patient = client.get('/api/v1/patients/'+pid).json()
    assert patient['prediction']['origin'] == 'model'
    assert patient['score'] == pytest.approx(provider.score(prediction_request(pid,34,changed)).sepsis.score)
    assert all('SepsisLabel' not in r for r in patient['readings'])
    assert len(patient['readings']) == 34


def test_transient_inference_failure_is_saved_without_score_then_retried(real_case, monkeypatch):
    import time
    app, client, _ = real_case
    with app.state.sessions() as db:
        provider = db.info['prediction_provider']
        predict = provider.booster.predict
        def broken(*args, **kwargs):
            raise RuntimeError('Controlled inference failure')
        monkeypatch.setattr(provider.booster, 'predict', broken)
        replay = db.scalar(select(Replay).where(Replay.active.is_(True)))
        replay.hour = 35
        db.commit()
        score_through(db, replay)
        run = db.scalar(select(PredictionRun).where(PredictionRun.patient_id=='p000001', PredictionRun.hour==35))
        assert run.result['status'] == 'unavailable'
        assert run.result['sepsis']['score'] is None
        assert 'Inference failed' in run.result['data_quality']['reason']
        run_id = run.id
        run.created = time.time() - 31
        db.commit()
        monkeypatch.setattr(provider.booster, 'predict', predict)
        score_through(db, replay)
        db.refresh(run)
        assert run.id == run_id
        assert run.result['sepsis']['status'] == 'ok'
        assert run.result['sepsis']['score'] is not None
