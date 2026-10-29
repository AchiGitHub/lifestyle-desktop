// The instructor page talks to the desk PC that served it, with the token it got when paired.
import type { MemberChoice, StaffProduct, StaffSale, StockResult } from '@shared/api'
import type { PaymentType } from '@shared/enums'
import { lanClient } from '../lan/client'

export { LanError } from '../lan/client'

const client = lanClient('lifestyle.staff.token', {
  offline: 'Can’t reach the front desk computer.',
  unpaired: 'This phone isn’t paired.',
  failure: 'Something went wrong. Try again, or tell the front desk.'
})

export const { getToken, forgetToken, pair } = client

export const ping = () => client.call<{ gymName: string; deviceName: string | null }>('GET', '/api/ping')

export const listProducts = async (): Promise<StaffProduct[]> =>
  (await client.call<{ products: StaffProduct[] }>('GET', '/api/products')).products

export const todaysSales = async (): Promise<StaffSale[]> =>
  (await client.call<{ sales: StaffSale[] }>('GET', '/api/today')).sales

export const sell = async (input: {
  productId: string
  quantity: number
  paymentType: PaymentType
  memberId: string | null
}): Promise<StaffSale> => (await client.call<{ sale: StaffSale }>('POST', '/api/sell', input)).sale

/** Members matching a name or part of a phone number. */
export const findMembers = async (query: string): Promise<MemberChoice[]> =>
  (await client.call<{ members: MemberChoice[] }>('POST', '/api/members/find', { query })).members

export const membersCheckedInToday = async (): Promise<MemberChoice[]> =>
  (await client.call<{ members: MemberChoice[] }>('GET', '/api/members/today')).members

export const changeStock = (kind: 'received' | 'count', productId: string, quantity: number) =>
  client.call<StockResult>('POST', `/api/stock/${kind}`, { productId, quantity })

export const undo = (paymentId: string) => client.call<{ ok: true }>('POST', '/api/undo', { paymentId })
