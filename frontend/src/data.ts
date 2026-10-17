export type VitalKey = 'HR' | 'O2Sat' | 'SBP' | 'MAP' | 'Resp' | 'Temp'
export type Reading = { ICULOS: number; [key: string]: number | null }
export type Band = 'High' | 'Moderate' | 'Low'
export type Patient = {
  id: string; name: string; initials: string; age: number | null; sex: string; bed: string;
  focus: string; conditions: string[]; medications: string[]; color: string;
  band: Band | null; score: number | null; source: 'recorded' | 'synthetic'; provenance: string; readings: Reading[];
}
export type CareEvent = { id: string; patientId: string; hour: number; kind: string; text: string; created: string; session: string; actorName: string; alertId?: string; alertStatus?: AlertState['status'] }
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

export function history(patient: { readings: Reading[] }, hour: number) { return patient.readings.filter(r => r.ICULOS <= hour) }
export function latest(patient: { readings: Reading[] }, hour: number, key: string) {
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
