"""Human-owned alert follow-up is durable, cutoff-bound, and separate from resolution."""
from fastapi.testclient import TestClient

from api.app.models import Patient, Replay, User
from api.app.seed import passwords
from api.tests.test_reviews import case, seek, add_changes

ROOT = '/api/v1'


def alert(case):
    return next(a for a in case[1].get(ROOT+'/workspace').json()['alerts'] if a['id']=='review-alert')


def prepare(case):
    add_changes(case)
    seek(case,13)


def write(case, operation, **extra):
    state=alert(case)
    body={'session_id':case[3], 'hour':case[1].get(ROOT+'/workspace').json()['replay']['hour'], 'version':state['workflow']['version'], 'operation':operation, **extra}
    return case[1].patch(ROOT+'/alerts/review-alert/workflow', headers=case[2], json=body)


def test_claim_is_separate_from_acknowledgement_and_has_actor_history(case):
    prepare(case)
    initial=alert(case)
    assert initial['workflow']['owner_id'] is None
    claimed=write(case,'claim')
    assert claimed.status_code==200,claimed.text
    result=claimed.json()
    assert result['status']=='Open'
    assert result['workflow']['owner_id']==case[4]
    assert result['history'][0]['actorName']
    assert result['history'][0]['hour']==13
    assert write(case,'claim').status_code==200
    stale=write(case,'release',version=None)
    assert stale.status_code==409
    released=write(case,'release').json()
    assert released['workflow']['owner_id'] is None
    assert len(released['history'])==2
    other=next(a for a in case[1].get(ROOT+'/workspace').json()['alerts'] if a['id']=='other-patient-alert')
    assert other['workflow']['owner_id'] is None and not other['history']


def test_scheduled_due_overdue_and_completed_survive_resolution(case):
    prepare(case)
    assert write(case,'claim').status_code==200
    scheduled=write(case,'schedule',due_hour=14)
    assert scheduled.status_code==200,scheduled.text
    assert not scheduled.json()['workflow']['overdue']
    assert write(case,'release').status_code==409
    case[1].patch(ROOT+'/alerts/review-alert',headers=case[2],json={'session_id':case[3],'status':'Acknowledged'})
    seek(case,14)
    assert alert(case)['status']=='Acknowledged'
    assert alert(case)['workflow']['due_now']
    seek(case,15)
    assert alert(case)['workflow']['overdue']
    case[1].patch(ROOT+'/alerts/review-alert',headers=case[2],json={'session_id':case[3],'status':'Resolved'})
    pending=case[1].get(ROOT+'/patients/p000001/review').json()
    assert pending['unresolved_alerts']==[]
    assert pending['scheduled_followups']==[{'id':'review-alert','due_hour':14,'overdue':True,'due_now':False}]
    completed=write(case,'complete')
    assert completed.status_code==200,completed.text
    assert completed.json()['status']=='Resolved'
    assert completed.json()['workflow']['follow_up']=='completed'
    assert not completed.json()['workflow']['overdue']
    assert write(case,'complete').status_code==409
    assert case[1].get(ROOT+'/patients/p000001/review').json()['scheduled_followups']==[]
    assert len(alert(case)['history'])==5


def test_rewind_hides_future_followup_and_blocks_conflicting_edit(case):
    prepare(case)
    write(case,'claim')
    seek(case,14)
    write(case,'schedule',due_hour=16)
    seek(case,13)
    assert alert(case)['workflow']['follow_up']=='none'
    assert len(alert(case)['history'])==1
    assert write(case,'schedule',due_hour=15).status_code==409
    seek(case,14)
    assert write(case,'schedule',due_hour=16,hour=13).status_code==409
    assert write(case,'complete',session_id='old-session').status_code==409
    seek(case,12)
    assert case[1].patch(ROOT+'/alerts/review-alert/workflow',headers=case[2],json={'session_id':case[3],'hour':12,'version':None,'operation':'claim'}).status_code==404


def test_schedule_validation_and_no_implicit_completion(case):
    prepare(case)
    assert write(case,'schedule',due_hour=15).status_code==403
    write(case,'claim')
    for due in [None,0,12,13,99999]:
        assert write(case,'schedule',due_hour=due).status_code==422
    assert write(case,'complete').status_code==409
    assert write(case,'schedule',due_hour=15).status_code==200
    assert write(case,'schedule',due_hour=16).status_code==200
    assert alert(case)['workflow']['due_hour']==16
    assert alert(case)['workflow']['follow_up']=='scheduled'
    # External AI gets task facts, never the clinician identity or response history.
    from api.app.language import snapshot
    with case[0].state.sessions() as db:
        request=snapshot(db,db.get(Patient,'p000001'),db.get(Replay,case[3]))
        evidence=request.evidence['alert:review-alert']
        assert evidence['follow_up']=={'assigned':True,'status':'scheduled','due_patient_hour':16,'overdue':False,'due_now':False}
        assert 'owner_name' not in str(request.model_dump()) and case[4] not in str(request.model_dump())


def test_other_clinician_cannot_take_or_change_owned_followup(case):
    prepare(case)
    write(case,'claim')
    app=case[0]
    with app.state.sessions() as db:
        db.add(User(id='followup-clinician',email='second@vitalwatch.local',name='Second clinician',role='clinician',password_hash=passwords.hash('second-password')))
        db.commit()
    with TestClient(app) as other:
        login=other.post(ROOT+'/auth/login',json={'email':'second@vitalwatch.local','password':'second-password'}).json()
        body={'session_id':case[3],'hour':13,'version':alert(case)['workflow']['version'],'operation':'claim'}
        headers={'X-CSRF-Token':login['csrf_token']}
        assert other.patch(ROOT+'/alerts/review-alert/workflow',headers=headers,json=body).status_code==409
        for op in ['release','schedule','complete']:
            assert other.patch(ROOT+'/alerts/review-alert/workflow',headers=headers,json={**body,'operation':op,'due_hour':15}).status_code==403


def test_followup_permissions_restart_persistence_and_family_privacy(case):
    prepare(case)
    assert case[1].patch(ROOT+'/alerts/review-alert/workflow',json={'session_id':case[3],'hour':13,'operation':'claim'}).status_code==403
    write(case,'claim');write(case,'schedule',due_hour=14)
    from api.app.main import create_app
    with TestClient(create_app(case[5])) as restarted:
        restarted.post(ROOT+'/auth/login',json={'email':'clinician@vitalwatch.local','password':'review-test-password'})
        saved=next(a for a in restarted.get(ROOT+'/workspace').json()['alerts'] if a['id']=='review-alert')
        assert saved['workflow']['owner_id']==case[4] and saved['workflow']['due_hour']==14
    with TestClient(case[0]) as family:
        login=family.post(ROOT+'/auth/login',json={'email':'family@vitalwatch.local','password':'family-test-password'})
        assert login.status_code==200
        assert family.patch(ROOT+'/alerts/review-alert/workflow',headers={'X-CSRF-Token':login.json()['csrf_token']},json={'session_id':case[3],'hour':13,'operation':'claim'}).status_code==403
        assert 'follow_up' not in family.get(ROOT+'/family').text
