export type ChatBlock = { kind: 'paragraph' | 'heading' | 'bullets' | 'ordered'; lines: string[] }
const actionNames: Record<string, string> = { verify_readings: 'Verify readings', review_trends: 'Review trends', document_assessment: 'Document an assessment', review_escalation: 'Review escalation workflow' }
export function cleanChatText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\\n/g, '\n')
    .replace(/([.!?])\s+\*\s+(?=[A-Z])/g, '$1\n- ')
    .replace(/\s*\[(?:ssc-adult-screening|vitalwatch-demo-workflow)\]/g, '')
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/^\s*```[^\n]*$/gm, '')
    .replace(/\s*\[(?:observation|latest|trend|prediction|data|care|context|note|alert|workflow):[^\]\n]+\]/g, '')
    .replace(/\b(verify_readings|review_trends|document_assessment|review_escalation)\b/g, key => actionNames[key]).trim()
}
export function chatBlocks(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = []
  for (const line of cleanChatText(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) { blocks.push({ kind: 'paragraph', lines: [] }); continue }
    const bullet = trimmed.match(/^(?:[-*•]\s+|\d+[.)]\s+)(.+)$/)
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/)
    const kind = heading ? 'heading' : bullet ? /^\d/.test(trimmed) ? 'ordered' : 'bullets' : 'paragraph'
    const content = heading?.[1] || bullet?.[1] || trimmed
    const previous = blocks[blocks.length - 1]
    if (previous?.kind === kind && previous.lines.length && kind !== 'heading') previous.lines.push(content)
    else blocks.push({ kind, lines: [content] })
  }
  return blocks.filter(b => b.lines.length)
}

export type ChatSeries = { key: string; label: string; unit: string; rows: { hour: number; value: number | null }[]; threshold?: number }
export const chatMeasurements: Record<string, { label: string; unit: string }> = {
  HR: { label: 'Heart rate', unit: 'bpm' }, O2Sat: { label: 'Oxygen saturation', unit: '%' },
  SBP: { label: 'Systolic pressure', unit: 'mmHg' }, DBP: { label: 'Diastolic pressure', unit: 'mmHg' },
  MAP: { label: 'Mean arterial pressure', unit: 'mmHg' }, Resp: { label: 'Respiratory rate', unit: '/min' },
  Temp: { label: 'Temperature', unit: '°C' },
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export function chatSeries(evidence: Record<string, unknown>, ids: string[], hour: number): ChatSeries[] {
  const series: ChatSeries[] = []
  const fill = (values: Map<number, number>) => {
    if (values.size < 2) return []
    const start = Math.min(...values.keys())
    return Array.from({ length: hour - start + 1 }, (_, i) => ({ hour: start + i, value: values.get(start + i) ?? null }))
  }
  const inWindow = (h: unknown): h is number => finite(h) && Number.isInteger(h) && h <= hour && h > hour - 24
  for (const key of Object.keys(chatMeasurements)) {
    if (!ids.some(id => id.startsWith(`observation:${key}:`) || id === `latest:${key}` || id === `trend:${key}`)) continue
    const values = new Map<number, number>()
    for (const [id, raw] of Object.entries(evidence)) {
      if (!id.startsWith(`observation:${key}:`) || !raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      if (inWindow(row.hour) && finite(row.value)) values.set(row.hour, row.value)
    }
    const rows = fill(values)
    if (rows.length) series.push({ key, ...chatMeasurements[key], rows })
  }
  const scores = evidence['prediction:history']
  if (ids.some(id => id === 'prediction:current' || id === 'prediction:history') && Array.isArray(scores)) {
    const values = new Map<number, number>()
    for (const row of scores) if (row && inWindow(row.hour) && finite(row.score)) values.set(row.hour, row.score)
    const rows = fill(values)
    const result = evidence['prediction:current'] as { sepsis?: { alert_threshold?: number } } | undefined
    if (rows.length) series.push({ key: 'score', label: 'Sepsis model score', unit: 'research score', rows, threshold: finite(result?.sepsis?.alert_threshold) ? result.sepsis.alert_threshold : undefined })
  }
  return series
}
