"""Bundled held-out recordings: safe, reproducible seeding and offline scoring."""
import hashlib
import json

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from api.app.config import ROOT, Settings
from api.app.database import database
from api.app.inference import LightGBMPrediction
from api.app.main import create_app
from api.app.models import Assignment, Base, Patient, Reading
from api.app.seed import HELD_OUT_IDENTITIES, parse_recording, seed, seed_held_out_patients
from api.tests.test_backend import login, workspace


def test_held_out_seed_is_idempotent_and_does_not_expose_outcomes(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'demo.db'}", credentials_path=tmp_path / 'credentials.json', clinician_password='test-clinician-password', family_password='test-family-password', prediction_provider='disconnected', start_clock=False)
    app = create_app(settings)
    with TestClient(app) as client:
        login(client)
        state = workspace(client)
        assert len(state['patients']) == 13
        added = [p for p in state['patients'] if p['id'] in {i[0] for i in HELD_OUT_IDENTITIES}]
        assert len(added) == 7
        assert all(p['source']=='recorded' and not p['conditions'] and not p['medications'] for p in added)
        assert all(r['ICULOS'] <= 34 and 'SepsisLabel' not in r for p in added for r in p['readings'])
        encoded = json.dumps(added)
        for forbidden in ('sepsis_onset_hour', 'first_alert_hour', 'hours_alert_before_onset', 'sepsis_missed', 'no_sepsis_false_alarm'):
            assert forbidden not in encoded
        with app.state.sessions() as db:
            original_count = db.scalar(select(func.count()).select_from(Reading))
            original_ids = set(db.scalars(select(Patient.id)))
            seed(db, settings)
            assert set(db.scalars(select(Patient.id))) == original_ids
            assert db.scalar(select(func.count()).select_from(Reading)) == original_count
            for patient_id, _, _ in HELD_OUT_IDENTITIES:
                patient = db.get(Patient, patient_id)
                assert patient.source_hash == hashlib.sha256((ROOT / 'demo/held_out' / (patient_id+'.psv')).read_bytes()).hexdigest()
            assert set(db.scalars(select(Assignment.patient_id))) == {'p000001'}
        login(client, 'family')
        assert [p['id'] for p in client.get('/api/v1/family').json()['patients']] == ['p000001']
        assert client.get('/data/held_out/demo_patients.json').status_code == 404


def test_existing_imported_recording_is_preserved_instead_of_duplicated(tmp_path):
    engine, sessions = database(f"sqlite:///{tmp_path / 'existing.db'}")
    Base.metadata.create_all(engine)
    content = (ROOT / 'demo/held_out/p000574.psv').read_bytes()
    with sessions() as db:
        original = Patient(id='existing-import', name='Existing imported patient', bed='01', age=None, sex='Not specified', source='recorded', provenance='Existing import', source_hash=hashlib.sha256(content).hexdigest())
        db.add(original)
        db.commit()
        assert seed_held_out_patients(db) == 6
        db.commit()
        assert db.get(Patient, 'p000574') is None
        assert db.get(Patient, 'existing-import').name == 'Existing imported patient'
        assert len(list(db.scalars(select(Patient)))) == 7
        assert seed_held_out_patients(db) == 0
    engine.dispose()


def test_all_seven_recordings_reproduce_trainer_demo_manifest_at_its_policy():
    settings = Settings()
    provider = LightGBMPrediction(settings.model_path, settings.thresholds_path, '10pct_false_alert_patients')
    assert provider.ready
    # Evaluation metadata is read here only; application seeding never loads it.
    manifest = json.loads((ROOT / 'demo/held_out/demo_patients.json').read_text())
    for patient in manifest['patients']:
        rows = parse_recording((ROOT / 'demo/held_out' / patient['file']).read_bytes())
        assert len(rows) == patient['n_hours']
        assert all('SepsisLabel' not in row for row in rows)
        results = provider.score_recording(patient['physionet_id'], rows, [r['ICULOS'] for r in rows])
        previous, crossing = False, []
        for hour, result in results.items():
            high = bool(result.sepsis.alert)
            if high and not previous:
                crossing.append(hour)
            previous = high
        assert (crossing[0] if crossing else None) == patient['first_alert_hour']
        assert len(crossing) == patient['alert_episodes']
        assert max(r.sepsis.score or 0 for r in results.values()) == pytest.approx(patient['peak_model_score'], abs=.00005)

    stricter = LightGBMPrediction(settings.model_path, settings.thresholds_path, '5pct_false_alert_patients')
    expected = {'p000021': [], 'p000132': [], 'p000185': [60], 'p000346': [64], 'p000574': [57, 59], 'p000679': [], 'p000802': [53, 55]}
    for pid, crossings in expected.items():
        rows = parse_recording((ROOT / 'demo/held_out' / (pid+'.psv')).read_bytes())
        results = stricter.score_recording(pid, rows, [r['ICULOS'] for r in rows])
        previous, actual = False, []
        for hour, result in results.items():
            high = bool(result.sepsis.alert)
            if high and not previous:
                actual.append(hour)
            previous = high
        assert actual == crossings
