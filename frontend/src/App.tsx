import { useEffect, useRef, useState, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { Activity, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, Download, ExternalLink, FileText, Heart, History, LayoutDashboard, Link2, Menu, Pause, Play, Plus, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Stethoscope, Upload, Users, Waves, X } from 'lucide-react'
import { api, ApiError, json, setCsrf, type Auth, type FamilyView, type HandoverMeta, type User } from './api'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ADDITIONAL_VITALS, downloadText, history, LABS, latest, mean, valueText, VITALS, type AlertState, type Band, type CareEvent, type Patient, type Reading, type VitalKey } from './data'

type Page = 'overview' | 'patients' | 'patient' | 'alerts' | 'handover' | 'family' | 'settings'
type Sheet = 'chat' | 'focus' | 'evidence' | 'note' | 'priority' | 'help' | null
type Update = { id: string; patientId: string; text: string; hour: number; approved: boolean; session: string }
type Message = { role: 'user' | 'assistant' | 'system'; text: string; origin?: string }
type Saved = { events: CareEvent[]; focuses: Record<string, string>; priorities: Record<string, string>; drafts: Record<string, string>; updates: Update[]; messages: Record<string, Message[]> }
const INITIAL_SAVED: Saved = { events: [], focuses: {}, priorities: {}, drafts: {}, updates: [], messages: {} }
type ServerAlert = { id: string; patientId: string; hour: number; title: string; detail: string; band: Band; origin: string; status: AlertState['status'] }
type Workspace = { replay: { id: string; hour: number; max_hour: number; playing: boolean; speed: number; revision: number; example_mode: boolean }; patients: Patient[]; alerts: ServerAlert[]; care: Saved; draft_meta: Record<string, HandoverMeta> }
function Badge({ band }: { band: Band | string }) { return <span className={`badge ${band.toLowerCase()}`}><i />{band}</span> }
function Avatar({ patient, small = false }: { patient: Patient; small?: boolean }) { return <span className={`avatar ${patient.color} ${small ? 'small' : ''}`}>{patient.initials}</span> }
function IconButton({ children, label, onClick, className = '' }: { children: ReactNode; label: string; onClick: () => void; className?: string }) { return <button className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}>{children}</button> }
function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) { return <div className="empty"><div className="empty-icon"><Activity size={23} /></div><h3>{title}</h3><p>{text}</p>{children}</div> }
function TrendChart({ rows, vital = 'HR', color = '#588977', mini = false }: { rows: Reading[]; vital?: string; color?: string; mini?: boolean }) {
  if (!rows.some(r => r[vital] != null)) return <div className="chart-empty">No measurements in this period</div>
  return <div className={mini ? 'sparkline' : 'trend-chart'}><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={mini ? { top: 5, right: 0, bottom: 0, left: 0 } : { top: 18, right: 10, bottom: 0, left: 0 }}>
    <defs><linearGradient id={`fill-${vital}-${mini ? 'mini' : 'full'}-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.17} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
    {!mini && <><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e7ebe5" /><XAxis dataKey="ICULOS" axisLine={false} tickLine={false} tick={{ fill: '#52645b', fontSize: 15 }} tickFormatter={v => `${v}h`} minTickGap={30} /><YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{ fill: '#52645b', fontSize: 15 }} width={54} /><Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8df', fontSize: 14 }} labelFormatter={v => `Patient hour ${v}`} formatter={(value) => [valueText(value as number), VITALS.find(v => v.key === vital)?.short || LABS.find(([key]) => key === vital)?.[1] || vital]} /></>}
    <Area type="monotone" dataKey={vital} stroke={color} strokeWidth={mini ? 1.7 : 2} fill={`url(#fill-${vital}-${mini ? 'mini' : 'full'}-${color.replace('#', '')})`} dot={!mini && rows.filter(r => r[vital] != null).length < 8 ? { r: 3, fill: color, strokeWidth: 0 } : false} connectNulls={false} isAnimationActive={false} />
  </AreaChart></ResponsiveContainer></div>
}

function SheetFrame({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('button, input, textarea, select, a[href]'); first?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      if (e.key === 'Tab') {
        const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, select, a[href]') || [])
        const first = elements[0], last = elements[elements.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) gsap.fromTo(ref.current, { x: 30, opacity: 0 }, { x: 0, opacity: 1, duration: .25 })
    return () => { document.removeEventListener('keydown', key); previous?.focus() }
  }, [])
  return <div className="sheet-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div className="sheet-head"><div><span className="eyebrow">{eyebrow}</span><h2 id="sheet-title">{title}</h2></div><IconButton label="Close panel" onClick={onClose}><X size={20} /></IconButton></div>{children}</section></div>
}

function PanelTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <div className="panel-title"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div> }

function LoginScreen({ onSignedIn, connectionError }: { onSignedIn: (auth: Auth) => void; connectionError: string }) {
  const [email, setEmail] = useState('clinician@vitalwatch.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  return <main className="login-screen"><section className="login-story"><div className="login-brand"><Activity size={32} /><span>vitalwatch.</span></div><span className="eyebrow">THOUGHTFULLY CONNECTED CARE</span><h1>Clarity for the team.<br />Connection for the family.</h1><p>A shared patient timeline, with the right information for each person.</p><div className="login-trust"><ShieldCheck size={22} /><span>Patient access is checked on the server. Your care team's internal notes stay private.</span></div></section><section className="login-card"><span className="eyebrow">YOUR CARE WORKSPACE</span><h2>Welcome back.</h2><p>Sign in with your clinician or assigned family account.</p><div className="login-account-types"><button type="button" className={email.startsWith('clinician') ? 'active' : ''} onClick={() => { setEmail('clinician@vitalwatch.local'); setPassword(''); setError('') }}><Stethoscope size={17} /> Clinician</button><button type="button" className={email.startsWith('family') ? 'active' : ''} onClick={() => { setEmail('family@vitalwatch.local'); setPassword(''); setError('') }}><Heart size={17} /> Family</button></div><form onSubmit={async e => { e.preventDefault(); setPending(true); setError(''); try { onSignedIn(await api<Auth>('/auth/login', json('POST', { email, password }))) } catch (err) { setError((err as Error).message) } finally { setPending(false) } }}><label className="field-label" htmlFor="login-email">Account email</label><input id="login-email" className="text-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /><label className="field-label" htmlFor="login-password">Password</label><input id="login-password" className="text-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />{(error || connectionError) && <p role="alert" className="login-error">{error || connectionError}</p>}<button className="button dark full-width" disabled={pending || !password} type="submit">{pending ? 'Signing in…' : 'Sign in to workspace'}<ArrowRight size={17} /></button></form><p className="login-footnote">Demo account passwords are provided by your workspace administrator. No public registration.</p></section></main>
}

export default function App() {
  const [page, setPage] = useState<Page>('overview')
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedId, setSelectedId] = useState('p000001')
  const [hour, setHour] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(3)
  const [session, setSession] = useState('')
  const [maxHour, setMaxHour] = useState(54)
  const [exampleMode, setExampleMode] = useState(false)
  const [saved, setSaved] = useState<Saved>(INITIAL_SAVED)
  const [alerts, setAlerts] = useState<ServerAlert[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')
  const [busy, setBusy] = useState(false)
  const [familyView, setFamilyView] = useState<FamilyView | null>(null)
  const [draftMeta, setDraftMeta] = useState<Record<string, HandoverMeta>>({})
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({})
  const [editRevisions, setEditRevisions] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All patients')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [chartVital, setChartVital] = useState<VitalKey>('HR')
  const [historyHours, setHistoryHours] = useState('24')
  const [historyView, setHistoryView] = useState<'all' | 'focused'>('all')
  const [labKey, setLabKey] = useState('WBC')
  const [familyVital, setFamilyVital] = useState<VitalKey>('HR')
  const [patientTab, setPatientTab] = useState('Overview')
  const [note, setNote] = useState('')
  const [focusInput, setFocusInput] = useState('')
  const [priorityInput, setPriorityInput] = useState('Routine')
  const [overrideReason, setOverrideReason] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [familyInput, setFamilyInput] = useState('')
  const [alertFilter, setAlertFilter] = useState('Active')
  const [compare, setCompare] = useState(false)
  const [seekHour, setSeekHour] = useState<number | null>(null)
  const seekRef = useRef<number | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const epoch = useRef(0)
  const refreshSequence = useRef(0)
  const busyRef = useRef(false)
  const replayRef = useRef({ id: '', revision: 1 })
  const patient = patients.find(p => p.id === selectedId) || patients[0]
  const focusOf = (p: Patient) => saved.focuses[p.id] || p.focus
  const alertState = (id: string): AlertState => ({ status: alerts.find(a => a.id === id)?.status || 'Open', note: '' })
  const availableAlerts = alerts
  const activeAlerts = alerts.filter(a => a.status !== 'Resolved')
  const sessionEvents = saved.events
  const visibleRows = patient ? history(patient, hour).filter(r => r.ICULOS > hour - Number(historyHours)) : []
  const messages = saved.messages[`${session}:${selectedId}`] || []

  function endSession() {
    epoch.current++; refreshSequence.current++; setUser(null); setCsrf(''); setPatients([]); setSaved(INITIAL_SAVED)
    setAlerts([]); setFamilyView(null); setSheet(null); setMenuOpen(false); setDraftEdits({}); setEditRevisions({}); setLoading(true)
  }
  async function refresh(actor: User = user!, quiet = false) {
    if (!actor || quiet && busyRef.current) return
    const currentEpoch = epoch.current, sequence = ++refreshSequence.current
    try {
      if (actor.role === 'family') {
        const data = await api<FamilyView>('/family')
        if (epoch.current !== currentEpoch || sequence !== refreshSequence.current) return
        setFamilyView(data); setHour(data.hour); setSession(data.session_id)
      } else {
        const data = await api<Workspace>('/workspace')
        if (epoch.current !== currentEpoch || sequence !== refreshSequence.current) return
        const r = data.replay
        replayRef.current = { id: r.id, revision: r.revision }
        setHour(r.hour); setMaxHour(r.max_hour); setPlaying(r.playing); setSpeed(r.speed); setSession(r.id); setExampleMode(r.example_mode)
        setPatients(data.patients); setSaved(data.care); setAlerts(data.alerts); setDraftMeta(data.draft_meta)
        setSelectedId(id => data.patients.some(p => p.id === id) ? id : data.patients[0]?.id || '')
      }
      setLoading(false); setApiError('')
    } catch (error) {
      if (epoch.current === currentEpoch && sequence === refreshSequence.current) { setApiError(error instanceof Error ? error.message : 'Unable to load workspace'); setLoading(false) }
    }
  }
  useEffect(() => {
    let cancelled = false
    api<Auth>('/auth/me').then(auth => { if (!cancelled) { setCsrf(auth.csrf_token); setUser(auth.user); setPage(auth.user.role === 'family' ? 'family' : 'overview') } }).catch(error => { if (!cancelled && (!(error instanceof ApiError) || error.status !== 401)) setApiError(error.message) }).finally(() => { if (!cancelled) setBooting(false) })
    const expired = () => { endSession(); setToast('Your session ended. Please sign in again.') }
    window.addEventListener('vitalwatch:unauthorized', expired)
    return () => { cancelled = true; window.removeEventListener('vitalwatch:unauthorized', expired) }
  }, [])
  useEffect(() => {
    if (!user) return
    void refresh(user)
    const id = setInterval(() => void refresh(user, true), 2000)
    return () => { clearInterval(id); refreshSequence.current++ }
  }, [user?.id])
  useEffect(() => {
    if (!user || user.role !== 'clinician' || page !== 'family' || !patient) return
    let cancelled = false
    api<FamilyView['patients'][number]>(`/patients/${patient.id}/family-view`).then(p => { if (!cancelled) setFamilyView({ user, session_id: session, hour, patients: [p] }) }).catch(error => { if (!cancelled) setApiError(error.message) })
    return () => { cancelled = true }
  }, [page, selectedId, hour, session, user?.id, saved.updates])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 6000); return () => clearTimeout(id) }, [toast])
  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const ctx = gsap.context(() => gsap.fromTo('.animate-in', { y: 9, opacity: 0 }, { y: 0, opacity: 1, duration: .35, stagger: .045, clearProps: 'all' }), mainRef)
      return () => ctx.revert()
    }
  }, [page, selectedId, loading])

  async function perform(task: () => Promise<unknown>, message = '') {
    busyRef.current = true; setBusy(true); refreshSequence.current++
    try { await task(); await refresh(); if (message) setToast(message); return true }
    catch (error) { setToast(error instanceof Error ? error.message : 'The action could not be saved'); if (error instanceof ApiError && error.status === 409) await refresh(); return false }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); endSession(); setApiError('') }
    catch (error) { setToast(error instanceof Error ? error.message : 'Sign-out failed; please retry') }
  }
  function navigate(next: Page) { setPage(user?.role === 'family' ? 'family' : next); setMenuOpen(false); setSearch(''); setFilter('All patients'); window.scrollTo({ top: 0 }) }
  function openPatient(p: Patient) { setSelectedId(p.id); setPatientTab('Overview'); setHistoryView('all'); navigate('patient') }
  function openSheet(type: Sheet, p = patient) { if (!p && type !== 'help') return; if (p) { setSelectedId(p.id); setFocusInput(focusOf(p)); setPriorityInput(saved.priorities[p.id] || 'Routine') } setNote(''); setOverrideReason(''); setSheet(type) }
  const command = (path: string, body: object = {}, method = 'POST') => api(path, json(method, { session_id: session, ...body }))
  async function updateAlert(id: string, status: AlertState['status']) { await perform(() => command(`/alerts/${id}`, { status }, 'PATCH'), `Alert ${status.toLowerCase()}`) }
  async function saveNote() { if (await perform(() => command(`/patients/${patient.id}/notes`, { text: note }), 'Care note saved')) setSheet(null) }
  async function saveFocus() {
    if (await perform(() => command(`/patients/${patient.id}/focus`, { focus: focusInput }, 'PUT'), 'Monitoring focus confirmed')) {
      setChartVital(focusInput.toLowerCase().includes('respiratory') ? 'O2Sat' : focusInput.toLowerCase().includes('cardiovascular') ? 'SBP' : 'HR'); setSheet(null)
    }
  }
  async function savePriority(remove = false) { if (await perform(() => command(`/patients/${patient.id}/priority`, { priority: remove ? null : priorityInput, reason: remove ? 'Clinician removed the priority override.' : overrideReason }, 'PUT'), remove ? 'Override removed' : 'Clinical priority saved')) setSheet(null) }
  async function controlPlayback(fields: object) {
    const r = replayRef.current
    await perform(() => api('/replay', json('PATCH', { session_id: r.id, revision: r.revision, ...fields })))
  }
  function commitSeek() { const value = seekRef.current; if (value == null) return; seekRef.current = null; setSeekHour(null); void controlPlayback({ hour: value, playing: false }) }
  function discardDraft(key: string) { setDraftEdits(s => { const next = { ...s }; delete next[key]; return next }); setEditRevisions(s => { const next = { ...s }; delete next[key]; return next }) }
  async function generateHandover() {
    const key = `${session}:${patient.id}`
    if (key in draftEdits && !window.confirm('Replace your unsaved edits with a new structured draft?')) return
    if (await perform(() => command(`/patients/${patient.id}/handovers`), 'Structured handover created')) discardDraft(key)
  }
  async function saveHandover() {
    const key = `${session}:${patient.id}`, meta = draftMeta[key]
    if (!(key in draftEdits)) return true
    if (!meta) return false
    const ok = await perform(() => command(`/handovers/${meta.id}`, { text: draftEdits[key], revision: editRevisions[key] ?? meta.revision }, 'PATCH'), 'Handover saved')
    if (ok) discardDraft(key)
    return ok
  }
  async function exportHandover() {
    const key = `${session}:${patient.id}`, meta = draftMeta[key]
    if (!meta || !await saveHandover()) return
    try { const text = await api<string>(`/handovers/${meta.id}/export`); downloadText(`handover-${patient.id}-hour-${meta.hour}.txt`, text); setToast('Handover exported') } catch (error) { setToast((error as Error).message) }
  }
  async function approveFamilyUpdate() { if (await perform(() => command(`/patients/${patient.id}/updates`, { text: familyInput }), 'Update approved for the assigned family')) setFamilyInput('') }
  async function sendQuestion() {
    if (!chatInput.trim()) return
    if (await perform(() => command(`/patients/${patient.id}/messages`, { text: chatInput.trim() }))) setChatInput('')
  }
  async function importFile(file?: File) {
    if (!file) return
    const form = new FormData(); form.append('file', file)
    busyRef.current = true; setBusy(true)
    try {
      const result = await api<{ patient_id: string; records: number }>('/patients/import', { method: 'POST', body: form })
      await refresh(); setSelectedId(result.patient_id); setPatientTab('Overview'); setHistoryView('all'); navigate('patient'); setToast(`${result.records} records saved to the database. No prediction was computed.`)
    } catch (error) { setToast((error as Error).message) }
    finally { busyRef.current = false; setBusy(false); if (uploadRef.current) uploadRef.current.value = '' }
  }

  const matchingPatients = patients.filter(p => `${p.name} ${p.id} ${p.bed} ${focusOf(p)}`.toLowerCase().includes(search.toLowerCase())).filter(p => filter === 'All patients' || (exampleMode && p.band === filter))
  const sortedPatients = [...matchingPatients].sort((a, b) => {
    const rank = (p: Patient) => saved.priorities[p.id] === 'Urgent' ? 4 : saved.priorities[p.id] === 'Review soon' ? 3 : exampleMode ? p.score ?? 0 : 0
    return rank(b) - rank(a) || a.bed.localeCompare(b.bed)
  })

  function PatientTable({ full = false }: { full?: boolean }) {
    return <div className="table-wrap"><table className="patient-table"><thead><tr><th>Patient</th><th>Review priority <span className="table-help" title="Sample model outputs, not clinical predictions">ⓘ</span></th><th>Heart rate</th><th>SpO₂</th>{full && <th>Systolic BP</th>}<th>Trend · 12h</th><th><span className="sr-only">Open patient</span></th></tr></thead><tbody>{sortedPatients.map(p => {
      const hr = latest(p, hour, 'HR'), oxygen = latest(p, hour, 'O2Sat'), sbp = latest(p, hour, 'SBP')
      return <tr key={p.id} onClick={() => openPatient(p)}><td><button className="patient-link" onClick={e => { e.stopPropagation(); openPatient(p) }}><Avatar patient={p} /><span><strong>{p.name}</strong><small>Bed {p.bed}<span className="dot-separator">·</span>{p.age ? `${Math.floor(p.age)} yrs` : 'Age unavailable'}</small></span></button></td><td>{saved.priorities[p.id] ? <span className={`manual-priority ${saved.priorities[p.id] === 'Urgent' ? 'urgent' : saved.priorities[p.id] === 'Review soon' ? 'soon' : 'routine'}`}>{saved.priorities[p.id]}<small>Clinician override</small></span> : exampleMode && p.score != null && p.band != null ? <Badge band={p.band!} /> : <span className="muted">Not scored</span>}</td><td><strong className="reading-value">{valueText(hr?.value)}</strong><span className="unit"> bpm</span>{hr && hr.hour !== hour && <small className="stale">Hour {hr.hour}</small>}</td><td><strong className="reading-value">{valueText(oxygen?.value)}</strong><span className="unit"> %</span>{oxygen && oxygen.hour !== hour && <small className="stale">Hour {oxygen.hour}</small>}</td>{full && <td><strong>{valueText(sbp?.value)}</strong><span className="unit"> mmHg</span></td>}<td><TrendChart rows={history(p, hour).slice(-12)} mini color={p.band === 'High' ? '#b54739' : p.band === 'Moderate' ? '#93630d' : '#327451'} /></td><td><ChevronRight size={16} className="row-chevron" /></td></tr>
    })}</tbody></table>{!sortedPatients.length && <Empty title="No matching patients" text="Try a different name, bed number, or monitoring focus." />}</div>
  }


  function AlertsList({ compact = false }: { compact?: boolean }) {
    const list = availableAlerts.filter(a => alertFilter === 'All' || (alertFilter === 'Active' ? alertState(a.id).status !== 'Resolved' : alertState(a.id).status === 'Resolved'))
    if (!list.length) return <Empty title={exampleMode ? 'All caught up' : 'Detector not connected'} text={exampleMode ? 'No alerts match this view at the current replay hour.' : 'Connect a detector later, or enable example outputs in settings to explore the workflow.'} />
    return <div className={compact ? 'compact-alerts' : 'alerts-list'}>{list.slice(0, compact ? 2 : undefined).map(a => {
      const p = patients.find(p => p.id === a.patientId)!
      return <div key={a.id} className={`alert-item ${a.band.toLowerCase()}`}><div className="alert-symbol"><Activity size={17} /></div><div className="alert-content"><div className="alert-title"><strong>{a.title}</strong><span>Hour {a.hour}</span></div><button className="text-link patient-alert-link" onClick={() => openPatient(p)}>{p.name} <span>· Bed {p.bed}</span></button>{!compact && <p>{a.detail}</p>}<div className="alert-bottom"><span className="tiny-label">{alertState(a.id).status} · Example</span>{alertState(a.id).status === 'Open' ? <button className="text-link" onClick={() => updateAlert(a.id, 'Acknowledged')}>Acknowledge <Check size={13} /></button> : <select aria-label={`Status for ${p.name} alert`} value={alertState(a.id).status} onChange={e => updateAlert(a.id, e.target.value as AlertState['status'])}><option>Acknowledged</option><option>In progress</option><option>Resolved</option></select>}</div></div></div>
    })}</div>
  }

  function Overview() {
    if (!patient) return <Empty title="Your ward is ready for its first patient" text="Import a PhysioNet-format PSV recording to begin."><button className="button dark" onClick={() => uploadRef.current?.click()}>Import patient</button></Empty>
    return <><div className="page-heading animate-in"><div><div className="eyebrow heading-eyebrow"><span className="live-dot" /> INTENSIVE CARE UNIT <span className="subtle-slash">/</span> WARD 04</div><h1>Ward overview<span className="heading-dot">.</span></h1><p>The details that matter. A clearer view of every patient.</p></div><button className="button secondary" onClick={() => uploadRef.current?.click()}><Plus size={16} /> Import patient</button></div>
      <div className="stats-grid animate-in">
        <div className="stat-card"><div className="stat-label">Patients monitored <Users size={17} /></div><div className="stat-main">{patients.length.toString().padStart(2, '0')}<span className="stat-tag"><span className="live-dot" />{playing ? 'Replaying' : 'Replay ready'}</span></div><div className="stat-foot">Across your demo ward</div></div>
        <div className={`stat-card ${exampleMode ? 'review-stat' : ''}`}><div className="stat-label">Needs review <Activity size={17} /></div><div className="stat-main">{exampleMode ? String(patients.filter(p => p.band === 'High').length).padStart(2, '0') : '—'}<span className="stat-tag orange">{exampleMode ? 'Example priority' : 'Not connected'}</span></div><div className="stat-foot">{exampleMode ? 'Sample model output · not a diagnosis' : 'No computed predictions available'}</div></div>
        <div className={`stat-card ${activeAlerts.length ? 'alert-stat' : ''}`}><div className="stat-label">Open alerts <Bell size={17} /></div><div className="stat-main">{String(activeAlerts.length).padStart(2, '0')}<span className="stat-micro">{activeAlerts.filter(a => alertState(a.id).status !== 'Open').length} acknowledged</span></div><div className="stat-foot">{exampleMode ? 'Example alerts for workflow preview' : 'Monitoring service not connected'}</div></div>
        <div className="stat-card"><div className="stat-label">Patient timeline <Clock3 size={17} /></div><div className="stat-main">{hour}<span className="stat-micro">/ {maxHour} hours</span></div><div className="stat-foot">Hourly records · accelerated playback</div></div>
      </div>
      <div className="overview-grid animate-in"><div className="panel patient-panel"><PanelTitle title="Your patients" subtitle="A little context. A better next decision." action={<button className="text-link" onClick={() => navigate('patients')}>View all <ArrowUpRight size={15} /></button>} /><div className="table-toolbar"><div className="filter-tabs">{['All patients', 'High', 'Moderate', 'Low'].map(f => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'High' ? 'Needs review' : f === 'Moderate' ? 'Watch closely' : f === 'Low' ? 'Routine' : f}{f === 'All patients' && <span>{patients.length}</span>}</button>)}</div><IconButton label="Search and filter patients" onClick={() => navigate('patients')}><SlidersHorizontal size={16} /></IconButton></div>{PatientTable({})}<div className="table-footer"><span><span className="live-dot" /> {patients.filter(p => p.readings.length).length} patient streams loaded</span><span>{exampleMode ? 'Priorities are example outputs' : 'Scoring unavailable'}</span></div></div>
        <div className="panel attention-panel"><PanelTitle title="On your radar" action={<span className="number-badge">{activeAlerts.length}</span>} /><div className="panel-caption">A focused view of what needs a look.</div>{AlertsList({ compact: true })}<button className="button full-width quiet" onClick={() => navigate('alerts')}>Open alert center <ArrowRight size={15} /></button><div className="radar-foot"><ShieldCheck size={15} /><span>Every insight. Your clinical judgement.</span></div></div></div>
      <div className="bottom-grid animate-in"><div className="panel trend-panel"><PanelTitle title="Behind the numbers" subtitle={`${patient.name} · Bed ${patient.bed} · Last 24 patient hours`} action={<select aria-label="Trend measurement" value={chartVital} onChange={e => setChartVital(e.target.value as VitalKey)}>{VITALS.map(v => <option key={v.key} value={v.key}>{v.short}</option>)}</select>} /><div className="trend-inline"><span className="legend-dot" style={{ background: VITALS.find(v => v.key === chartVital)?.color }} /><span>{VITALS.find(v => v.key === chartVital)?.label}</span><strong>{valueText(latest(patient, hour, chartVital)?.value)} <small>{VITALS.find(v => v.key === chartVital)?.unit}</small></strong></div><TrendChart rows={history(patient, hour).slice(-24)} vital={chartVital} color={VITALS.find(v => v.key === chartVital)!.color} /><button className="chart-patient-link text-link" onClick={() => openPatient(patient)}>Explore patient history <ArrowUpRight size={14} /></button></div>
      <div className="handover-callout"><div className="callout-top"><span className="callout-icon"><ClipboardList size={22} /></span><span className="eyebrow">CONTINUITY OF CARE</span></div><h2>A good handover.<br />A better next shift.</h2><p>Bring the readings, observations, and next steps together in one clear summary.</p><div className="callout-bottom"><div className="avatar-stack"><span className="sage">AL</span><span className="sand">MK</span><span className="rose">JT</span></div><span>Keep your care team in the loop</span></div><button className="button dark" onClick={() => { setSelectedId('p000001'); navigate('handover') }}>Prepare handover <ArrowUpRight size={16} /></button></div></div>
    </>
  }

  function PatientsPage() {
    return <><div className="page-heading animate-in"><div><span className="eyebrow">YOUR CLINICAL WORKSPACE</span><h1>Patients<span className="heading-dot">.</span></h1><p>One place for the whole picture.</p></div><button className="button secondary" onClick={() => uploadRef.current?.click()}><Upload size={16} /> Import PSV</button></div><div className="panel animate-in"><div className="patient-list-tools"><label className="search-box"><Search size={17} /><input aria-label="Search patients" placeholder="Search name, bed, or monitoring focus…" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Filter patients by example priority" value={filter} onChange={e => setFilter(e.target.value)}>{['All patients', 'High', 'Moderate', 'Low'].map(f => <option key={f}>{f}</option>)}</select></div>{PatientTable({ full: true })}<div className="table-footer"><span>{sortedPatients.length} patients · Names and profiles are fictional</span><span>Click a patient to explore</span></div></div><div className="info-strip"><BookOpen size={17} /><span>Recorded and synthetic demo sources are identified per patient. Imported recordings persist in the backend database.</span></div></>
  }

  function MetricComparison(key: string, current: Reading[], previous: Reading[], unit: string) {
    const currentMean = mean(current, key), previousMean = mean(previous, key)
    const count = (rows: Reading[]) => rows.filter(r => r[key] != null).length
    const delta = currentMean != null && previousMean != null ? currentMean - previousMean : null
    return <div className="metric-comparison">
      <div><span>Previous 6h mean</span><strong>{valueText(previousMean)}<small>{unit}</small></strong><small>{hour > 6 ? `Hours ${Math.max(1, hour - 11)}–${hour - 6} · ${count(previous)} readings` : 'No earlier period available'}</small></div>
      <div><span>Current 6h mean</span><strong>{valueText(currentMean)}<small>{unit}</small></strong><small>Hours {Math.max(1, hour - 5)}–{hour} · {count(current)} readings</small></div>
      <div><span>Change</span><strong>{delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '—'}</strong><small>{delta == null ? 'Both periods need readings' : 'Observed change only'}</small></div>
    </div>
  }

  function HistoryPanel(current: Reading[], previous: Reading[]) {
    const metrics = historyView === 'all' ? VITALS : VITALS.filter(v => v.key === chartVital)
    const showComparison = compare || patientTab === 'History & comparison'
    return <section className="panel history-panel" aria-label="Vital sign history">
      <div className="history-panel-heading"><div><h3>Every vital. Over time.</h3><p>{patient.source === 'recorded' ? 'Recorded' : 'Synthetic'} observations through patient hour {hour}.</p></div><label className="history-range-label">Time range<select aria-label="History time range" value={historyHours} onChange={e => setHistoryHours(e.target.value)}><option value="6">Last 6 hours</option><option value="12">Last 12 hours</option><option value="24">Last 24 hours</option><option value={String(maxHour)}>All available history</option></select></label></div>
      <div className="history-view-toolbar"><div className="history-view-tabs" aria-label="History display"><button className={historyView === 'all' ? 'active' : ''} aria-pressed={historyView === 'all'} onClick={() => setHistoryView('all')}>All vital signs</button><button className={historyView === 'focused' ? 'active' : ''} aria-pressed={historyView === 'focused'} onClick={() => setHistoryView('focused')}>Focused view</button></div>{patientTab === 'History & comparison' ? <span className="neutral-chip"><History size={16} /> Comparing 6h periods</span> : <button className={`button tiny ${showComparison ? 'selected-button' : 'secondary'}`} onClick={() => setCompare(v => !v)}><History size={16} />{showComparison ? 'Hide comparisons' : 'Compare periods'}</button>}</div>
      {historyView === 'focused' && <label className="focused-vital-select">Measurement<select aria-label="Focused history measurement" value={chartVital} onChange={e => setChartVital(e.target.value as VitalKey)}>{VITALS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}</select></label>}
      <div className={`history-metric-grid ${historyView === 'focused' ? 'is-focused' : ''}`}>{metrics.map(v => {
        const last = latest(patient, hour, v.key), observations = visibleRows.filter(r => r[v.key] != null)
        return <section className="history-metric-card" key={v.key} aria-label={`${v.label} history`}><div className="metric-chart-heading"><h4><span className="legend-dot" style={{ background: v.color }} />{v.label}</h4>{historyView === 'all' && <button className="text-link" aria-label={`Expand ${v.label} history`} onClick={() => { setChartVital(v.key); setHistoryView('focused') }}>Expand <ArrowUpRight size={16} /></button>}</div><div className="metric-current"><strong>{valueText(last?.value)}<small>{v.unit}</small></strong><span>{last ? `Last observed · hour ${last.hour}` : 'No observation yet'}</span></div><TrendChart rows={visibleRows} vital={v.key} color={v.color} />{showComparison && MetricComparison(v.key, current, previous, v.unit)}<div className="metric-coverage"><span>{observations.length} measurements in selected period</span>{observations.length < visibleRows.length && <span>Gaps preserved</span>}</div></section>
      })}</div>
      <details className="raw-history"><summary>Inspect recorded measurements <span>{visibleRows.length} hourly records</span></summary><div className="raw-history-scroll"><table><caption>Measurements in the selected period. A dash means no measurement was recorded.</caption><thead><tr><th>Patient hour</th>{VITALS.map(v => <th key={v.key}>{v.short}<small>{v.unit}</small></th>)}</tr></thead><tbody>{visibleRows.map(r => <tr key={r.ICULOS}><td>Hour {r.ICULOS}</td>{VITALS.map(v => <td key={v.key}>{valueText(r[v.key])}</td>)}</tr>)}</tbody></table></div></details>
      <div className="chart-note">Each measurement has its own scale and unit. Missing data stays missing; no future readings or invented values are shown.</div>
    </section>
  }

  function LaboratoryHistory(current: Reading[], previous: Reading[]) {
    const last = latest(patient, hour, labKey)
    const observations = visibleRows.filter(r => r[labKey] != null)
    const label = LABS.find(([key]) => key === labKey)?.[1] || labKey
    return <section className="panel laboratory-history animate-in" aria-label="Laboratory and additional measurement history"><div className="history-panel-heading"><div><h3>Beyond the bedside readings</h3><p>Laboratory results and additional recorded signals. Uses the same selected time range.</p></div></div><div className="additional-vitals">{ADDITIONAL_VITALS.map(v => {
      const lastValue = latest(patient, hour, v.key), count = visibleRows.filter(r => r[v.key] != null).length
      return <section key={v.key} className="additional-vital" aria-label={`${v.label} history`}><h4>{v.label}</h4><p>{lastValue ? `${valueText(lastValue.value)} ${v.unit} · last recorded at hour ${lastValue.hour}` : 'No recorded measurement through the replay hour'}</p>{count > 0 ? <TrendChart rows={visibleRows} vital={v.key} color={v.color} /> : <span className="no-observation">No measurements in selected period</span>}</section>
    })}</div><div className="lab-history-content"><label className="lab-history-selector">Laboratory / recorded measurement<select aria-label="Laboratory history measurement" value={labKey} onChange={e => setLabKey(e.target.value)}>{LABS.map(([key, name]) => <option key={key} value={key}>{name}{latest(patient, hour, key) == null ? ' · no data yet' : ''}</option>)}</select></label><div className="metric-current"><strong>{valueText(last?.value)}<small>source units</small></strong><span>{last ? `${label} · last observed at hour ${last.hour}` : `${label} · no observation yet`}</span></div><TrendChart rows={visibleRows} vital={labKey} color="#8c88a6" />{(compare || patientTab === 'History & comparison') && MetricComparison(labKey, current, previous, 'source units')}<div className="metric-coverage">{observations.length} results in selected period · original source units retained</div>{observations.length > 0 && <div className="lab-result-list" aria-label={`${label} results`}>{observations.map(r => <div key={r.ICULOS}><span>Patient hour {r.ICULOS}</span><strong>{valueText(r[labKey])}</strong></div>)}</div>}</div></section>
  }

  function PatientDetail() {
    const events = sessionEvents.filter(e => e.patientId === patient.id)
    const currentPeriod = history(patient, hour).filter(r => r.ICULOS > hour - 6)
    const previousPeriod = history(patient, hour).filter(r => r.ICULOS > hour - 12 && r.ICULOS <= hour - 6)
    return <><button className="back-link text-link" onClick={() => navigate('patients')}><ArrowLeft size={15} /> All patients</button><div className="patient-detail-heading animate-in"><div className="patient-identity"><Avatar patient={patient} /><div><div className="identity-meta">BED {patient.bed} <span>·</span> {patient.id}</div><h1>{patient.name}</h1><p>{patient.age == null ? 'Age unavailable' : `${Math.floor(patient.age)} years`} · {patient.sex} <span>·</span> <span className="source-label">{patient.source === 'recorded' ? 'Recorded readings' : 'Synthetic readings'}</span></p></div></div><div className="heading-actions"><button className="button secondary" onClick={() => openSheet('chat')}><Sparkles size={16} /> Ask VitalWatch</button><button className="button dark" onClick={() => navigate('handover')}><ClipboardList size={16} /> Handover</button></div></div>
      <div className="patient-tabs animate-in">{['Overview', 'History & comparison', 'Care timeline', 'Patient context'].map(t => <button key={t} className={patientTab === t ? 'active' : ''} onClick={() => { setPatientTab(t); if (t === 'History & comparison') setHistoryView('all') }}>{t}</button>)}</div>
      {patientTab === 'Patient context' ? <div className="context-grid animate-in"><div className="panel padded"><h3>Clinical profile</h3><div className="notice small-notice">This is fictional demo context, separate from the PhysioNet measurements.</div><h4>Known conditions</h4>{patient.conditions.map(c => <p key={c}>{c}</p>)}<h4>Medications</h4>{patient.medications.map(m => <p key={m}>{m}</p>)}</div><div className="panel padded"><h3>Reading provenance</h3><p>{patient.source === 'recorded' ? `Source: ${patient.id === 'p000001' ? 'PhysioNet Challenge 2019 · p000001.psv' : 'User-imported recording'}` : 'Source: deterministically generated synthetic demo readings.'}</p><p>Each row represents a patient-hour. Displayed readings are limited to the current replay position.</p><a className="text-link" href="https://physionet.org/content/challenge-2019/1.0.0/" target="_blank" rel="noreferrer">View dataset documentation <ExternalLink size={14} /></a></div></div> : patientTab === 'Care timeline' ? <div className="panel padded animate-in"><PanelTitle title="A record of care" subtitle={`Events through patient hour ${hour} · This replay session`} action={<button className="button secondary" onClick={() => openSheet('note')}><Plus size={15} /> Add note</button>} />{events.length ? <div className="timeline">{events.map(e => <div className="timeline-item" key={e.id}><span className="timeline-marker"><Check size={13} /></span><div><small>Hour {e.hour} · {e.actorName}</small><h4>{e.kind}</h4><p>{e.text}</p></div></div>)}</div> : <Empty title="The next step starts here" text="Acknowledge an alert, update a focus, or add a caregiver note. Your actions will appear in this timeline."><button className="button secondary" onClick={() => openSheet('note')}>Add first note</button></Empty>}</div> : <>
        <div className="focus-bar animate-in"><span className="focus-symbol"><Stethoscope size={19} /></span><div><small>MONITORING FOCUS</small><strong>{focusOf(patient)}</strong></div><span className="focus-confirmed"><Check size={13} /> Clinician-selected demo focus</span><button className="text-link" onClick={() => openSheet('focus')}>Change focus <ChevronRight size={15} /></button></div>
        <div className="vitals-grid animate-in">{VITALS.map(v => { const l = latest(patient, hour, v.key); return <button key={v.key} className={`vital-card ${chartVital === v.key ? 'selected' : ''}`} onClick={() => { setChartVital(v.key); setHistoryView('focused') }}><div><span>{v.short}</span><span className="vital-dot" style={{ background: v.color }} /></div><strong>{valueText(l?.value)}<small>{v.unit}</small></strong><small className={l && hour - l.hour > 3 ? 'stale' : ''}>{l ? l.hour === hour ? `Recorded at hour ${l.hour}` : `Last recorded · hour ${l.hour}` : 'No measurement available'}</small></button> })}</div>
        <div className="detail-grid animate-in">{HistoryPanel(currentPeriod, previousPeriod)}
        <div className="panel review-panel"><PanelTitle title="Review insights" action={<span className="example-pill">{exampleMode ? 'Example' : 'Not connected'}</span>} />{exampleMode && patient.score != null && patient.band != null ? <><div className="risk-display"><Badge band={patient.band!} /><span className={`risk-score ${patient.band!.toLowerCase()}`}>{patient.score!.toFixed(2)}<small>sample score</small></span></div><p>Illustrative sepsis-model output. No model has processed this patient. The backend is returning a labelled example.</p><div className="insight-separator" /><h4>Personal baseline</h4><p>Previous/current period comparison is available. A validated deviation detector is not connected.</p></> : <Empty title="Awaiting model connection" text="Scores will appear here when the prediction service is connected." />}<button className="button full-width secondary" onClick={() => openSheet('evidence')}><BookOpen size={15} /> View supporting data</button><button className="text-link override-link" onClick={() => openSheet('priority')}>Set clinical review priority <ArrowRight size={14} /></button>{saved.priorities[patient.id] && <div className="override-label">Clinician override: {saved.priorities[patient.id]}</div>}</div></div>
        {LaboratoryHistory(currentPeriod, previousPeriod)}
        <div className="detail-bottom-grid animate-in"><div className="panel padded"><PanelTitle title="Laboratory observations" subtitle="Last available result and its original patient hour" /> <div className="lab-grid">{[['WBC', 'White blood cells'], ['Glucose', 'Glucose'], ['Creatinine', 'Creatinine'], ['Platelets', 'Platelets']].map(([key, label]) => { const l = latest(patient, hour, key); return <div key={key}><span>{label}</span><strong>{valueText(l?.value)}</strong><small>{l ? `Hour ${l.hour} · source units` : 'No result available'}</small></div> })}</div></div><div className="panel padded"><PanelTitle title="Care notes" action={<button className="text-link" onClick={() => openSheet('note')}><Plus size={14} /> Add note</button>} />{events.filter(e => e.kind === 'Care note').length ? events.filter(e => e.kind === 'Care note').slice(0, 2).map(e => <div className="note-item" key={e.id}><small>Hour {e.hour} · {e.actorName}</small><p>{e.text}</p></div>) : <p className="muted">No notes yet. Capture an observation for the next caregiver.</p>}</div></div>
      </>}
    </>
  }

  function AlertPage() { return <><div className="page-heading animate-in"><div><span className="eyebrow">FROM SIGNAL TO ACTION</span><h1>Alert center<span className="heading-dot">.</span></h1><p>Review the evidence. Record the next step.</p></div><span className="neutral-chip"><ShieldCheck size={15} /> Example outputs only</span></div><div className="panel alerts-page animate-in"><div className="table-toolbar"><div className="filter-tabs">{['Active', 'Resolved', 'All'].map(t => <button key={t} className={alertFilter === t ? 'active' : ''} onClick={() => setAlertFilter(t)}>{t}</button>)}</div><span className="muted small-text">Through patient hour {hour}</span></div>{AlertsList({})}</div><div className="info-strip"><CircleHelp size={17} /><span>These alerts demonstrate the care workflow. They are not generated from the readings and must not guide clinical decisions.</span></div></> }

  function HandoverPage() {
    if (!patient) return <Empty title="No patient selected" text="Import or select a patient to prepare a handover." />
    const draftKey = `${session}:${patient.id}`, meta = draftMeta[draftKey]
    const updates = saved.updates.filter(u => u.patientId === patient.id)
    const dirty = draftKey in draftEdits
    return <>
      <div className="page-heading animate-in"><div><span className="eyebrow">CARE THAT CONTINUES</span><h1>Shift handover<span className="heading-dot">.</span></h1><p>The right context, ready for the next caregiver.</p></div><select aria-label="Choose patient for handover" value={selectedId} onChange={e => setSelectedId(e.target.value)}>{patients.map(p => <option key={p.id} value={p.id}>{p.name} · Bed {p.bed}</option>)}</select></div>
      <div className="handover-grid animate-in"><div className="panel padded"><PanelTitle title="Clinical handover" subtitle={`${patient.name} · Bed ${patient.bed}`} action={<span className="neutral-chip small-chip">Editable draft</span>} /><div className="notice small-notice"><FileText size={16} /><span>Built on the server from the recorded snapshot using a template. No AI was used. Review before sharing.</span></div>
      {!meta ? <Empty title="Make the next shift a little clearer" text="Bring together measurements, recorded actions, and outstanding example alerts."><button className="button dark" disabled={busy} onClick={generateHandover}><ClipboardList size={16} /> Create structured draft</button></Empty> : <>
        <div className="draft-status">Snapshot: patient hour {meta.hour} · Revision {meta.revision}{dirty && <strong>Unsaved edits</strong>}</div>
        <textarea className="handover-editor" aria-label="Editable handover draft" value={draftEdits[draftKey] ?? saved.drafts[draftKey]} onChange={e => { setDraftEdits(s => ({ ...s, [draftKey]: e.target.value })); setEditRevisions(s => ({ ...s, [draftKey]: s[draftKey] ?? meta.revision })) }} />
        <div className="editor-actions"><button className="button secondary" disabled={busy} onClick={generateHandover}><RotateCcw size={14} /> Regenerate</button><button className="button dark" disabled={busy || !dirty} onClick={saveHandover}><Check size={14} /> Save draft</button><button className="button secondary" disabled={busy} onClick={exportHandover}><Download size={14} /> Export</button></div>
        {dirty && <button className="text-link" onClick={() => discardDraft(draftKey)}>Discard local edits and reload the saved version</button>}
        <small className="muted">Saved drafts persist in the database. Save changes before leaving or refreshing.</small>
      </>}</div>
      <div className="panel padded"><PanelTitle title="A note for the family" subtitle="Only explicitly approved updates appear for assigned family accounts." /><label className="field-label" htmlFor="family-note">Plain-language update</label><textarea id="family-note" className="text-area" placeholder="Write a reviewed update for the patient and their family…" value={familyInput} onChange={e => setFamilyInput(e.target.value)} rows={5} maxLength={16000} /><button className="button dark full-width" disabled={busy || !familyInput.trim()} onClick={approveFamilyUpdate}><CheckCheck size={16} /> Approve & share update</button><div className="approved-updates">{updates.map(u => <div className="approved-update" key={u.id}><span><Check size={13} /> Approved · Hour {u.hour}</span><p>{u.text}</p><button disabled={busy} className="text-link" onClick={() => perform(() => command(`/updates/${u.id}/withdraw`), 'Update withdrawn from family access')}>Withdraw update</button></div>)}</div></div></div>
    </>
  }

  function FamilyPage() {
    if (!familyView) return <Empty title="Loading permitted patient information" text="Retrieving the family view from the server." />
    if (!familyView.patients.length) return <Empty title="No patient assigned yet" text="Your account has no patient assignment. Please contact your care team." />
    return <>
      <div className="page-heading animate-in"><div><span className="eyebrow">PATIENT & FAMILY</span><h1>A little closer to care<span className="heading-dot">.</span></h1><p>Selected readings and reviewed updates from your care team.</p></div></div>
      <div className="notice animate-in"><ShieldCheck size={18} /><span>{user?.role === 'clinician' ? 'Clinician preview of the restricted family response. Only the three shared measurements and approved updates are included.' : 'Your account can access only assigned patients, three shared measurements, and approved updates. Your care team can explain what the readings mean.'}</span></div>
      {familyView.patients.map(p => <section key={p.id}>
        <div className="family-intro animate-in"><span className="avatar rose">{p.initials}</span><div><h2>{p.name}</h2><p>Bed {p.bed} · {p.source === 'recorded' ? 'Recorded measurements' : 'Synthetic demo measurements'} · Patient hour {familyView.hour} · Fictional demo identity</p></div></div>
        <div className="vitals-grid family-vitals animate-in">{VITALS.slice(0, 3).map(v => { const l = latest(p, familyView.hour, v.key); return <div className="vital-card" key={v.key}><div><span>{v.label}</span><Heart size={15} style={{ color: v.color }} /></div><strong>{valueText(l?.value)}<small>{v.unit}</small></strong><small>{l ? `Last recorded at patient hour ${l.hour}` : 'No measurement available'}</small></div> })}</div>
        <div className="context-grid animate-in"><div className="panel padded"><PanelTitle title="Updates from your care team" subtitle="Reviewed by a clinician before being shared" />{p.updates.length ? p.updates.map(u => <div className="approved-update" key={u.id}><span><ShieldCheck size={14} /> {u.approvedBy} · Hour {u.hour}</span><p>{u.text}</p></div>) : <Empty title="Your care team will keep you posted" text="There are no published updates at the current patient hour." />}</div><div className="panel padded"><PanelTitle title="Readings over time" subtitle="Shared measurements through the current patient hour" action={<select aria-label="Family history measurement" value={familyVital} onChange={e => setFamilyVital(e.target.value as VitalKey)}>{VITALS.slice(0, 3).map(v => <option key={v.key} value={v.key}>{v.label}</option>)}</select>} /><TrendChart rows={history(p, familyView.hour).slice(-24)} vital={familyVital} color={VITALS.find(v => v.key === familyVital)!.color} /><p className="small-text muted">Readings provide context and are not a diagnosis. Speak with the care team about questions.</p></div></div>
      </section>)}
    </>
  }

  function SettingsPage() {
    return <><div className="page-heading animate-in"><div><span className="eyebrow">A TRANSPARENT WORKSPACE</span><h1>Workspace settings<span className="heading-dot">.</span></h1><p>Know what is connected, recorded, and simulated.</p></div></div><div className="settings-grid animate-in"><div className="panel padded"><h3>Ward preferences</h3><div className="setting-row"><div><strong>Example prediction outputs</strong><p>Use labelled fixtures for scores and alerts. The real detectors remain disconnected. This setting is shared across the ward.</p></div><button disabled={busy} role="switch" aria-checked={exampleMode} aria-label="Example prediction outputs" className={`toggle ${exampleMode ? 'on' : ''}`} onClick={() => controlPlayback({ example_mode: !exampleMode })}><span /></button></div><div className="setting-row"><div><strong>Replay speed</strong><p>Seconds per recorded patient-hour. Only clinicians can change playback.</p></div><select disabled={busy} aria-label="Replay speed" value={speed} onChange={e => controlPlayback({ speed: Number(e.target.value) })}><option value="1">1 second</option><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="10">10 seconds</option></select></div><div className="setting-row"><div><strong>Start a new replay</strong><p>Archive the current session and its care actions. Existing records are retained.</p></div><button className="button secondary" disabled={busy} onClick={() => { if (window.confirm('Archive this replay and start again at hour 1 for everyone viewing the ward?')) void perform(() => command('/replay/restart'), 'New replay started; earlier actions remain archived') }}>New session</button></div></div><div className="panel padded"><h3>Connection status</h3>{[['Patient data', 'Database-backed recordings and synthetic demo', true], ['Sepsis predictor', 'Template ready · not connected', false], ['Baseline detector', 'Template ready · not connected', false], ['Gemini', 'Template ready · no external calls', false], ['Backend & accounts', 'Connected · role-restricted access', true], ['LinuxONE deployment', 'Planned for later', false]].map(([title, detail, connected]) => <div className="connection-row" key={String(title)}><span className={`connection-dot ${connected ? 'connected' : ''}`} /><div><strong>{title}</strong><small>{detail}</small></div>{connected ? <Check size={16} /> : <Link2 size={15} className="muted" />}</div>)}</div></div><div className="info-strip"><ShieldCheck size={17} /><span>Signed in as {user?.name}. Care actions persist on the server; scores remain demonstration examples.</span></div><button className="button secondary" onClick={logout}>Sign out</button></>
  }

  if (booting) return <main className="connection-screen"><Activity size={32} /><h1>Opening your workspace…</h1></main>
  if (!user) return <LoginScreen connectionError={apiError} onSignedIn={auth => { epoch.current++; setCsrf(auth.csrf_token); setUser(auth.user); setApiError(''); setLoading(true); setPage(auth.user.role === 'family' ? 'family' : 'overview') }} />
  if (loading) return <main className="connection-screen"><Activity size={32} /><h1>Loading your permitted patient data…</h1></main>
  if (apiError && !patients.length && !familyView) return <main className="connection-screen"><Activity size={32} /><h1>Workspace unavailable</h1><p>{apiError}</p><button className="button dark" onClick={() => refresh()}>Retry connection</button><button className="button secondary" onClick={logout}>Sign out</button></main>

  const nav = [{ page: 'overview' as Page, label: 'Overview', icon: LayoutDashboard }, { page: 'patients' as Page, label: 'Patients', icon: Users }, { page: 'alerts' as Page, label: 'Alert center', icon: Bell }, { page: 'handover' as Page, label: 'Handover', icon: ClipboardList }]
  const pageName = page === 'patient' ? patient?.name || 'Patient' : ({ overview: 'Overview', patients: 'Patients', alerts: 'Alert center', handover: 'Handover', family: user.role === 'family' ? 'Patient & family' : 'Family preview', settings: 'Settings' } as Record<string, string>)[page]

  return <div className="app-shell">{user.role === 'clinician' && <input type="file" accept=".psv" ref={uploadRef} className="sr-only" aria-label="Import patient PSV file" onChange={e => importFile(e.target.files?.[0])} />}
    {menuOpen && <div className="mobile-nav-scrim" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}><button className="brand" onClick={() => navigate('overview')} aria-label="VitalWatch overview"><span className="brand-mark"><Activity size={25} strokeWidth={2} /></span><span>vitalwatch<span className="brand-period">.</span></span></button><div className="workspace-selector"><span className="hospital-icon"><Plus size={17} /></span><div><strong>{user.role === 'clinician' ? 'Clinical workspace' : 'Family workspace'}</strong><small>Hospital demo</small></div><span className="workspace-check"><Check size={12} /></span></div><span className="nav-group-label">WORKSPACE</span><nav aria-label="Main navigation">{nav.filter(() => user.role === 'clinician').map(n => <button key={n.page} className={`nav-item ${page === n.page || page === 'patient' && n.page === 'patients' ? 'active' : ''}`} onClick={() => navigate(n.page)}><n.icon size={18} strokeWidth={1.7} /><span>{n.label}</span>{n.page === 'alerts' && activeAlerts.length > 0 && <span className="nav-count">{activeAlerts.length}</span>}{n.page === 'overview' && <span className="nav-active-dot" />}</button>)}</nav><span className="nav-group-label second-group">CARE CONNECTION</span><button className={`nav-item ${page === 'family' ? 'active' : ''}`} onClick={() => navigate('family')}><Heart size={18} strokeWidth={1.7} /><span>Patient & family</span><ArrowUpRight size={14} className="nav-external" /></button><div className="sidebar-bottom"><div className="sidebar-note"><span className="sidebar-note-symbol"><Waves size={21} /></span><strong>More clarity.<br />More connected care.</strong><p>Patient context, brought together.</p><button className="text-link" onClick={() => setSheet('help')}>About this workspace <ArrowUpRight size={13} /></button></div>{user.role === 'clinician' && <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18} strokeWidth={1.7} /><span>Settings</span></button>}<button className="nav-item" onClick={() => setSheet('help')}><CircleHelp size={18} strokeWidth={1.7} /><span>Help & resources</span></button><button className="nav-item" onClick={logout}><ArrowLeft size={18} /><span>Sign out</span></button><div className="sidebar-version"><span className="live-dot" /> Connected workspace <span>v1.0</span></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><IconButton className="mobile-menu" label="Open navigation" onClick={() => setMenuOpen(v => !v)}><Menu size={20} /></IconButton><span>Workspace</span><ChevronRight size={13} /><strong>{pageName}</strong></div><div className="topbar-right"><span className="environment-tag"><span className="live-dot" /> Demo workspace</span><span className="topbar-divider" />{user.role === 'clinician' && <IconButton label="Open alerts" onClick={() => navigate('alerts')}><span className="notification-bell"><Bell size={18} />{activeAlerts.length > 0 && <i />}</span></IconButton>}<button className="user-button" onClick={() => user.role === 'clinician' ? navigate('settings') : logout()} aria-label={`${user.name} account`}><span className="user-avatar">{user.name.split(' ').filter(w => w !== 'Dr.').slice(0, 2).map(w => w[0]).join('')}</span><span><strong>{user.name}</strong><small>{user.role === 'clinician' ? 'Clinical account' : 'Family account'}</small></span><ChevronDown size={13} /></button></div></header>
    <main ref={mainRef}><div className="workspace-content">{apiError && <div className="notice error-notice" role="alert">{apiError}<button className="text-link" onClick={() => refresh()}>Retry</button></div>}{page === 'overview' ? Overview() : page === 'patients' ? PatientsPage() : page === 'patient' ? patient ? PatientDetail() : <Empty title="No patient selected" text="Select a patient from the ward." /> : page === 'alerts' ? AlertPage() : page === 'handover' ? HandoverPage() : page === 'family' ? FamilyPage() : SettingsPage()}
    <footer className="workspace-footer"><span><Activity size={13} /> Thoughtfully connected care.</span><span>Database connected <span>·</span> No live clinical predictions</span></footer></div></main>
    {user.role === 'clinician' ? <div className="replay-bar"><div className="replay-label"><span className={`live-dot ${playing ? 'pulsing' : ''}`} /><strong>Shared ward replay</strong><span>Hourly data</span></div><div className="replay-controls"><IconButton label={playing ? 'Pause replay' : 'Play replay'} className="play-button" onClick={() => { if (!busy) void controlPlayback({ playing: !playing, ...(hour >= maxHour ? { hour: 1 } : {}) }) }}>{playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</IconButton><input type="range" min="1" max={maxHour} value={seekHour ?? hour} aria-label="Replay patient hour" disabled={busy} onChange={e => { const value = Number(e.target.value); seekRef.current = value; setSeekHour(value) }} onPointerUp={commitSeek} onKeyUp={e => { if (['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.key)) commitSeek() }} onBlur={commitSeek} /><span className="replay-hour">Hour <strong>{seekHour ?? hour}</strong><span> / {maxHour}</span></span><select aria-label="Playback speed" disabled={busy} value={speed} onChange={e => controlPlayback({ speed: Number(e.target.value) })}><option value="1">1s / hour</option><option value="3">3s / hour</option><option value="5">5s / hour</option><option value="10">10s / hour</option></select><IconButton label="Restart replay session" onClick={() => { if (!busy && window.confirm('Start a new shared replay? Existing actions will remain archived.')) void perform(() => command('/replay/restart'), 'New replay session started') }}><RotateCcw size={15} /></IconButton></div><button className="replay-mode" onClick={() => navigate('settings')}><span className={exampleMode ? 'example-dot' : 'connection-dot'} />{exampleMode ? 'Example insights on' : 'Models disconnected'}<Settings2 size={13} /></button></div> : <div className="replay-bar family-status-bar"><ShieldCheck size={18} /><span>Assigned patient information only</span><span>Patient hour {hour} · Updates automatically</span></div>}</div>
    {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast}<IconButton label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></IconButton></div>}
    {sheet && <SheetFrame title={sheet === 'help' ? 'Built for a clearer picture' : sheet === 'focus' ? 'Monitoring focus' : sheet === 'chat' ? 'Ask VitalWatch' : sheet === 'evidence' ? 'The evidence, in context' : sheet === 'priority' ? 'Clinical review priority' : 'Add a care note'} eyebrow={sheet === 'help' ? 'ABOUT VITALWATCH' : `${patient.name} · Bed ${patient.bed}`} onClose={() => setSheet(null)}>
      {sheet === 'help' && <div className="sheet-body"><div className="about-mark"><Activity size={35} /></div><h3>Thoughtfully connected care.</h3><p>VitalWatch brings patient readings, history, observations, and care workflows into one clinical workspace.</p><div className="notice small-notice">Accounts and care records are connected to the backend. The trained detector and Gemini remain disconnected; all scores and alerts marked example are illustrative.</div><h4>Explore the demo</h4><p>Use the playback bar to move through hourly patient recordings. Open a patient to compare periods, record a note, change focus, or prepare a handover.</p><h4>What is real?</h4><p>Recorded and synthetic demo sources are identified per patient. Names and added profiles are fictional. Example scores and alerts are not clinical predictions. Family accounts receive only assigned patient readings and approved updates.</p><a className="button secondary full-width" href="https://physionet.org/content/challenge-2019/1.0.0/" target="_blank" rel="noreferrer">Dataset documentation <ExternalLink size={15} /></a></div>}
      {sheet === 'note' && <form className="sheet-body" onSubmit={e => { e.preventDefault(); void saveNote() }}><p>Add an observation or next step to this patient's care timeline.</p><label className="field-label" htmlFor="care-note">Caregiver note</label><textarea id="care-note" className="text-area" rows={7} value={note} onChange={e => setNote(e.target.value)} placeholder="What should the next caregiver know?" required /><div className="form-context"><Clock3 size={14} /> Patient hour {hour} · {user?.name}</div><button className="button dark full-width" type="submit" disabled={busy || !note.trim()}>Save care note <Check size={15} /></button></form>}
      {sheet === 'priority' && <form className="sheet-body" onSubmit={e => { e.preventDefault(); void savePriority() }}><p>Your review priority is recorded separately from any sample model output.</p><label className="field-label" htmlFor="priority">Review priority</label><select id="priority" className="full-width" value={priorityInput} onChange={e => setPriorityInput(e.target.value)}><option>Urgent</option><option>Review soon</option><option>Routine</option></select><label className="field-label" htmlFor="override-reason">Reason for your decision</label><textarea id="override-reason" className="text-area" rows={5} value={overrideReason} onChange={e => setOverrideReason(e.target.value)} required placeholder="Record your clinical reasoning…" /><button className="button dark full-width" type="submit" disabled={busy || !overrideReason.trim()}>Confirm priority <Check size={15} /></button>{saved.priorities[patient.id] && <button className="button quiet full-width" type="button" onClick={() => savePriority(true)}>Remove existing override</button>}</form>}
      {sheet === 'focus' && <form className="sheet-body" onSubmit={e => { e.preventDefault(); void saveFocus() }}><p>Choose a focus for the care team. The selection does not change model thresholds or create a diagnosis.</p><label className="field-label" htmlFor="condition-focus">Condition or monitoring focus</label><input id="condition-focus" className="text-input" value={focusInput} onChange={e => setFocusInput(e.target.value)} placeholder="Type a condition or focus…" required /><div className="focus-options">{['Sepsis monitoring', 'Respiratory monitoring', 'Cardiovascular monitoring', 'General monitoring'].map(f => <button type="button" className={focusInput === f ? 'chosen' : ''} key={f} onClick={() => setFocusInput(f)}>{f}{focusInput === f && <Check size={15} />}</button>)}</div><div className="notice small-notice"><BookOpen size={17} /><span>{['Sepsis monitoring', 'Respiratory monitoring', 'Cardiovascular monitoring', 'General monitoring'].includes(focusInput) ? 'Selection labels the patient’s monitoring focus. Automated guidance and AI recommendations will be connected later.' : 'Custom focus accepted. Condition-specific guidance is not available in this prototype.'}</span></div><button className="button dark full-width" type="submit" disabled={busy || !focusInput.trim()}>Confirm monitoring focus <Check size={15} /></button></form>}
      {sheet === 'evidence' && <div className="sheet-body"><div className="notice small-notice">No computed model contributions are available. The measurements below are actual observations from the selected demo stream.</div><h4>Latest available measurements</h4><div className="evidence-list">{VITALS.map(v => { const l = latest(patient, hour, v.key); return <div key={v.key}><span>{v.label}<small>{l ? `Recorded at patient hour ${l.hour}` : 'Not recorded'}</small></span><strong>{valueText(l?.value)} <small>{v.unit}</small></strong></div> })}</div><h4>Provenance</h4><p>{patient.source === 'recorded' ? `Recorded source: ${patient.id === 'p000001' ? 'PhysioNet Challenge 2019, p000001.psv' : 'Imported patient file'}.` : 'Deterministically generated synthetic demo data.'} Patient identity and added clinical context are fictional.</p><a className="text-link" href="https://physionet.org/content/challenge-2019/1.0.0/" target="_blank" rel="noreferrer">Dataset fields and definitions <ExternalLink size={14} /></a><div className="insight-separator" /><h4>Model status</h4><p>Sepsis predictor and personal-baseline detector are not connected. Example outputs demonstrate interface behavior only.</p></div>}
      {sheet === 'chat' && <div className="chat-layout"><div className="chat-connection"><span className="connection-dot" /> AI not connected <span>Interface preview</span></div><div className="chat-messages">{messages.length === 0 ? <div className="chat-welcome"><div className="chat-welcome-icon"><Sparkles size={25} /></div><h3>A question.<br />A little more context.</h3><p>Once connected, VitalWatch will use this patient's available data and cited references to help answer your questions.</p><div className="prompt-list">{['What changed in the last six hours?', 'What readings are missing?', 'Summarize this patient for handover.'].map(q => <button key={q} onClick={() => setChatInput(q)}>{q}<ArrowUpRight size={14} /></button>)}</div><button className="text-link" onClick={() => perform(() => command(`/patients/${patient.id}/messages/example`))}>View labelled example conversation <ArrowRight size={14} /></button></div> : messages.map((m, i) => <div className={`chat-message ${m.role}`} key={i}><span>{m.role === 'user' ? 'You' : m.origin === 'example' ? 'Labelled example' : 'System · AI disconnected'}</span><p>{m.text}</p></div>)}</div><form className="chat-composer" onSubmit={e => { e.preventDefault(); void sendQuestion() }}><textarea aria-label="Ask a patient question" placeholder="Ask about this patient…" value={chatInput} onChange={e => setChatInput(e.target.value)} rows={2} /><button type="submit" className="send-button" aria-label="Send question" disabled={busy || !chatInput.trim()}><ArrowUpRight size={18} /></button><small>Conversations are saved to your account. No data is sent to an AI service.</small></form></div>}
    </SheetFrame>}
  </div>
}
