// The door page talks to the desk PC that served it, with the token it got when paired.
import type { CheckInCandidate } from '@shared/api'
import type { VisitStatus } from '@shared/enums'

const TOKEN_KEY = 'lifestyle.door.token'

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY)
export const forgetToken = (): void => localStorage.removeItem(TOKEN_KEY)

/** Why a request failed: not paired, the PC can't be reached, or a message to show. */
export class DoorError extends Error {
  constructor(
    readonly kind: 'unpaired' | 'offline' | 'message',
    message: string
  ) {
    super(message)
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    throw new DoorError('offline', 'Check-in isn’t available right now. Please see the front desk.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) throw new DoorError('unpaired', data.error ?? 'This tablet isn’t paired.')
  if (!res.ok) throw new DoorError('message', data.error ?? 'Something went wrong. Please see the front desk.')
  return data as T
}

export async function pair(code: string): Promise<void> {
  const { token } = await call<{ token: string }>('POST', '/api/pair', { code })
  localStorage.setItem(TOKEN_KEY, token)
}

export const ping = () => call<{ gymName: string }>('GET', '/api/ping')

export const find = (mobile: string) => call<{ people: CheckInCandidate[] }>('POST', '/api/find', { mobile })

export interface DoorCheckIn {
  firstName: string
  status: VisitStatus
  endDate: string | null
  repeat: boolean
}

export const checkIn = (memberId: string) => call<DoorCheckIn>('POST', '/api/check-in', { memberId })
