import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'

export interface PairedDevice {
  id: string
  name: string
  /** sha256 of the device token; the token itself only lives on the device. */
  tokenHash: string
  pairedAt: string
  lastSeenAt: string | null
}

export interface DeviceStore {
  devices(): PairedDevice[]
  save(devices: PairedDevice[]): void
}

const CODE_MINUTES = 10
const CODE_ATTEMPTS = 5
const SEEN_EVERY_MS = 60_000

const hash = (token: string): string => createHash('sha256').update(token).digest('hex')

/**
 * Pairing a device: the desk shows a 6-digit code valid for 10 minutes; the
 * device trades it once for a long random token. A wrong guess counts
 * against the code, which stops working after 5.
 */
export function createPairing(store: DeviceStore, now: () => number = Date.now) {
  let pending: { code: string; expiresAt: number; attempts: number; name?: string } | null = null

  return {
    /** A new code, for a device to be listed under `name` (door tablets are numbered instead). */
    start(name?: string): { code: string; expiresAt: number } {
      pending = {
        code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
        expiresAt: now() + CODE_MINUTES * 60_000,
        attempts: 0,
        name
      }
      return { code: pending.code, expiresAt: pending.expiresAt }
    },

    /** The new device's token, or null if the code is wrong, used or expired. */
    pair(code: string): string | null {
      if (!pending || now() > pending.expiresAt || pending.attempts >= CODE_ATTEMPTS) return null
      if (code !== pending.code) {
        pending.attempts++
        return null
      }
      const name = pending.name
      pending = null
      const token = randomBytes(32).toString('base64url')
      const devices = store.devices()
      const at = new Date(now()).toISOString()
      store.save([
        ...devices,
        {
          id: randomUUID(),
          name: name ?? `Tablet ${devices.length + 1}`,
          tokenHash: hash(token),
          pairedAt: at,
          lastSeenAt: at
        }
      ])
      return token
    },

    /** The device a token belongs to, noting when it was last seen. */
    authenticate(token: string): string | null {
      const wanted = Buffer.from(hash(token), 'hex')
      const devices = store.devices()
      const device = devices.find((d) => timingSafeEqual(Buffer.from(d.tokenHash, 'hex'), wanted))
      if (!device) return null
      if (!device.lastSeenAt || now() - Date.parse(device.lastSeenAt) > SEEN_EVERY_MS) {
        device.lastSeenAt = new Date(now()).toISOString()
        store.save(devices)
      }
      return device.id
    }
  }
}

export type Pairing = ReturnType<typeof createPairing>
