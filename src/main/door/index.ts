import { createLanService, notifyDesk } from '../lan/service'
import { receiptSettings } from '../services/receipts'
import { checkIn, checkInOptions, findForCheckIn } from '../services/visits'
import { conn } from '../state'
import { createDoorServer } from './server'

/** The door check-in tablet (port 8787 unless changed in Settings). */
export const door = createLanService({
  key: 'doorTablet',
  defaultPort: 8787,
  label: 'the door check-in tablet',
  offMessage: 'Turn on the door check-in first.',
  build: ({ staticDir, pairing }) =>
    createDoorServer({
      staticDir,
      authenticate: (token) => pairing.authenticate(token),
      pair: (code) => pairing.pair(code),
      gymName: () => receiptSettings(conn().db).gymName,
      // The database is looked up per request, so a restored backup needs no restart.
      find: (mobile) => findForCheckIn(conn().db, mobile),
      options: (memberId) => checkInOptions(conn().db, memberId),
      checkIn: (memberId, ptRegistrationId) => {
        const result = checkIn(conn().db, memberId, 'DOOR', new Date(), ptRegistrationId)
        notifyDesk('checkin', result)
        return result
      }
    })
})
