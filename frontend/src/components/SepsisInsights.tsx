import type { ReactNode } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen, CheckCircle, ChevronDown, Clipboard, Clock, FileText, Info, Minus, UserCheck } from 'react-feather'
import { Area, CartesianGrid, ComposedChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { VITALS, valueText, type Patient } from '../data'
import { reviewState, scoreSummary, vitalChanges, type ReviewAlert } from '../sepsis'
import './sepsis-insights.css'
import './patient-charts.css'

type Props = {
  guidance?: ReactNode;
  patient: Patient; alerts: ReviewAlert[]; priority?: string; busy: boolean;
  featureLabel: (key: string) => string;
  onAcknowledge: (id: string) => void; onEvidence: () => void; onPriority: () => void;
  onAlerts: () => void; onHistory: () => void; onContext: () => void; onNote: () => void;
}
const signed = (n: number, digits = 4) => {
  const rounded = Number(n.toFixed(digits))
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`
}
function observationTime(hours: number[], hour: number) {
  if (!hours.length) return 'No recorded source value in this window'
  if (hours.length === 1) return `Recorded at hour ${hours[0]} · ${hour - hours[0]}h before this score`
  return `${hours.length} source observations · hours ${hours[0]}–${hours[hours.length - 1]}`
}
const measurementNames = (keys: string[]) => keys.map(key => VITALS.find(v => v.key === key)?.label || key).join(', ')

export function SepsisInsights(props: Props) {
  const { patient, alerts, priority, busy, featureLabel } = props
  const result = patient.prediction, sepsis = result.sepsis, hour = result.as_of_hour
  const stats = scoreSummary(patient), review = reviewState(alerts, patient.id, hour)
  const tone = stats.score == null ? 'unknown' : sepsis.band === 'High' ? 'high' : sepsis.band === 'Moderate' ? 'moderate' : 'low'
  const color = tone === 'high' ? '#b91c1c' : tone === 'moderate' ? '#924000' : '#0077b6'
  const maximum = Math.min(1, Math.max(.02, Math.max(stats.threshold ?? 0, ...stats.valid.map(r => r.score), stats.score ?? 0) * 1.25))
  const start = stats.rows[0]?.ICULOS ?? hour
  const chart = Array.from({ length: hour - start + 1 }, (_, index) => ({ hour: start + index, score: stats.rows.find(r => r.ICULOS === start + index)?.score ?? null }))
  const chartAlerts = alerts.filter(a => a.patientId === patient.id && a.origin === 'model' && a.hour >= start && a.hour <= hour).sort((a, b) => a.hour - b.hour)
  const alertHours = [...new Set(chartAlerts.map(a => a.hour))]
  const changes = vitalChanges(patient).filter(c => c.delta != null)
  const factors = sepsis.factors.filter(f => f.contribution != null).slice(0, 3)
  const stale = result.data_quality.stale_vitals || [], missing = result.data_quality.unobserved_vitals || []
  const title = result.origin === 'example' ? 'Example signal only' : tone === 'high' ? 'Clinical review suggested' : tone === 'moderate' ? 'Below threshold · watch band' : tone === 'low' ? 'Below the review threshold' : 'Score unavailable'
  const description = result.origin === 'example' ? 'Illustrative output; this patient’s readings were not evaluated.' : stats.score == null ? result.data_quality.reason || 'No model result is available for this patient hour.' : tone === 'high' ? 'Score exceeds the alert threshold.' : review.pending.length ? 'The score is below threshold. Earlier alerts still need a recorded review.' : 'No threshold exceedance at this hour.'
  const trend = stats.delta6 == null ? null : stats.delta6 > 0 ? 'Rising' : stats.delta6 < 0 ? 'Falling' : 'Unchanged'
  const TrendIcon = stats.delta6 == null || stats.delta6 === 0 ? Minus : stats.delta6 > 0 ? ArrowUpRight : ArrowDownRight

  return <section className={`panel sepsis-insights sepsis-review sr--${tone}`} aria-label="Sepsis review insights">
    <header className="sr-heading">
      <h3>Sepsis review</h3>
      <span><Clock size={17} /> Patient hour <b>{hour}</b></span>
    </header>

    <div className="sr-overview">
      <div className="sr-current">
        <span className="sr-band"><Activity size={18} /> {result.origin === 'example' ? 'Example output' : `${sepsis.band || 'Unavailable'} model signal`}</span>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <div className={`sr-alert-review ${review.pending.length ? 'sr-alert-review--pending' : ''}`} role="status">
        <div className="sr-alert-heading"><Bell size={22} /><strong>{review.pending.length ? `${review.pending.length} unresolved alert${review.pending.length === 1 ? '' : 's'}` : 'No active model alerts'}</strong></div>
        {review.pending.length ? <>
          <p>{review.unacknowledged.length ? `${review.unacknowledged.length} awaiting acknowledgement` : 'Acknowledged · review still in progress'} · oldest at hour {review.pending[0].hour}.</p>
          <div className="sr-alert-actions">
            {review.unacknowledged[0] && <button className="button dark" disabled={busy} onClick={() => props.onAcknowledge(review.unacknowledged[0].id)}><CheckCircle size={17} /> Acknowledge {review.unacknowledged.length > 1 ? 'oldest' : 'alert'}</button>}
            <button className={review.unacknowledged.length ? 'text-link' : 'button secondary'} onClick={props.onAlerts}>Review alerts <ArrowRight size={17} /></button>
          </div>
        </> : <p>Through hour {hour}. A low score does not rule out sepsis.</p>}
      </div>
    </div>

    <div className="sr-content">
      <div className="sr-trend">
        <div className="sr-section-heading"><h4>Score trend</h4><span>Last {Math.min(24, hour - start + 1)} patient hours</span></div>
        <div className="sr-trend-summary">
          <div><span>Compared with 6h ago</span><strong><TrendIcon size={22} />{trend || 'Not enough history'}</strong></div>
          {stats.threshold != null && stats.valid.length > 0 && <div><span>At or above threshold</span><strong>{stats.above}<small>of {stats.valid.length} scored hours</small></strong></div>}
        </div>
        {stats.valid.length > 0 ? <>
          <div className="sr-chart-legend"><span><i style={{ background: color }} /> Model score</span>{stats.threshold != null && <span><i className="sr-threshold-key" /> Alert threshold</span>}{chartAlerts.length > 0 && <span><i className="sr-alert-key" /> Alert raised</span>}</div>
          <div className="sr-chart" role="img" aria-label={`Sepsis model score history${stats.threshold != null ? ` with alert threshold ${stats.threshold.toFixed(4)}` : ''}, through patient hour ${hour}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 16, right: 20, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5" />
                <XAxis dataKey="hour" type="number" domain={[start, Math.max(start + 1, hour)]} tickFormatter={v => `${v}h`} tick={{ fontSize: 14, fill: '#475569' }} tickLine={false} axisLine={false} minTickGap={32} />
                <YAxis domain={[0, maximum]} tickFormatter={v => Number(v).toFixed(2)} tick={{ fontSize: 14, fill: '#475569' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip labelFormatter={v => `Patient hour ${v}`} formatter={value => [value == null ? 'Unavailable' : Number(value).toFixed(4), 'Model score']} contentStyle={{ borderRadius: 8, fontSize: 16 }} />
                {stats.threshold != null && <ReferenceArea y1={stats.threshold} y2={maximum} fill="#d97706" fillOpacity={.045} />}
                <Area type="linear" dataKey="score" stroke={color} strokeWidth={3} fill={color} fillOpacity={.07} connectNulls={false} isAnimationActive={false} dot={stats.valid.length === 1 ? { r: 6, fill: color } : false} activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }} />
                {stats.threshold != null && <ReferenceLine y={stats.threshold} stroke="#924000" strokeDasharray="6 5" strokeWidth={1.5} />}
                {alertHours.map(h => <ReferenceLine key={`alert-${h}`} x={h} stroke="#b91c1c" strokeDasharray="3 4" strokeOpacity={.65} />)}
                {alertHours.map(h => {
                  const score = chart.find(r => r.hour === h)?.score
                  return score != null ? <ReferenceDot key={`alert-point-${h}`} x={h} y={score} r={6} fill="#b91c1c" stroke="#fff" strokeWidth={2} /> : null
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {chartAlerts.length > 0 && <div className="score-alert-events" aria-label="Alerts in the displayed score window">{chartAlerts.map(a => <button key={a.id} onClick={props.onAlerts} aria-label={`Review alert raised at hour ${a.hour}, current status ${a.status}`}><Bell size={14} /><b>Hour {a.hour}</b><span>{a.status}</span></button>)}</div>}
          <p className="sr-chart-caption">Research score, not a percentage. Gaps indicate missing scores.</p>
        </> : <div className="sr-empty"><Activity size={25} /><strong>No score history yet</strong><p>Scores appear when suitable recorded data is available.</p></div>}
        {(missing.length > 0 || stale.length > 0) && <div className="sr-data-note"><Info size={18} /><p>{missing.length > 0 && <>Not recorded in the model window: <strong>{measurementNames(missing)}</strong>. </>}{stale.length > 0 && <>Last measured more than 3h ago: <strong>{measurementNames(stale)}</strong>. </>}Measurement timing is shown for review.</p></div>}
      </div>

      <div className="sr-observations">
        <div className="sr-section-heading"><h4>Changes in readings</h4></div>
        <p className="sr-section-description">Latest 6h vs prior 6h averages.</p>
        {changes.length > 0 ? <ul className="sr-observation-list">{changes.map(change => {
          const vital = VITALS.find(v => v.key === change.key)!
          return <li key={change.key}>
            <div><span>{vital.label}</span><strong>{signed(change.delta!, 1)}<small>{vital.unit}</small></strong></div>
            <p><span>{valueText(change.previous!)} → {valueText(change.current!)}</span><span>{change.previousCount} earlier · {change.currentCount} recent readings</span></p>
          </li>
        })}</ul> : <div className="sr-empty"><Clock size={25} /><strong>More readings needed</strong><p>Both periods need recorded values before a change can be shown.</p></div>}
        <p className="sr-observation-caption">Recorded changes describe the measurements; they do not establish a diagnosis.</p>
      </div>
    </div>

    <div className="sr-actions">
      <button className="button secondary" onClick={props.onHistory}><BookOpen size={18} /> Patient history</button>
      <button className="button secondary" onClick={props.onContext}><UserCheck size={18} /> Patient context</button>
      <button className="button dark" onClick={props.onNote}><FileText size={18} /> Add assessment</button>
    </div>

    {props.guidance}

    <details className="sr-details">
      <summary><span><Info size={19} /><strong>Model details & supporting evidence</strong></span><ChevronDown size={20} /></summary>
      <div className="sr-details-body">
        <dl className="sr-model-values">
          <div><dt>Current model score</dt><dd>{stats.score?.toFixed(4) ?? 'Unavailable'}</dd></div>
          <div><dt>Alert threshold</dt><dd>{stats.threshold?.toFixed(4) ?? 'Unavailable'}</dd></div>
          <div><dt>6h score difference</dt><dd>{stats.delta6 == null ? 'Unavailable' : signed(stats.delta6)}</dd></div>
          <div><dt>Highest in displayed window</dt><dd>{stats.peak?.score.toFixed(4) ?? 'Unavailable'}{stats.peak && <small>at hour {stats.peak.ICULOS}</small>}</dd></div>
        </dl>
        <h4>What influenced the calculation</h4>
        <p>These model contributions describe influence on the score, not causes of illness. Positive values raise the score; negative values lower it.</p>
        {factors.length > 0 ? <ul className="sr-factor-list">{factors.map(factor => <li key={factor.feature}>
          <div><strong>{featureLabel(factor.feature)}</strong><span>{signed(factor.contribution!, 3)} log-odds</span></div>
          <p>{factor.value == null ? 'Missing input affects the calculation' : `Feature value ${valueText(factor.value)}`} · {observationTime(factor.observation_hours, hour)}</p>
        </li>)}</ul> : <p>No feature contributions are available.</p>}
        <div className="sr-model-meta"><span>{result.origin === 'model' ? `Model ${result.model_version || 'unavailable'}` : result.origin === 'example' ? 'Example output' : 'Model unavailable'} · {result.data_quality.history_rows ?? 0} recorded rows in the scoring window.</span><span>The 3h freshness flag is a display rule, not a clinical alarm threshold.</span></div>
        <button className="text-link" onClick={props.onEvidence}>Inspect all supporting data <ArrowRight size={17} /></button>
      </div>
    </details>

    <footer className={`sr-footer ${priority ? 'sr-priority-set' : 'sr-priority-unset'}`}>
      <div className="sr-priority-row"><span className="sr-priority-icon"><Clipboard size={24} /></span><div className="sr-priority-copy"><span>Clinician priority</span><strong>{priority || 'Not set'}</strong></div><button className="button dark" onClick={props.onPriority}>{priority ? 'Change priority' : 'Set priority'}<ArrowRight size={18} /></button></div>
      <p><strong>Clinician assessment required.</strong> Scores are not a diagnosis or calibrated probability.{patient.source === 'synthetic' ? ' Synthetic readings.' : ''}</p>
    </footer>
  </section>
}
