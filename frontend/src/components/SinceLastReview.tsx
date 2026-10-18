import { useEffect, useState } from 'react'
import { ArrowRight, Bell, Check, CheckCircle, ChevronDown, Clipboard, Clock, RefreshCw } from 'react-feather'
import { api, json } from '../api'
import { ADDITIONAL_VITALS, LABS, VITALS, valueText } from '../data'
import './since-last-review.css'

type Observation = { value: number; hour: number }
type Review = {
  patient_id: string; session_id: string; hour: number; checkpoint: {id: string; hour: number; created: number} | null;
  fingerprint: string; rewind: boolean; can_mark: boolean;
  counts: {alerts: number; lab_results: number; care_updates: number};
  new_alerts: {id: string; hour: number; status: string}[];
  unresolved_alerts: {id: string; hour: number; status: string}[];
  planned_actions: {id: string; hour: number; label: string}[];
  scheduled_followups: {id: string; due_hour: number; overdue: boolean; due_now: boolean}[];
  vital_changes: {key: string; previous: Observation | null; current: Observation; difference: number | null}[];
  labs: {key: string; count: number; value: number; hour: number}[];
  care_updates: {id: string; kind: string; text: string; hour: number}[];
  quality: {missing: string[]; older: ({key: string; age_hours: number} & Observation)[]};
  score_change: {comparable: boolean; previous: {score: number | null; threshold: number | null; hour: number}; current: {score: number | null; threshold: number | null; hour: number}} | null;
}
type Props = {patientId: string; session: string; hour: number; onReviewed: () => void; onAlerts: () => void; onFollowups: () => void; onHistory: () => void; onLabs: () => void; onTimeline: () => void; onScore: () => void}
const label = (key: string) => [...VITALS, ...ADDITIONAL_VITALS].find(v => v.key === key)?.label || LABS.find(([k]) => k === key)?.[1] || key
const unit = (key: string) => [...VITALS, ...ADDITIONAL_VITALS].find(v => v.key === key)?.unit || ''
function signalChange(change: NonNullable<Review['score_change']>) {
  const {previous: a, current: b} = change
  if (!change.comparable) return 'Configuration changed'
  if (b.score == null) return 'Score unavailable'
  if (a.score == null) return 'Score now available'
  if (a.threshold != null && b.threshold != null && (a.score >= a.threshold) !== (b.score >= b.threshold)) return b.score >= b.threshold ? 'Crossed above threshold' : 'Now below threshold'
  return b.score > a.score ? 'Score rising' : b.score < a.score ? 'Score falling' : 'Threshold updated'
}

export function SinceLastReview(props: Props) {
  const [view, setView] = useState<Review | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let active = true
    const load = () => { void api<Review>(`/patients/${props.patientId}/review`).then(v => { if (active) { setView(v); setError('') } }).catch(e => { if (active) setError(e.message) }) }
    load()
    const timer = window.setInterval(load, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [props.patientId, props.session, props.hour])
  async function markReviewed() {
    if (!view || busy) return
    setBusy(true); setError(''); setSaved(false)
    try {
      const next = await api<Review>(`/patients/${props.patientId}/review`, json('POST', {session_id: props.session, hour: view.hour, checkpoint_id: view.checkpoint?.id || null, fingerprint: view.fingerprint}))
      setView(next); setSaved(true); props.onReviewed()
    } catch (e) {
      setError((e as Error).message)
      try { setView(await api<Review>(`/patients/${props.patientId}/review`)) } catch { /* Retain the previous evidence and visible error. */ }
    } finally { setBusy(false) }
  }
  const first = !view?.checkpoint, activeWork = (view?.unresolved_alerts.length || 0) + (view?.planned_actions.length || 0)
  const changes = view ? view.vital_changes.length + view.labs.length + view.care_updates.length + view.new_alerts.length + (view.score_change ? 1 : 0) : 0
  return <section className="panel since-review" aria-label="Since your last review">
    <header className="review-heading"><div><h3>Since your last review</h3><p>{view ? view.rewind ? `Viewing earlier data · your review is at hour ${view.checkpoint!.hour}` : view.checkpoint ? `Your checkpoint: hour ${view.checkpoint.hour} → now ${view.hour}` : `First review · patient hour ${view.hour}` : 'Loading your review checkpoint…'}</p></div><button className="button dark" disabled={!view || busy || !view.can_mark || view.hour !== props.hour} onClick={() => void markReviewed()}>{busy ? <RefreshCw size={17} /> : <CheckCircle size={17} />}{busy ? 'Saving…' : view && !view.can_mark && !view.rewind ? 'Reviewed' : 'Mark reviewed'}</button></header>
    {error && <p className="review-error" role="alert">{error}</p>}
    {view && !view.rewind && <>
      <div className="review-counts">
        <button onClick={props.onAlerts} className={view.counts.alerts ? 'has-new-alerts' : ''}><span>{first ? 'Open alerts' : 'New alerts'}</span><strong>{first ? view.unresolved_alerts.length : view.counts.alerts}</strong><Bell size={18} /></button>
        <button onClick={first ? props.onTimeline : props.onLabs}><span>{first ? 'Planned actions' : 'Lab results'}</span><strong>{first ? view.planned_actions.length : view.counts.lab_results}</strong><Clipboard size={18} /></button>
        <button onClick={first ? props.onHistory : props.onTimeline}><span>{first ? 'Data gaps' : 'Care updates'}</span><strong>{first ? view.quality.missing.length + view.quality.older.length : view.counts.care_updates}</strong><Clock size={18} /></button>
      </div>
      {first ? <p className="review-first">Mark reviewed to start your personal change briefing.</p> : changes === 0 ? <p className="review-current"><Check size={18} />{saved ? 'Review saved. ' : ''}No new recorded changes since your checkpoint.</p> : <div className="review-changes">
        {view.new_alerts.length > 0 && <button className="review-alert-change" onClick={props.onAlerts}><Bell size={18} /><span><strong>{view.new_alerts.length} new alert{view.new_alerts.length === 1 ? '' : 's'}</strong><small>Raised at {view.new_alerts.map(a => `hour ${a.hour}`).join(', ')}</small></span><ArrowRight size={17} /></button>}
        {view.score_change && <button className="review-score-change" onClick={props.onScore}><span>Sepsis signal</span><strong>{signalChange(view.score_change)}</strong><ArrowRight size={17} /></button>}
        {view.vital_changes.length > 0 && <div className="review-vitals">{view.vital_changes.slice(0,3).map(v => <button key={v.key} onClick={props.onHistory}><span>{label(v.key)}</span><strong>{v.previous ? <><span className="review-before">{valueText(v.previous.value)}</span><span className="review-arrow">→</span></> : null}{valueText(v.current.value)} <small>{unit(v.key)}</small></strong><small>{v.previous ? `Hour ${v.previous.hour} → ${v.current.hour}` : `First recorded · hour ${v.current.hour}`}</small></button>)}</div>}
        {(view.labs.length > 0 || view.care_updates.length > 0 || view.vital_changes.length > 3) && <details className="review-details"><summary>All recorded changes <ChevronDown size={17} /></summary><div>
          {view.vital_changes.slice(3).map(v => <button key={v.key} onClick={props.onHistory}><span>{label(v.key)}</span><strong>{v.previous ? `${valueText(v.previous.value)} → ` : ''}{valueText(v.current.value)} {unit(v.key)} · Hour {v.current.hour}</strong></button>)}
          {view.labs.map(l => <button key={l.key} onClick={props.onLabs}><span>{label(l.key)}<small>{l.count} new result{l.count === 1 ? '' : 's'} · latest at hour {l.hour}</small></span><strong>{valueText(l.value)}<small>source units</small></strong></button>)}
          {view.care_updates.map(e => <button key={e.id} onClick={props.onTimeline}><span>{e.kind}<small>Hour {e.hour}</small></span><span className="review-care-text">{e.text}</span></button>)}
        </div></details>}
      </div>}
      {activeWork > 0 && <div className="review-outstanding"><strong>Still needs follow-up</strong><div>{view.unresolved_alerts.length > 0 && <button className="text-link" onClick={props.onAlerts}>{view.unresolved_alerts.length} unresolved alert{view.unresolved_alerts.length === 1 ? '' : 's'}<ArrowRight size={15} /></button>}{view.planned_actions.length > 0 && <button className="text-link" onClick={props.onTimeline}>{view.planned_actions.length} planned action{view.planned_actions.length === 1 ? '' : 's'}<ArrowRight size={15} /></button>}</div></div>}
      {!!view.scheduled_followups?.length && <div className="review-outstanding"><button className="text-link" onClick={props.onFollowups}>{view.scheduled_followups.length} scheduled follow-up{view.scheduled_followups.length === 1 ? '' : 's'} · {view.scheduled_followups.filter(f => f.overdue || f.due_now).length} due / overdue <ArrowRight size={15}/></button></div>}
      {(view.quality.older.length > 0 || view.quality.missing.length > 0) && <details className="review-quality"><summary>Measurement gaps <span>{view.quality.older.length + view.quality.missing.length}</span></summary><ul>{view.quality.older.map(v => <li key={v.key}>{label(v.key)} · last recorded at hour {v.hour} ({v.age_hours}h ago)</li>)}{view.quality.missing.map(k => <li key={k}>{label(k)} · not recorded</li>)}</ul><small>Older than 3h is a display flag, not a clinical alarm.</small></details>}
    </>}
    {view?.rewind && <p className="review-first">Return to hour {view.checkpoint!.hour} or later to continue your review.</p>}
    <footer>Reviewing records a checkpoint. Alerts and tasks stay open until separately updated.</footer>
  </section>
}
