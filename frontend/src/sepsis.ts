import type { Patient } from './data'

export function scoreSummary(patient: Patient) {
  const hour = patient.prediction.as_of_hour
  const threshold = patient.prediction.sepsis.alert_threshold
  const rows = patient.score_history.filter(r => r.ICULOS <= hour && r.ICULOS > hour - 24).sort((a, b) => a.ICULOS - b.ICULOS)
  const valid = rows.filter((r): r is typeof r & {score: number} => r.score != null && Number.isFinite(r.score))
  const score = patient.prediction.sepsis.score
  const previous = valid.find(r => r.ICULOS === hour - 6)
  const peak = valid.reduce<typeof valid[number] | null>((best, row) => best == null || row.score > best.score ? row : best, null)
  const above = valid.filter(r => (r.threshold ?? threshold) != null && r.score >= (r.threshold ?? threshold)!).length
  let consecutive = 0
  for (let h = hour; h > hour - 24; h--) {
    const row = valid.find(r => r.ICULOS === h)
    const cutoff = row?.threshold ?? threshold
    if (!row || cutoff == null || row.score < cutoff) break
    consecutive++
  }
  return {score, threshold, rows, valid, peak, above, consecutive, delta6: score != null && previous ? score - previous.score : null, ratio: score != null && threshold != null && threshold > 0 ? score / threshold : null}
}

export function vitalChanges(patient: Patient) {
  const hour = patient.prediction.as_of_hour
  const keys = ['HR', 'O2Sat', 'SBP', 'MAP', 'Resp', 'Temp']
  return keys.map(key => {
    const current = patient.readings.filter(r => r.ICULOS <= hour && r.ICULOS > hour - 6 && r[key] != null)
    const previous = patient.readings.filter(r => r.ICULOS <= hour - 6 && r.ICULOS > hour - 12 && r[key] != null)
    const average = (rows: typeof current) => rows.reduce((sum, row) => sum + row[key]!, 0) / rows.length
    const a = previous.length ? average(previous) : null, b = current.length ? average(current) : null
    return {key, delta: a != null && b != null ? b - a : null, previous: a, current: b, previousCount: previous.length, currentCount: current.length}
  })
}

export type ReviewAlert = {id: string; patientId: string; hour: number; origin: string; status: 'Open' | 'Acknowledged' | 'In progress' | 'Resolved'}
export function reviewState(alerts: ReviewAlert[], patientId: string, hour: number) {
  const pending = alerts.filter(a => a.patientId === patientId && a.hour <= hour && a.status !== 'Resolved').sort((a, b) => a.hour - b.hour)
  return {pending, unacknowledged: pending.filter(a => a.status === 'Open'), acknowledged: pending.filter(a => a.status !== 'Open')}
}
