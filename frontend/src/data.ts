export type VitalKey = 'HR' | 'O2Sat' | 'SBP' | 'MAP' | 'Resp' | 'Temp'
export type Reading = { ICULOS: number; [key: string]: number | null }
export type Band = 'High' | 'Moderate' | 'Low'
export type Patient = {
  id: string; name: string; initials: string; age: number; sex: string; bed: string;
  focus: string; conditions: string[]; medications: string[]; color: string;
  band: Band; score: number; source: 'recorded' | 'synthetic'; readings: Reading[];
}
export type CareEvent = { id: string; patientId: string; hour: number; kind: string; text: string; created: string; session: number; alertId?: string; alertStatus?: AlertState['status'] }
export type AlertState = { status: 'Open' | 'Acknowledged' | 'In progress' | 'Resolved'; note: string }
export const VITALS: { key: VitalKey; label: string; short: string; unit: string; color: string }[] = [
  { key: 'HR', label: 'Heart rate', short: 'Heart rate', unit: 'bpm', color: '#b54739' },
  { key: 'O2Sat', label: 'Oxygen saturation', short: 'SpO₂', unit: '%', color: '#176f9a' },
  { key: 'SBP', label: 'Systolic pressure', short: 'Systolic BP', unit: 'mmHg', color: '#735099' },
  { key: 'MAP', label: 'Mean arterial pressure', short: 'MAP', unit: 'mmHg', color: '#866022' },
  { key: 'Resp', label: 'Respiratory rate', short: 'Respiratory rate', unit: '/min', color: '#237553' },
  { key: 'Temp', label: 'Temperature', short: 'Temperature', unit: '°C', color: '#a66513' },
]

export const ADDITIONAL_VITALS = [
  { key: 'DBP', label: 'Diastolic blood pressure', unit: 'mmHg', color: '#917ca6' },
  { key: 'EtCO2', label: 'End-tidal carbon dioxide', unit: 'source units', color: '#7a9272' },
]

export const LABS = [
  ['BaseExcess', 'Base excess'], ['HCO3', 'Bicarbonate'], ['FiO2', 'Inspired oxygen fraction'],
  ['pH', 'pH'], ['PaCO2', 'Arterial carbon dioxide'], ['SaO2', 'Arterial oxygen saturation'],
  ['AST', 'AST'], ['BUN', 'Blood urea nitrogen'], ['Alkalinephos', 'Alkaline phosphatase'],
  ['Calcium', 'Calcium'], ['Chloride', 'Chloride'], ['Creatinine', 'Creatinine'],
  ['Bilirubin_direct', 'Direct bilirubin'], ['Glucose', 'Glucose'], ['Lactate', 'Lactate'],
  ['Magnesium', 'Magnesium'], ['Phosphate', 'Phosphate'], ['Potassium', 'Potassium'],
  ['Bilirubin_total', 'Total bilirubin'], ['TroponinI', 'Troponin I'],
  ['Hct', 'Hematocrit'], ['Hgb', 'Hemoglobin'], ['PTT', 'PTT'],
  ['WBC', 'White blood cells'], ['Fibrinogen', 'Fibrinogen'], ['Platelets', 'Platelets'],
] as const

export function parsePSV(text: string): Reading[] {
  const lines = text.trim().split(/\r?\n/)
  const header = lines.shift()!.split('|')
  if (!['HR', 'O2Sat', 'SBP', 'ICULOS', 'SepsisLabel'].every(k => header.includes(k))) throw new Error('This file does not match the PhysioNet 2019 format.')
  const parsed = lines.map((line, i) => {
    const values = line.split('|')
    if (values.length !== header.length) throw new Error(`Unexpected column count on row ${i + 2}.`)
    const row: Reading = { ICULOS: i + 1 }
    header.forEach((key, j) => {
      if (key === 'SepsisLabel') return
      const str = values[j].trim()
      const n = Number(str)
      if (!['NaN', 'nan', ''].includes(str) && !Number.isFinite(n)) throw new Error(`Invalid number on row ${i + 2}.`)
      row[key] = ['NaN', 'nan', ''].includes(str) ? null : n
    })
    if (!Number.isInteger(row.ICULOS) || row.ICULOS < 1) throw new Error('Patient hours must be positive integers.')
    return row
  })
  if (!parsed.length || parsed.some((r, i) => i > 0 && r.ICULOS <= parsed[i - 1].ICULOS)) throw new Error('Patient hours must be strictly increasing.')
  return parsed
}

function synthetic(index: number): Reading[] {
  return Array.from({ length: 54 }, (_, i) => {
    const t = i + 1, wave = Math.sin(t / 3 + index), change = index === 1 ? Math.max(0, t - 25) * .35 : 0
    return {
      ICULOS: t, HR: Math.round(70 + index * 6 + wave * 6 + change),
      O2Sat: Math.round(98 - index * .4 + Math.sin(t / 5 + index)),
      SBP: Math.round(122 - index * 3 + wave * 8 - change),
      MAP: Math.round(84 - index + wave * 4 - change / 2),
      Resp: Math.round(16 + index + Math.sin(t / 4) * 2),
      Temp: t % 4 === 0 ? Math.round((36.6 + index * .12 + Math.sin(t / 8) * .2) * 10) / 10 : null,
      DBP: null, WBC: t % 12 === 0 ? +(7.2 + index * .8).toFixed(1) : null,
      Glucose: t % 12 === 0 ? 106 + index * 8 : null,
      Creatinine: t % 12 === 0 ? .8 + index * .1 : null,
      Platelets: t % 12 === 0 ? 240 + index * 12 : null,
    }
  })
}

export const INITIAL_PATIENTS: Patient[] = [
  { id: 'p000001', name: 'Eleanor Brooks', initials: 'EB', age: 83, sex: 'Female', bed: '01', focus: 'Sepsis monitoring', conditions: ['Demo: hypertension', 'Demo: COPD'], medications: ['Fictional medication list — not supplied by dataset'], color: 'rose', band: 'High', score: .82, source: 'recorded', readings: [] },
  { id: 'demo002', name: 'James Chen', initials: 'JC', age: 67, sex: 'Male', bed: '02', focus: 'Respiratory monitoring', conditions: ['Demo: pneumonia'], medications: ['Fictional medication list'], color: 'blue', band: 'Moderate', score: .54, source: 'synthetic', readings: synthetic(1) },
  { id: 'demo003', name: 'Amara Okafor', initials: 'AO', age: 54, sex: 'Female', bed: '03', focus: 'General monitoring', conditions: ['Demo: post-operative observation'], medications: ['Fictional medication list'], color: 'sand', band: 'Low', score: .18, source: 'synthetic', readings: synthetic(2) },
  { id: 'demo004', name: 'William Davis', initials: 'WD', age: 72, sex: 'Male', bed: '04', focus: 'Cardiovascular monitoring', conditions: ['Demo: hypertension'], medications: ['Fictional medication list'], color: 'sage', band: 'Moderate', score: .48, source: 'synthetic', readings: synthetic(3) },
  { id: 'demo005', name: 'Sofia Ramirez', initials: 'SR', age: 46, sex: 'Female', bed: '05', focus: 'General monitoring', conditions: ['Demo: observation'], medications: ['Fictional medication list'], color: 'lilac', band: 'Low', score: .12, source: 'synthetic', readings: synthetic(4) },
  { id: 'demo006', name: 'Noah Williams', initials: 'NW', age: 61, sex: 'Male', bed: '06', focus: 'General monitoring', conditions: ['Demo: observation'], medications: ['Fictional medication list'], color: 'blue', band: 'Low', score: .09, source: 'synthetic', readings: synthetic(5) },
]

export const EXAMPLE_ALERTS = [
  { id: 'example-1', patientId: 'p000001', band: 'High' as Band, title: 'Review suggested', detail: 'Example sepsis-model output for demonstrating the review workflow. This is not a computed prediction.', hour: 28 },
  { id: 'example-2', patientId: 'demo002', band: 'Moderate' as Band, title: 'Personal pattern change', detail: 'Example baseline-detector output. Compare the recorded window before making a decision.', hour: 25 },
  { id: 'example-3', patientId: 'demo004', band: 'Moderate' as Band, title: 'Monitoring review', detail: 'Synthetic alert provided to demonstrate acknowledgement and handover.', hour: 22 },
]

export function history(patient: Patient, hour: number) { return patient.readings.filter(r => r.ICULOS <= hour) }
export function latest(patient: Patient, hour: number, key: string) {
  const rows = history(patient, hour)
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return { value: rows[i][key]!, hour: rows[i].ICULOS }
  return null
}
export function valueText(n: number | null | undefined) { return n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1) }
export function mean(rows: Reading[], key: string) {
  const values = rows.map(r => r[key]).filter((n): n is number => n != null)
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}
export function downloadText(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}
