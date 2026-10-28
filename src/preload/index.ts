import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppEvents, CheckInResult, IpcResult } from '../shared/api'

const METHODS: { [G in keyof Api]: (keyof Api[G])[] } = {
  auth: ['status', 'login', 'setPassword', 'changePassword', 'logout'],
  members: ['list', 'get', 'create', 'update', 'delete', 'findByMobile', 'possibleDuplicates', 'merge'],
  durations: ['list', 'create', 'update', 'delete'],
  membershipTypes: ['list', 'create', 'update', 'setArchived', 'delete'],
  joiningFee: ['settings', 'save'],
  registrations: ['list', 'get', 'create', 'update', 'dismiss', 'undismiss', 'delete', 'expiring', 'expired'],
  payments: ['list', 'add', 'delete'],
  products: ['list', 'create', 'update', 'delete', 'sell'],
  reports: ['dashboard'],
  backup: [
    'status',
    'backupNow',
    'connectDrive',
    'disconnectDrive',
    'listDriveBackups',
    'restoreFromDrive',
    'restoreFromFile',
    'restoreLocal'
  ],
  reminders: ['settings', 'save', 'send'],
  receipts: ['get', 'print', 'sendWhatsApp', 'printSample', 'settings', 'saveSettings'],
  summary: ['days', 'sendToOwner', 'status', 'setEnabled', 'setOwnerEmail', 'updateNow'],
  updates: ['status', 'check', 'install'],
  visits: ['list', 'checkIn', 'delete'],
  doorTablet: ['status', 'setEnabled', 'setPort', 'startPairing', 'removeDevice']
}

// window.api.members.list() → ipc 'api' with method 'members.list'.
// Errors cross IPC as messages and are re-thrown as plain Errors.
const call =
  (method: string) =>
  async (...args: unknown[]): Promise<unknown> => {
    const result = (await ipcRenderer.invoke('api', method, args)) as IpcResult<unknown>
    if (!result.ok) throw new Error(result.error)
    return result.data
  }

const api = Object.fromEntries(
  Object.entries(METHODS).map(([group, names]) => [
    group,
    Object.fromEntries((names as string[]).map((name) => [name, call(`${group}.${name}`)]))
  ])
)

contextBridge.exposeInMainWorld('api', api)

// Pushed from the main process: a member checked in at the door tablet.
const events: AppEvents = {
  onCheckIn: (callback) => {
    const listener = (_event: unknown, result: CheckInResult) => callback(result)
    ipcRenderer.on('checkin', listener)
    return () => void ipcRenderer.removeListener('checkin', listener)
  }
}
contextBridge.exposeInMainWorld('events', events)
