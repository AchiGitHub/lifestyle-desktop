// The door tablet's and instructors' pages talk to the desk PC that served them,
// with the token they got when paired.

/** Why a request failed: not paired, the PC can't be reached, or a message to show. */
export class LanError extends Error {
  constructor(
    readonly kind: 'unpaired' | 'offline' | 'message',
    message: string
  ) {
    super(message)
  }
}

export interface LanClient {
  getToken(): string | null
  forgetToken(): void
  pair(code: string): Promise<void>
  call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>
}

export function lanClient(
  tokenKey: string,
  messages: { offline: string; unpaired: string; failure: string }
): LanClient {
  const getToken = (): string | null => localStorage.getItem(tokenKey)

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
      throw new LanError('offline', messages.offline)
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new LanError('unpaired', data.error ?? messages.unpaired)
    if (!res.ok) throw new LanError('message', data.error ?? messages.failure)
    return data as T
  }

  return {
    getToken,
    forgetToken: () => localStorage.removeItem(tokenKey),
    async pair(code) {
      const { token } = await call<{ token: string }>('POST', '/api/pair', { code })
      localStorage.setItem(tokenKey, token)
    },
    call
  }
}
