export type User = { id: string; name: string; email: string; role: 'clinician' | 'family' }
export type Auth = { user: User; csrf_token: string }
export type HandoverMeta = { id: string; patientId: string; session: string; hour: number; text: string; revision: number }
export type FamilyView = {
  user: User; session_id: string; hour: number;
  patients: { id: string; name: string; initials: string; bed: string; source: 'recorded' | 'synthetic'; readings: { ICULOS: number; HR: number | null; O2Sat: number | null; SBP: number | null }[]; updates: { id: string; text: string; hour: number; approvedBy: string }[] }[];
}

let csrfToken = ''
export function setCsrf(value: string) { csrfToken = value }
export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('X-CSRF-Token', csrfToken)
  let response: Response
  try { response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' }) }
  catch { throw new ApiError(0, 'The backend could not be reached. Check that the API is running, then retry.') }
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try { const body = await response.json(); message = typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.map((e: { msg: string }) => e.msg).join('; ') : message } catch { /* Preserve the HTTP status when a proxy returns non-JSON. */ }
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('vitalwatch:unauthorized'))
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text() as Promise<T>
}

export function json(method: string, body: unknown): RequestInit { return { method, body: JSON.stringify(body) } }
