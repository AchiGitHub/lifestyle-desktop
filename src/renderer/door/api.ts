// The door page talks to the desk PC that served it, with the token it got when paired.
import type { CheckInCandidate } from '@shared/api'
import type { VisitStatus } from '@shared/enums'
import { lanClient } from '../lan/client'

export { LanError as DoorError } from '../lan/client'

const client = lanClient('lifestyle.door.token', {
  offline: 'Check-in isn’t available right now. Please see the front desk.',
  unpaired: 'This tablet isn’t paired.',
  failure: 'Something went wrong. Please see the front desk.'
})

export const { getToken, forgetToken, pair } = client

export const ping = () => client.call<{ gymName: string }>('GET', '/api/ping')

export const find = (mobile: string) => client.call<{ people: CheckInCandidate[] }>('POST', '/api/find', { mobile })

export interface DoorCheckIn {
  firstName: string
  status: VisitStatus
  endDate: string | null
  repeat: boolean
}

export const checkIn = (memberId: string) => client.call<DoorCheckIn>('POST', '/api/check-in', { memberId })
