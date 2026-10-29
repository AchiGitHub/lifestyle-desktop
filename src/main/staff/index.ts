import { createLanService, notifyDesk } from '../lan/service'
import { receiptSettings } from '../services/receipts'
import { conn } from '../state'
import { createStaffServer } from './server'

/** Instructors' phones, for store sales and stock (port 8788 unless changed in Settings). */
export const staffDevices = createLanService({
  key: 'staffDevices',
  defaultPort: 8788,
  label: 'instructor phones',
  offMessage: 'Turn on instructor phones first.',
  named: true,
  build: ({ staticDir, pairing, deviceName }) =>
    createStaffServer({
      staticDir,
      authenticate: (token) => pairing.authenticate(token),
      pair: (code) => pairing.pair(code),
      deviceName,
      gymName: () => receiptSettings(conn().db).gymName,
      db: () => conn().db,
      onChange: (change) => notifyDesk('storeChanged', change)
    })
})
