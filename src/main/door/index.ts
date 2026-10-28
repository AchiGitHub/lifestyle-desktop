import { app, type BrowserWindow } from 'electron'
import type { Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { CheckInResult, DoorPairing, DoorTabletStatus } from '../../shared/api'
import { readConfig, updateConfig, type MachineConfig } from '../config'
import { AppError } from '../services/errors'
import { receiptSettings } from '../services/receipts'
import { checkIn, findForCheckIn } from '../services/visits'
import { conn } from '../state'
import { createPairing } from './pairing'
import { createDoorServer } from './server'

const DEFAULT_PORT = 8787

type DoorConfig = NonNullable<MachineConfig['doorTablet']>
const config = (): DoorConfig => readConfig().doorTablet ?? { enabled: false, port: DEFAULT_PORT, devices: [] }
const saveConfig = (change: (c: DoorConfig) => void): void =>
  void updateConfig((c) => {
    const door = c.doorTablet ?? { enabled: false, port: DEFAULT_PORT, devices: [] }
    change(door)
    c.doorTablet = door
  })

const pairing = createPairing({
  devices: () => config().devices,
  save: (devices) => saveConfig((c) => (c.devices = devices))
})

let server: Server | null = null
let lastError: string | null = null
let deskWindow: BrowserWindow | null = null

export const setDeskWindow = (win: BrowserWindow | null): void => {
  deskWindow = win
}

/** Tells the desk window about a check-in at the door, for alerts and lists. */
function notifyDesk(result: CheckInResult): void {
  if (deskWindow && !deskWindow.isDestroyed()) deskWindow.webContents.send('checkin', result)
}

// Adapters a tablet can't reach: WSL, Hyper-V, Docker, VirtualBox, VMware.
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

export function doorStatus(): DoorTabletStatus {
  const c = config()
  return {
    enabled: c.enabled,
    running: server?.listening ?? false,
    port: c.port,
    addresses: server?.listening ? addresses(c.port) : [],
    devices: c.devices.map(({ tokenHash: _hash, ...d }) => d),
    error: lastError
  }
}

export async function stopDoorServer(): Promise<void> {
  const s = server
  server = null
  if (!s) return
  s.closeAllConnections()
  await new Promise<void>((resolve) => s.close(() => resolve()))
}

/** Starts the server if the door tablet is turned on (restarting it if already running). */
export async function startDoorServer(): Promise<void> {
  await stopDoorServer()
  const c = config()
  lastError = null
  if (!c.enabled) return
  const s = createDoorServer({
    staticDir: join(app.getAppPath(), 'out', 'renderer'),
    authenticate: (token) => pairing.authenticate(token),
    pair: (code) => pairing.pair(code),
    gymName: () => receiptSettings(conn().db).gymName,
    find: (mobile) => findForCheckIn(conn().db, mobile),
    checkIn: (memberId) => {
      const result = checkIn(conn().db, memberId, 'DOOR')
      notifyDesk(result)
      return result
    }
  })
  await new Promise<void>((resolve) => {
    s.once('error', (e: NodeJS.ErrnoException) => {
      lastError =
        e.code === 'EADDRINUSE'
          ? `Port ${c.port} is already used by another program. Choose another port.`
          : `The check-in server couldn't start: ${e.message}`
      resolve()
    })
    // Tests can keep it on this computer (no firewall prompt); real use is on the gym network.
    const host = (!app.isPackaged && process.env.LIFESTYLE_DOOR_HOST) || '0.0.0.0'
    s.listen(c.port, host, () => {
      server = s
      resolve()
    })
  })
}

export async function setDoorEnabled(enabled: boolean): Promise<void> {
  saveConfig((c) => (c.enabled = enabled))
  await startDoorServer()
}

export async function setDoorPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new AppError('Choose a port from 1024 to 65535.')
  saveConfig((c) => (c.port = port))
  await startDoorServer()
}

export function startPairing(): DoorPairing {
  if (!server?.listening) throw new AppError('Turn on the door check-in first.')
  const { code, expiresAt } = pairing.start()
  const base = addresses(config().port)[0] ?? `http://<this-pc>:${config().port}`
  return { code, url: `${base}/#pair=${code}`, expiresAt: new Date(expiresAt).toISOString() }
}

export function removeDevice(id: string): void {
  saveConfig((c) => (c.devices = c.devices.filter((d) => d.id !== id)))
}
