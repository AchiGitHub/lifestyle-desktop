import { app, type BrowserWindow } from 'electron'
import type { Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { LanPairing, LanStatus } from '../../shared/api'
import { readConfig, updateConfig, type LanConfig } from '../config'
import { AppError } from '../services/errors'
import { createPairing, type Pairing } from './pairing'

let deskWindow: BrowserWindow | null = null

export const setDeskWindow = (win: BrowserWindow | null): void => {
  deskWindow = win
}

/** Tells the desk window what happened on a device, for alerts and fresh lists. */
export function notifyDesk(channel: string, payload: unknown): void {
  if (deskWindow && !deskWindow.isDestroyed()) deskWindow.webContents.send(channel, payload)
}

// Adapters a tablet or phone can't reach: WSL, Hyper-V, Docker, VirtualBox, VMware.
const VIRTUAL = /vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware|Loopback/i
// Wi-Fi routers usually hand out 192.168.x.x; 172.16–31 is more often a virtual network.
const PRIVATE = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./]

/** This PC's addresses on the local network, likeliest first, e.g. http://192.168.1.20:8787. */
function addresses(port: number): string[] {
  const found: { address: string; rank: number }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue
    for (const a of list ?? []) {
      const rank = PRIVATE.findIndex((p) => p.test(a.address))
      if (a.family === 'IPv4' && !a.internal && rank >= 0) found.push({ address: a.address, rank })
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => `http://${f.address}:${port}`)
}

export interface LanServiceOptions {
  key: 'doorTablet' | 'staffDevices'
  defaultPort: number
  /** What it's for, in messages: "the door check-in tablet". */
  label: string
  /** Why pairing can't start while it's off. */
  offMessage: string
  /** Instructor phones are listed under a name typed at the desk; door tablets are numbered. */
  named?: boolean
  build(ctx: { staticDir: string; pairing: Pairing; deviceName(id: string): string | null }): Server
}

/** A server on the gym network that the desk turns on and pairs devices with, from Settings. */
export interface LanService {
  readonly label: string
  port(): number
  status(): LanStatus
  /** Starts the server if it's turned on (restarting it if already running). */
  start(): Promise<void>
  stop(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setPort(port: number): Promise<void>
  /** A one-time code (10 minutes) and link for pairing a device. */
  startPairing(name?: string): LanPairing
  removeDevice(id: string): void
}

const services: LanService[] = []

export function createLanService(o: LanServiceOptions): LanService {
  const empty = (): LanConfig => ({ enabled: false, port: o.defaultPort, devices: [] })
  const config = (): LanConfig => readConfig()[o.key] ?? empty()
  const saveConfig = (change: (c: LanConfig) => void): void =>
    void updateConfig((c) => {
      const lan = c[o.key] ?? empty()
      change(lan)
      c[o.key] = lan
    })

  const pairing = createPairing({
    devices: () => config().devices,
    save: (devices) => saveConfig((c) => (c.devices = devices))
  })
  const deviceName = (id: string): string | null => config().devices.find((d) => d.id === id)?.name ?? null

  let server: Server | null = null
  let lastError: string | null = null

  async function stop(): Promise<void> {
    const s = server
    server = null
    if (!s) return
    s.closeAllConnections()
    await new Promise<void>((resolve) => s.close(() => resolve()))
  }

  async function start(): Promise<void> {
    await stop()
    const c = config()
    lastError = null
    if (!c.enabled) return
    const s = o.build({ staticDir: join(app.getAppPath(), 'out', 'renderer'), pairing, deviceName })
    await new Promise<void>((resolve) => {
      s.once('error', (e: NodeJS.ErrnoException) => {
        lastError =
          e.code === 'EADDRINUSE'
            ? `Port ${c.port} is already used by another program. Choose another port.`
            : `The server for ${o.label} couldn't start: ${e.message}`
        resolve()
      })
      // Tests can keep it on this computer (no firewall prompt); real use is on the gym network.
      const host = (!app.isPackaged && process.env.LIFESTYLE_LAN_HOST) || '0.0.0.0'
      s.listen(c.port, host, () => {
        server = s
        resolve()
      })
    })
  }

  function cleanName(name: string | undefined): string {
    const clean = (name ?? '').trim().replace(/\s+/g, ' ')
    if (!clean) throw new AppError('Type the instructor’s name.')
    if (clean.length > 40) throw new AppError('Keep the name under 40 characters.')
    if (config().devices.some((d) => d.name.toLowerCase() === clean.toLowerCase())) {
      throw new AppError(`A phone called ${clean} is already paired. Remove it first, or use another name.`)
    }
    return clean
  }

  const service: LanService = {
    label: o.label,
    port: () => config().port,
    status() {
      const c = config()
      return {
        enabled: c.enabled,
        running: server?.listening ?? false,
        port: c.port,
        addresses: server?.listening ? addresses(c.port) : [],
        devices: c.devices.map(({ tokenHash: _hash, ...d }) => d),
        error: lastError
      }
    },
    start,
    stop,
    async setEnabled(enabled) {
      saveConfig((c) => (c.enabled = enabled))
      await start()
    },
    async setPort(port) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new AppError('Choose a port from 1024 to 65535.')
      const clash = services.find((s) => s !== service && s.port() === port)
      if (clash) throw new AppError(`Port ${port} is used for ${clash.label}. Choose another port.`)
      saveConfig((c) => (c.port = port))
      await start()
    },
    startPairing(name) {
      if (!server?.listening) throw new AppError(o.offMessage)
      const { code, expiresAt } = pairing.start(o.named ? cleanName(name) : undefined)
      const port = config().port
      const base = addresses(port)[0] ?? `http://<this-pc>:${port}`
      return { code, url: `${base}/#pair=${code}`, expiresAt: new Date(expiresAt).toISOString() }
    },
    removeDevice(id) {
      saveConfig((c) => (c.devices = c.devices.filter((d) => d.id !== id)))
    }
  }
  services.push(service)
  return service
}
