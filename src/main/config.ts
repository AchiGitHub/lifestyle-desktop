import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { PairedDevice } from './lan/pairing'
import { paths } from './paths'
import type { SheetState } from './summary/sync'

/** A server on the gym network, and the devices paired to it. */
export interface LanConfig {
  enabled: boolean
  port: number
  devices: PairedDevice[]
}

/**
 * Settings that belong to this PC rather than to the data: the Google Drive
 * sign-in and backup status. They live outside the database so a restored
 * backup never brings back another machine's sign-in.
 */
export interface MachineConfig {
  drive?: {
    /** Refresh token, encrypted with Electron safeStorage (Windows DPAPI), base64. */
    refreshToken: string
    account: string | null
    folderId?: string
  }
  backup?: {
    lastSuccessAt?: string
    lastAttemptAt?: string
    lastError?: string | null
  }
  /** The door check-in tablet: this PC's server and the tablets paired to it. */
  doorTablet?: LanConfig
  /** Instructors' phones for store sales and stock, listed under the instructor's name. */
  staffDevices?: LanConfig
  /** The owner's daily summary sheet in Google Drive (on unless turned off). */
  ownerSummary?: SheetState & {
    enabled?: boolean
    lastUpdatedAt?: string
    lastError?: string | null
  }
}

export function readConfig(): MachineConfig {
  try {
    return existsSync(paths.config) ? (JSON.parse(readFileSync(paths.config, 'utf8')) as MachineConfig) : {}
  } catch {
    return {}
  }
}

export function updateConfig(change: (config: MachineConfig) => void): MachineConfig {
  const config = readConfig()
  change(config)
  const tmp = `${paths.config}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2))
  renameSync(tmp, paths.config)
  return config
}
