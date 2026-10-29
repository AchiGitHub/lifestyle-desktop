import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppEvents, CheckInResult, IpcResult, StoreChange } from '../shared/api'

const METHODS: { [G in keyof Api]: (keyof Api[G])[] } = {
  auth: ['status', 'login', 'setPassword', 'changePassword', 'logout'],
  members: ['list', 'get', 'create', 'update', 'delete', 'findByMobile', 'possibleDuplicates', 'merge'],
  durations: ['list', 'create', 'update', 'delete'],
  membershipTypes: ['list', 'create', 'update', 'setArchived', 'delete'],
  joiningFee: ['settings', 'save'],
  registrations: ['list', 'get', 'create', 'update', 'dismiss', 'undismiss', 'delete', 'expiring', 'expired'],
  payments: ['list', 'add', 'delete'],
  products: ['list', 'create', 'update', 'delete', 'sell', 'receiveStock', 'countStock', 'stockChanges'],
  credit: ['owed', 'sales', 'pay', 'deleteSale'],
  trainers: ['list', 'create', 'update', 'setArchived', 'delete'],
  ptPackages: ['list', 'create', 'update', 'setArchived', 'delete'],
  personalTraining: ['list', 'create', 'update', 'delete', 'addPayment', 'sessions', 'commission'],
  reports: ['dashboard', 'accounts', 'showSaved'],
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
  reminders: ['settings', 'save', 'send', 'sendCredit'],
  receipts: ['get', 'print', 'sendWhatsApp', 'printSample', 'settings', 'saveSettings'],
  summary: ['days', 'sendToOwner', 'status', 'setEnabled', 'setOwnerEmail', 'updateNow'],
  updates: ['status', 'check', 'install'],
  appearance: ['set'],
  visits: ['list', 'options', 'checkIn', 'delete'],
  doorTablet: ['status', 'setEnabled', 'setPort', 'startPairing', 'removeDevice'],
  staffDevices: ['status', 'setEnabled', 'setPort', 'startPairing', 'removeDevice']
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

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => void ipcRenderer.removeListener(channel, listener)
}

// Pushed from the main process: a member checked in at the door tablet, or an
// instructor sold something or changed stock on their phone.
const events: AppEvents = {
  onCheckIn: (callback) => subscribe<CheckInResult>('checkin', callback),
  onStoreChange: (callback) => subscribe<StoreChange>('storeChanged', callback)
}
contextBridge.exposeInMainWorld('events', events)
