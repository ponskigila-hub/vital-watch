import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart2, BookOpen } from 'react-feather'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { chatBlocks, chatMeasurements, chatSeries, type ChatSeries } from '../chat'
import { valueText } from '../data'
import type { Generation } from './PatientGuidance'
import './chat-reply.css'

function statistics(text: string): ReactNode[] {
  return text.split(/((?:-?\d+(?:\.\d+)?\s*(?:mmHg|bpm|°C|\/min|%))|(?:(?:model\s+score|score|threshold)\s*(?:of\s+|is\s+|[:=]\s*)?\d+(?:\.\d+)?))/gi).map((part, i) => i % 2 ? <strong key={i}>{part}</strong> : part)
}
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') || part.startsWith('__')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`')) return <span key={i}>{part.slice(1, -1)}</span>
    return <span key={i}>{statistics(part)}</span>
  })
}
function sourceText(id: string, raw: unknown): string {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const [, key] = id.split(':')
  const measurement = chatMeasurements[key]
  if (id.startsWith('observation:') || id.startsWith('latest:')) return `${measurement?.label || key}: ${valueText(row.value as number | null)} ${measurement?.unit || 'source units'} · Hour ${row.hour ?? 'unavailable'}`
  if (id.startsWith('trend:')) return `${measurement?.label || key} · 6h averages: ${valueText(row.previous_mean as number | null)} → ${valueText(row.recent_mean as number | null)} ${measurement?.unit || ''}`
  if (id === 'prediction:current') {
    const s = row.sepsis as Record<string, unknown> | undefined
    return s?.score != null ? `Sepsis model score ${Number(s.score).toFixed(4)} · threshold ${s.alert_threshold == null ? 'unavailable' : Number(s.alert_threshold).toFixed(4)} · Hour ${row.as_of_hour}` : 'Sepsis scoring unavailable for this snapshot'
  }
  if (id === 'prediction:history') return `Saved score history · ${Array.isArray(raw) ? raw.length : 0} patient hours`
  if (id === 'care:focus') return `Monitoring focus: ${String(raw)}`
  if (id === 'care:priority') return `Clinician priority: ${String(raw)}`
  if (id.startsWith('alert:')) return `Alert at hour ${row.hour} · ${row.status}`
  if (id.startsWith('care:')) return `Recorded care action · Hour ${row.hour} · ${row.status || 'Recorded'}`
  if (id.startsWith('note:')) return `Recorded note · Hour ${row.hour}: ${String(row.text || '')}`
  if (id === 'context:profile') return 'Approved fictional patient background'
  if (id === 'workflow:catalogue') return 'Application review-workflow catalogue'
  if (id === 'data:quality') return 'Recorded observation timing and missing-data information'
  return 'Supplied supporting evidence'
}
function SnapshotChart({ series }: { series: ChatSeries }) {
  const score = series.key === 'score'
  const format = (n: number) => score ? n.toFixed(4) : valueText(n)
  return <div className="chat-snapshot-chart">
    <div className="chat-chart-title"><strong>{series.label}</strong><span>{series.unit}</span></div>
    <div className="chat-chart-plot" role="img" aria-label={`${series.label} from saved reply evidence. Missing readings remain gaps.`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={series.rows} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="#dbe5ee" strokeDasharray="3 5" />
        <XAxis dataKey="hour" type="number" domain={['dataMin', 'dataMax']} tickFormatter={h => `${h}h`} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} minTickGap={26} />
        <YAxis domain={score ? [0, 'auto'] : ['auto', 'auto']} tickFormatter={n => format(Number(n))} width={score ? 64 : 46} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
        <Tooltip labelFormatter={h => `Patient hour ${h}`} formatter={v => [`${format(Number(v))} ${score ? '' : series.unit}`, series.label]} contentStyle={{ borderRadius: 12, fontSize: 14 }} />
        <Line dataKey="value" type="linear" stroke="#0077b6" strokeWidth={2.5} dot={{ r: 3, fill: '#0077b6', strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
        {series.threshold != null && <ReferenceLine y={series.threshold} stroke="#924000" strokeDasharray="5 4" ifOverflow="extendDomain" />}
      </LineChart></ResponsiveContainer>
    </div>
    <small>{score ? 'Research score, not a probability. Dashed line: alert threshold.' : 'Recorded observations · missing readings stay blank.'}</small>
  </div>
}
export function ChatReply({ text, generationId }: { text: string; generationId?: string }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = root.current, scroller = element?.closest('.chat-messages')
    if (element && scroller) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24
  }, [text])
  const [job, setJob] = useState<Generation | null>(null)
  const [panel, setPanel] = useState<'sources' | 'chart' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  async function open(next: 'sources' | 'chart') {
    setPanel(panel === next ? null : next)
    if (job || !generationId || loading) return
    setLoading(true); setError('')
    try { setJob(await api<Generation>(`/language/jobs/${generationId}`)) }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  const ids = job?.result.evidence_ids || []
  const series = job ? chatSeries(job.evidence, ids, job.hour) : []
  const chart = series.find(s => s.key === selected) || series[0]
  return <div ref={root} className="chat-reply">
    <div className="chat-rich-text">{chatBlocks(text).map((block, i) => block.kind === 'bullets' ? <ul key={i}>{block.lines.map((line, n) => <li key={n}>{inline(line)}</li>)}</ul> : block.kind === 'ordered' ? <ol key={i}>{block.lines.map((line, n) => <li key={n}>{inline(line)}</li>)}</ol> : block.kind === 'heading' ? <h4 key={i}>{inline(block.lines.join(' '))}</h4> : <p key={i}>{inline(block.lines.join(' '))}</p>)}</div>
    {generationId && <div className="chat-reply-tools"><button type="button" className="text-link" aria-expanded={panel === 'sources'} onClick={() => void open('sources')}><BookOpen size={15} />Sources</button>{/trend|chang|rising|fall|hour|previous|earlier/i.test(text) && <button type="button" className="text-link" aria-expanded={panel === 'chart'} onClick={() => void open('chart')}><BarChart2 size={15} />View chart</button>}</div>}
    {panel && loading && <p role="status">Loading saved evidence…</p>}
    {panel && error && <p role="status">{error}</p>}
    {panel === 'sources' && job && <div className="chat-readable-sources"><strong>Evidence at patient hour {job.hour}</strong><ul>{[...new Set(ids)].map(id => <li key={id}>{sourceText(id, job.evidence[id])}</li>)}</ul>{job.references.filter(r => job.result.citations?.includes(r.id)).map(r => <p key={r.id}>{/^https?:\/\//i.test(r.url) ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}</p>)}<small>Generated from this saved snapshot. Reference material is not clinically reviewed.</small></div>}
    {panel === 'chart' && job && <div className="chat-chart-panel">{series.length > 1 && <label>Measurement<select value={chart.key} onChange={e => setSelected(e.target.value)}>{series.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>}{chart ? <><SnapshotChart series={chart} /><small>Reply snapshot · patient hour {job.hour}</small></> : <p>No repeated supported measurements to plot in this reply.</p>}</div>}
  </div>
}
