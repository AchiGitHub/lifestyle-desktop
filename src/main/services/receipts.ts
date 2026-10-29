import { and, eq, isNotNull, lte, sum } from 'drizzle-orm'
import type { Receipt, ReceiptSettings } from '../../shared/api'
import { addDays, nowLocalIso, todayIso } from '../../shared/dates'
import { PAYMENT_CATEGORY_LABELS } from '../../shared/enums'
import { longDate, receiptNumber, rupees } from '../../shared/format'
import { whatsappNumber } from '../../shared/reminders'
import {
  receiptRecipientInput,
  receiptSettingsInput,
  type ReceiptRecipientInput,
  type ReceiptSettingsInput
} from '../../shared/schemas'
import type { Db } from '../db/client'
import { members, payments, products } from '../db/schema'
import { AppError } from './errors'
import { getRegistration } from './registrations'
import { putSetting, readSettings } from './settings'

const DEFAULTS: ReceiptSettings = {
  gymName: 'Lifestyle Fitness Studio',
  address: '',
  phone: '',
  footer: 'Thank you!',
  ownerPhone: ''
}
const FIELDS = Object.keys(DEFAULTS) as (keyof ReceiptSettings)[]
const settingKey = (field: keyof ReceiptSettings): string => `receipt.${field}`

export function receiptSettings(db: Db): ReceiptSettings {
  const saved = readSettings(db, FIELDS.map(settingKey))
  const result = { ...DEFAULTS }
  for (const f of FIELDS) result[f] = saved.get(settingKey(f)) ?? DEFAULTS[f]
  return result
}

export function saveReceiptSettings(db: Db, raw: ReceiptSettingsInput): void {
  const input = receiptSettingsInput.parse(raw)
  if (input.ownerPhone && !whatsappNumber(input.ownerPhone)) {
    throw new AppError("The owner's WhatsApp number doesn't look like a mobile number.")
  }
  db.transaction((tx) => {
    for (const f of FIELDS) putSetting(tx, settingKey(f), input[f] === DEFAULTS[f] ? null : input[f])
  })
}

/**
 * What a receipt shows. For a membership payment the balance is as it stood
 * right after this payment, so a reprinted old receipt reads the same.
 */
export function getReceipt(db: Db, paymentId: string): Receipt {
  const payment = db.select().from(payments).where(eq(payments.id, paymentId)).get()
  if (!payment) throw new AppError('That payment no longer exists.')
  const base = {
    paymentId,
    number: payment.receiptNo ? receiptNumber(payment.receiptNo) : null,
    paidAt: payment.paidAt,
    method: payment.paymentType,
    category: payment.category,
    amount: payment.amount,
    gym: receiptSettings(db)
  }

  if (payment.registrationId) {
    const registration = getRegistration(db, payment.registrationId)
    const paid =
      payment.receiptNo === null
        ? registration.paid
        : Number(
            db
              .select({ total: sum(payments.amount) })
              .from(payments)
              .where(
                and(
                  eq(payments.registrationId, registration.id),
                  isNotNull(payments.receiptNo),
                  lte(payments.receiptNo, payment.receiptNo)
                )
              )
              .get()?.total ?? 0
          )
    return {
      ...base,
      members: registration.members,
      item: registration.membershipTypeName,
      detail: `${longDate(registration.startDate)} – ${longDate(registration.endDate)}`,
      registration: {
        total: registration.amount,
        joiningFee: registration.joiningFee,
        paid,
        balance: Math.max(0, registration.amount - paid)
      }
    }
  }

  const product = payment.productId
    ? db.select({ name: products.name }).from(products).where(eq(products.id, payment.productId)).get()
    : undefined
  // A store sale names its buyer, so the receipt can go to their WhatsApp.
  const buyer = payment.memberId
    ? db
        .select({
          id: members.id,
          firstName: members.firstName,
          lastName: members.lastName,
          mobileNumber: members.mobileNumber
        })
        .from(members)
        .where(eq(members.id, payment.memberId))
        .get()
    : undefined
  return {
    ...base,
    members: buyer ? [buyer] : [],
    item: product?.name ?? (payment.legacyRegistrationId ? 'Membership fee' : PAYMENT_CATEGORY_LABELS[payment.category]),
    detail: payment.quantity ? `${payment.quantity} × ${rupees(payment.amount / payment.quantity)}` : null,
    registration: null
  }
}

/** A made-up receipt with the gym's details, for checking the printer. */
export function sampleReceipt(db: Db): Receipt {
  const today = todayIso()
  return {
    paymentId: 'sample',
    number: receiptNumber(124),
    paidAt: nowLocalIso(),
    method: 'CASH',
    category: 'MEMBERSHIP',
    amount: 6000,
    gym: receiptSettings(db),
    members: [{ id: 'sample', firstName: 'Nimal', lastName: 'Perera', mobileNumber: null }],
    item: 'One Month',
    detail: `${longDate(today)} – ${longDate(addDays(today, 30))}`,
    registration: { total: 12000, joiningFee: 2000, paid: 6000, balance: 6000 }
  }
}

/** The WhatsApp number a receipt goes to: a member on it, or a number typed in. */
export function receiptRecipient(receipt: Receipt, raw: ReceiptRecipientInput): string {
  const to = receiptRecipientInput.parse(raw)
  if ('memberId' in to) {
    const member = receipt.members.find((m) => m.id === to.memberId)
    if (!member) throw new AppError("That member isn't on this receipt.")
    const phone = whatsappNumber(member.mobileNumber)
    if (!phone) throw new AppError(`${member.firstName}'s mobile number can't be used for WhatsApp.`)
    return phone
  }
  const phone = whatsappNumber(to.phone)
  if (!phone) throw new AppError("That mobile number doesn't look right.")
  return phone
}
