import { useEffect, useState } from 'react'
import { Check, CheckCircle, ChevronDown, Clock, RefreshCw, Zap } from 'react-feather'
import { api, json } from '../api'
import './patient-guidance.css'

export type LanguageStatus = { provider: string; status: string; model?: string; external_calls_enabled: boolean; cooldown_until?: number; last_error?: string }
export type Generation = {
  id: string; patient_id: string; hour: number; operation: string; status: string; error?: string; earlier?: boolean; model: string;
  result: { text?: string; evidence_ids?: string[]; citations?: string[]; observations?: { text: string; evidence_ids: string[]; citations: string[] }[]; actions?: { action_id: string; label: string; reason: string; evidence_ids: string[]; citations: string[] }[] };
  actions: Record<string, {status: string}>;
  references: { id: string; title: string; url: string; provenance: string }[];
  evidence: Record<string, unknown>;
}
type GuidanceView = { latest: Generation | null; guidance: Generation | null; planned: Generation[]; eligible: boolean }
export function GenerationSources({ job }: {job: Generation}) {
  const ids = [...new Set([...(job.result.evidence_ids || []), ...(job.result.observations || []).flatMap(o => o.evidence_ids), ...(job.result.actions || []).flatMap(a => a.evidence_ids)])]
  const citations = new Set([...(job.result.citations || []), ...(job.result.observations || []).flatMap(o => o.citations), ...(job.result.actions || []).flatMap(a => a.citations)])
  return <details className="ai-sources"><summary>Supporting evidence <ChevronDown size={16} /></summary><div>
    {ids.map(id => <div key={id}><strong>{id}</strong><pre>{JSON.stringify(job.evidence[id], null, 2)}</pre></div>)}
    {job.references.filter(r => citations.has(r.id)).map(r => <p key={r.id}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a><small>{r.provenance}</small></p>)}
    <small>{job.model} · Sources are not clinically reviewed.</small>
  </div></details>
}
export function SavedGenerationSources({id}: {id: string}) {
  const [job, setJob] = useState<Generation | null>(null)
  const [error, setError] = useState('')
  return <div>{!job ? <button className="text-link" onClick={() => { void api<Generation>(`/language/jobs/${id}`).then(setJob).catch(e => setError(e.message)) }}>View evidence</button> : <GenerationSources job={job} />}{error && <p role="status">{error}</p>}</div>
}
export function PatientGuidance({patientId, session, hour, language, onChange}: {patientId: string; session: string; hour: number; language: LanguageStatus | null; onChange: () => void}) {
  const [view, setView] = useState<GuidanceView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setView(null); setError('')
    const load = () => { void api<GuidanceView>(`/patients/${patientId}/guidance`).then(v => { if (active) {setView(v); setError('')} }).catch(e => { if (active) setError(e.message) }) }
    load()
    const timer = window.setInterval(load, 3000)
    return () => {active = false; window.clearInterval(timer)}
  }, [patientId, session, hour])
  async function generate() {
    setBusy(true); setError('')
    try { await api(`/patients/${patientId}/guidance`, json('POST', {session_id: session, retry: true})); setView(await api<GuidanceView>(`/patients/${patientId}/guidance`)) }
    catch (e) {setError((e as Error).message)} finally {setBusy(false)}
  }
  async function update(job: Generation, actionId: string, status: string) {
    setBusy(true); setError('')
    try {await api(`/guidance/${job.id}/actions/${actionId}`, json('POST', {session_id: session, status})); setView(await api<GuidanceView>(`/patients/${patientId}/guidance`)); onChange()}
    catch(e) {setError((e as Error).message)} finally {setBusy(false)}
  }
  const job = view?.guidance, latest = view?.latest
  const pending = latest?.status === 'queued' || latest?.status === 'running'
  const quality = job?.evidence['data:quality'] as {missing_vitals?: string[]; stale_vitals?: string[]} | undefined
  const connected = language?.external_calls_enabled
  return <section className="patient-guidance" aria-label="Suggested review steps">
    <div className="ai-heading"><div><span className="ai-label"><Zap size={18} /> Gemini</span><h4>Suggested review steps</h4></div><button className="button secondary" disabled={busy || pending || !connected || !view?.eligible} onClick={() => void generate()}><RefreshCw size={16} />{pending ? 'Generating…' : job ? 'Refresh guidance' : 'Generate guidance'}</button></div>
    {!connected && <p>Gemini is not connected. Configure the backend API key to enable guidance.</p>}
    {view && !view.eligible && <p>External AI is unavailable for this patient. Imported recordings remain local.</p>}
    {pending && <p role="status"><Clock size={16} /> Guidance queued for patient hour {latest?.hour}. Monitoring continues.</p>}
    {latest?.status === 'unavailable' && <p className="ai-error" role="status">{latest.error}</p>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    {job ? <>
      <div className="ai-snapshot"><strong>{job.earlier ? 'Earlier guidance' : 'Current snapshot'}</strong><span>Patient hour {job.hour}</span></div>
      <p className="ai-summary">{job.result.text}</p>
      {!!job.result.observations?.length && <ul className="ai-observations">{job.result.observations.map((o,i) => <li key={i}>{o.text}</li>)}</ul>}
      <div className="ai-step-list">{job.result.actions?.map(a => {
        const state = job.actions[a.action_id]?.status
        return <article className="ai-step" key={a.action_id}><div><strong>{a.label}</strong><p>{a.reason}</p></div><div className="ai-step-controls">
          {!state ? <><button className="button dark tiny" disabled={busy || job.earlier} onClick={() => void update(job,a.action_id,'accepted')}><Check size={16} /> Accept plan</button><button className="text-link" disabled={busy} onClick={() => void update(job,a.action_id,'dismissed')}>Dismiss</button></> : <><span className="neutral-chip">{state === 'accepted' ? 'Planned' : state === 'completed' ? 'Completed' : 'Dismissed'}</span>{state === 'accepted' && <button className="button secondary tiny" disabled={busy} onClick={() => void update(job,a.action_id,'completed')}><CheckCircle size={16} /> Mark completed</button>}</>}
        </div></article>
      })}</div>
      {job.earlier && <p>Refresh before accepting new actions. Previously planned items stay in the care timeline.</p>}
      {!!quality?.missing_vitals?.length && <p>Missing readings: {quality.missing_vitals.join(', ')}.</p>}
      {!!quality?.stale_vitals?.length && <p>Older readings: {quality.stale_vitals.join(', ')}. Check their recorded hours.</p>}
      <GenerationSources job={job} />
    </> : connected && view?.eligible && !pending && <p>Generate an explanation from the readings and sepsis score, or wait for a new model alert.</p>}
    {!!view?.planned?.length && <div className="ai-step-list"><h4>Previously planned</h4>{view.planned.flatMap(old => (old.result.actions || []).filter(a => old.actions[a.action_id]?.status === 'accepted').map(a => <article className="ai-step" key={`${old.id}:${a.action_id}`}><div><strong>{a.label}</strong><p>Planned from hour {old.hour}</p></div><button className="button secondary" disabled={busy} onClick={() => void update(old,a.action_id,'completed')}><CheckCircle size={16} /> Mark completed</button></article>))}</div>}
    <small>Accept records a plan. Completion is recorded separately. Guidance does not change scores or resolve alerts.</small>
  </section>
}
