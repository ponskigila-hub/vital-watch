import { useState, type KeyboardEvent } from 'react'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { LABS, VITALS, latest, mean, valueText, type Patient, type Reading } from '../data'
import './patient-charts.css'

const PRESSURES = [
  { key: 'SBP', label: 'Systolic', color: '#005280', dash: undefined },
  { key: 'MAP', label: 'MAP', color: '#087e8b', dash: '3 3' },
  { key: 'DBP', label: 'Diastolic', color: '#5263a8', dash: '8 4' },
]

// Explicit empty hours prevent lines from joining across absent hourly records.
function hourlyRows(rows: Reading[], start: number, end: number): Reading[] {
  const indexed = new Map(rows.filter(r => r.ICULOS <= end).map(r => [r.ICULOS, r]))
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => indexed.get(start + i) || { ICULOS: start + i })
}

export function BloodPressureChart({ patient, start, hour, compare = false }: { patient: Patient; start: number; hour: number; compare?: boolean }) {
  const rows = hourlyRows(patient.readings, start, hour)
  const hasData = rows.some(r => PRESSURES.some(p => r[p.key] != null))
  return <section className="history-metric-card blood-pressure-card" aria-label="Combined blood pressure history">
    <div className="metric-chart-heading"><h4>Blood pressure</h4><span className="chart-unit">mmHg</span></div>
    <div className="pressure-values">{PRESSURES.map(p => {
      const last = latest(patient, hour, p.key)
      const current = mean(patient.readings.filter(r => r.ICULOS <= hour && r.ICULOS > hour - 6), p.key)
      const previous = mean(patient.readings.filter(r => r.ICULOS <= hour - 6 && r.ICULOS > hour - 12), p.key)
      return <div key={p.key}><span><i style={{ borderColor: p.color, borderTopStyle: p.dash ? 'dashed' : 'solid' }} />{p.label}</span><strong>{valueText(last?.value)}</strong><small>{last ? `Hour ${last.hour}` : 'No reading'}</small>{compare && <small>{previous != null && current != null ? `6h averages: ${valueText(previous)} → ${valueText(current)}` : '6h comparison unavailable'}</small>}</div>
    })}</div>
    {hasData ? <div className="pressure-chart" role="img" aria-label={`Systolic, mean arterial, and diastolic pressure in mmHg from hour ${start} to ${hour}. Missing readings are gaps.`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5" />
        <XAxis type="number" dataKey="ICULOS" domain={[start, Math.max(start + 1, hour)]} tickFormatter={v => `${v}h`} tick={{ fontSize: 14, fill: '#475569' }} axisLine={false} tickLine={false} minTickGap={32} />
        <YAxis domain={['auto', 'auto']} width={48} tick={{ fontSize: 14, fill: '#475569' }} axisLine={false} tickLine={false} />
        <Tooltip labelFormatter={v => `Patient hour ${v}`} formatter={(v, name) => [`${valueText(v as number)} mmHg`, name]} contentStyle={{ borderRadius: 14, fontSize: 16, borderColor: '#e2e8f0' }} />
        {PRESSURES.map(p => <Line key={p.key} name={p.label} type="linear" dataKey={p.key} stroke={p.color} strokeWidth={2.5} strokeDasharray={p.dash} connectNulls={false} isAnimationActive={false} dot={{ r: 3, strokeWidth: 0, fill: p.color }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />)}
      </LineChart></ResponsiveContainer>
    </div> : <div className="chart-empty">No blood pressure readings in this period</div>}
    <div className="metric-coverage">Hours {start}–{hour} · Missing readings stay blank</div>
  </section>
}

export function MeasurementHeatmap({ patient, start, hour }: { patient: Patient; start: number; hour: number }) {
  const [group, setGroup] = useState<'vitals' | 'labs'>('vitals')
  const [selected, setSelected] = useState<{ key: string; hour: number } | null>(null)
  const metrics = group === 'vitals'
    ? [...VITALS.map(v => ({ key: v.key as string, label: v.short, unit: v.unit })), { key: 'DBP', label: 'Diastolic BP', unit: 'mmHg' }]
    : LABS.map(([key, label]) => ({ key: key as string, label, unit: 'source units' }))
  const rows = hourlyRows(patient.readings, start, hour)
  const active = selected && metrics.some(m => m.key === selected.key) && selected.hour >= start && selected.hour <= hour ? selected : { key: metrics[0].key, hour: start }
  const activeMetric = metrics.find(m => m.key === active.key)!
  const value = rows.find(r => r.ICULOS === active.hour)?.[active.key]
  const totalCells = rows.length * metrics.length
  const recordedCells = rows.reduce((count, row) => count + metrics.filter(metric => row[metric.key] != null).length, 0)
  const coverage = totalCells ? recordedCells / totalCells : 0
  const latestRecordedHour = [...rows].reverse().find(row => metrics.some(metric => row[metric.key] != null))?.ICULOS
  const missingCells = totalCells - recordedCells
  function move(e: KeyboardEvent<HTMLButtonElement>, row: number, col: number) {
    const shifts: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Home: [0, -col], End: [0, rows.length - col - 1] }
    const shift = shifts[e.key]
    if (!shift) return
    e.preventDefault()
    const nextRow = Math.max(0, Math.min(metrics.length - 1, row + shift[0]))
    const nextCol = Math.max(0, Math.min(rows.length - 1, col + shift[1]))
    setSelected({ key: metrics[nextRow].key, hour: rows[nextCol].ICULOS })
    const table = e.currentTarget.closest('table')
    table?.querySelector<HTMLButtonElement>(`[data-cell="${nextRow}-${nextCol}"]`)?.focus()
  }
  return <section className="measurement-availability" aria-label="Measurement availability">
    <div className="availability-heading"><h4>Measurement availability</h4><div className="history-view-tabs" aria-label="Availability measurements">{(['vitals', 'labs'] as const).map(g => <button key={g} aria-pressed={group === g} className={group === g ? 'active' : ''} onClick={() => { setGroup(g); setSelected(null) }}>{g === 'vitals' ? 'Vitals' : 'Labs'}</button>)}</div></div>
    <div className="reliability-summary" aria-label="Data reliability summary"><div><span>Window coverage</span><strong>{(coverage * 100).toFixed(0)}%</strong></div><div><span>Recorded cells</span><strong>{recordedCells.toLocaleString()} / {totalCells.toLocaleString()}</strong></div><div><span>Missing cells</span><strong>{missingCells.toLocaleString()}</strong></div><div><span>Latest reading</span><strong>{latestRecordedHour == null ? 'None' : `Hour ${latestRecordedHour}`}</strong></div></div>
    <div className="availability-legend"><span><i className="recorded" />Recorded</span><span><i />No reading</span><span>Hours {start}–{hour}</span></div>
    <div className="availability-scroll"><table className="availability-table"><caption className="sr-only">Recorded measurements by patient hour. Select a cell for its value; use arrow keys to move. A blank cell is missing, not a normal result.</caption><thead><tr><th scope="col">Measurement</th>{rows.map((r, i) => <th scope="col" key={r.ICULOS}>{i === 0 || i === rows.length - 1 || i % Math.max(1, Math.ceil(rows.length / 8)) === 0 ? `${r.ICULOS}h` : ''}</th>)}</tr></thead><tbody>{metrics.map((m, ri) => <tr key={m.key}><th scope="row">{m.label}</th>{rows.map((r, ci) => {
      const recorded = r[m.key] != null, isActive = active.key === m.key && active.hour === r.ICULOS
      return <td key={r.ICULOS}><button data-cell={`${ri}-${ci}`} tabIndex={isActive ? 0 : -1} aria-pressed={isActive} className={`availability-cell ${recorded ? 'is-recorded' : ''}`} title={`${m.label} · Hour ${r.ICULOS}: ${recorded ? `${valueText(r[m.key])} ${m.unit}` : 'No reading'}`} aria-label={`${m.label}, hour ${r.ICULOS}: ${recorded ? `${valueText(r[m.key])} ${m.unit}` : 'No reading'}`} onFocus={() => setSelected({ key: m.key, hour: r.ICULOS })} onClick={() => setSelected({ key: m.key, hour: r.ICULOS })} onKeyDown={e => move(e, ri, ci)} /></td>
    })}</tr>)}</tbody></table></div>
    <div className="availability-selection" aria-live="polite"><span>{activeMetric.label} · Hour {active.hour}</span><strong>{value == null ? 'No reading' : <>{valueText(value)} <small>{activeMetric.unit}</small></>}</strong></div>
  </section>
}
