"""Review checkpoints are personal, replay-bound, and never resolve clinical work."""
import time
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func

from api.app.config import Settings
from api.app.main import create_app
from api.app.models import Alert, CareEvent, Reading, User
from api.app.reviews import REVIEW_KIND
from api.app.seed import passwords

PATH = "/api/v1/patients/p000001/review"


@pytest.fixture
def case(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path/'reviews.db'}", credentials_path=tmp_path/'credentials.json', clinician_password="review-test-password", family_password="family-test-password", prediction_provider="disconnected", language_provider="disconnected", seed_held_out=False, start_clock=False)
    app = create_app(settings)
    with TestClient(app) as client:
        auth = client.post('/api/v1/auth/login',json={"email":"clinician@vitalwatch.local","password":"review-test-password"}).json()
        headers = {"X-CSRF-Token":auth['csrf_token']}
        replay = client.get('/api/v1/workspace').json()['replay']
        client.patch('/api/v1/replay',headers=headers,json={"session_id":replay['id'],"revision":replay['revision'],"hour":12,"example_mode":True})
        yield app, client, headers, replay['id'], auth['user']['id'], settings


def seek(case, hour):
    _, client, headers, session, *_ = case
    replay=client.get('/api/v1/workspace').json()['replay']
    result=client.patch('/api/v1/replay',headers=headers,json={"session_id":session,"revision":replay['revision'],"hour":hour})
    assert result.status_code == 200


def payload(view):
    return {"session_id":view['session_id'],"hour":view['hour'],"checkpoint_id":view['checkpoint']['id'] if view['checkpoint'] else None,"fingerprint":view['fingerprint']}


def mark(case):
    view=case[1].get(PATH).json()
    result=case[1].post(PATH,headers=case[2],json=payload(view))
    assert result.status_code == 200,result.text
    return result.json()


def test_first_review_persists_and_other_patient_is_separate(case):
    app, client, _, _, _, settings = case
    first=client.get(PATH).json()
    assert first['checkpoint'] is None and first['can_mark']
    assert first['counts'] == {"alerts":0,"lab_results":0,"care_updates":0}
    saved=mark(case)
    assert saved['checkpoint']['hour']==12 and not saved['can_mark']
    assert client.get(PATH).json()['checkpoint']==saved['checkpoint']
    assert client.get('/api/v1/patients/demo002/review').json()['checkpoint'] is None
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(CareEvent).where(CareEvent.kind==REVIEW_KIND))==1
    # A new app instance restores the personal checkpoint from persistent storage.
    with TestClient(create_app(settings)) as restarted:
        restarted.post('/api/v1/auth/login',json={"email":"clinician@vitalwatch.local","password":"review-test-password"})
        assert restarted.get(PATH).json()['checkpoint']['id']==saved['checkpoint']['id']


def add_changes(case):
    app, _, _, session, actor, _ = case
    with app.state.sessions() as db:
        for hour, value in [(13,0),(14,999)]:
            row=db.scalar(select(Reading).where(Reading.patient_id=='p000001',Reading.hour==hour))
            row.values={**row.values,'HR':value,'WBC':123 if hour==13 else 999}
        db.add(Alert(id='review-alert',replay_id=session,patient_id='p000001',hour=13,title='Review fixture',detail='Test only',band='High',origin='example'))
        db.add(Alert(id='other-patient-alert',replay_id=session,patient_id='demo002',hour=13,title='Review fixture',detail='Other patient',band='High',origin='example'))
        db.add(CareEvent(replay_id=session,patient_id='p000001',actor_id=actor,hour=13,kind='Suggested action',text='Planned assessment',data={"generation_id":"test-job","action_key":"document_assessment","status":"accepted"},created=time.time()))
        db.add(CareEvent(replay_id=session,patient_id='p000001',actor_id=actor,hour=14,kind='Suggested action',text='Completed assessment',data={"generation_id":"test-job","action_key":"document_assessment","status":"completed"},created=time.time()+1))
        db.commit()


def test_changes_preserve_zero_hide_future_and_keep_pending_after_review(case):
    _, client, *_ = case
    mark(case);add_changes(case);seek(case,13)
    view=client.get(PATH).json()
    assert view['counts']['alerts']==1
    assert [a['id'] for a in view['unresolved_alerts']]==['review-alert']
    assert [a['id'] for a in client.get('/api/v1/patients/demo002/review').json()['unresolved_alerts']]==['other-patient-alert']
    assert any(l['key']=='WBC' and l['value']==123 for l in view['labs'])
    assert next(v for v in view['vital_changes'] if v['key']=='HR')['current']['value']==0
    assert len(view['planned_actions'])==1
    assert all(e['hour']<=13 for e in view['care_updates'])
    reviewed=mark(case)
    assert reviewed['counts']=={"alerts":0,"lab_results":0,"care_updates":0}
    assert reviewed['vital_changes']==[] and reviewed['labs']==[]
    assert len(reviewed['planned_actions'])==1
    assert reviewed['unresolved_alerts'][0]['status']=='Open'
    seek(case,14)
    later=client.get(PATH).json()
    assert len(later['planned_actions'])==0
    assert later['counts']['care_updates']==1


def test_same_hour_notes_are_new_and_stale_or_duplicate_writes_are_rejected(case):
    app, client, headers, session, *_ = case
    initial=client.get(PATH).json()
    assert client.post(PATH,headers=headers,json=payload(initial)).status_code==200
    assert client.post(PATH,headers=headers,json=payload(initial)).status_code==409
    old=client.get(PATH).json()
    client.post('/api/v1/patients/p000001/notes',headers=headers,json={"session_id":session,"text":"A fictional same-hour note"})
    assert client.post(PATH,headers=headers,json=payload(old)).status_code==409
    updated=client.get(PATH).json()
    assert updated['counts']['care_updates']==1 and updated['can_mark']
    mark(case)
    assert client.get(PATH).json()['counts']['care_updates']==0
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(CareEvent).where(CareEvent.kind==REVIEW_KIND))==2


def test_rewind_replay_restart_and_advanced_hour_protection(case):
    _, client, headers, session, *_ = case
    saved=mark(case)
    seek(case,11)
    earlier=client.get(PATH).json()
    assert earlier['rewind'] and not earlier['can_mark']
    assert earlier['vital_changes']==[] and earlier['labs']==[] and earlier['score_change'] is None
    assert client.post(PATH,headers=headers,json=payload(earlier)).status_code==409
    seek(case,12)
    assert client.get(PATH).json()['checkpoint']['id']==saved['checkpoint']['id']
    stale=client.get(PATH).json();seek(case,13)
    assert client.post(PATH,headers=headers,json=payload(stale)).status_code==409
    assert client.post('/api/v1/replay/restart',headers=headers,json={"session_id":session}).status_code==201
    assert client.get(PATH).json()['checkpoint'] is None
    assert client.post(PATH,headers=headers,json=payload(saved)).status_code==409


def test_clinician_scope_family_denial_and_csrf(case):
    app, client, headers, *_ = case
    view=client.get(PATH).json()
    assert client.post(PATH,json=payload(view)).status_code==403
    mark(case)
    with app.state.sessions() as db:
        db.add(User(email='second@local.test',name='Second clinician',role='clinician',password_hash=passwords.hash('second-test-password')))
        db.commit()
    client.post('/api/v1/auth/login',json={"email":"second@local.test","password":"second-test-password"})
    assert client.get(PATH).json()['checkpoint'] is None
    client.post('/api/v1/auth/login',json={"email":"family@vitalwatch.local","password":"family-test-password"})
    assert client.get(PATH).status_code==403
    assert client.post(PATH,headers=headers,json=payload(view)).status_code==403
    family=client.get('/api/v1/family').json()
    assert 'checkpoint' not in str(family) and 'fingerprint' not in str(family)
