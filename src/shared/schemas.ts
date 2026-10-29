import { z } from 'zod'
import {
  DURATION_TYPES,
  GENDERS,
  PAYMENT_CATEGORIES,
  PAYMENT_TYPES,
  PRODUCT_TYPES,
  REMINDER_KINDS,
  SALE_METHODS
} from './enums'
import { whatsappNumber } from './reminders'

// Form inputs hand over '' for empty fields; store those as null.
const emptyToNull = (v: unknown): unknown => (v === '' || v === undefined ? null : v)

const isoDate = z.string({ error: 'Pick a date' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : emptyToNull(v)),
  z.string().trim().nullable()
)
const optionalPositive = z.preprocess(emptyToNull, z.number().positive('Must be more than 0').nullable())
const money = (label: string) =>
  z.number({ error: `Enter the ${label}` }).min(0, `${label[0].toUpperCase()}${label.slice(1)} can't be negative`)
const id = (message: string) => z.string({ error: message }).min(1, message)
export const MOBILE_HINT = 'Enter a valid mobile number, e.g. 077 123 4567, or + and the country code for a foreign one'

export const memberInput = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  gender: z.enum(GENDERS, { error: 'Choose a gender' }),
  dob: z.preprocess(emptyToNull, isoDate.nullable()),
  // Must work for WhatsApp reminders and receipts: 10 digits (077 123 4567), or + and a country code.
  mobileNumber: z
    .string()
    .trim()
    .min(1, 'Mobile number is required')
    .refine((v) => whatsappNumber(v) !== null, MOBILE_HINT),
  secondaryNumber: optionalText,
  nic: optionalText,
  address: optionalText,
  occupation: optionalText,
  weight: optionalPositive,
  height: optionalPositive
})
export type MemberInput = z.input<typeof memberInput>
export type MemberData = z.output<typeof memberInput>

export const durationInput = z.object({
  duration: z.number({ error: 'Enter a number' }).int('Whole numbers only').min(1, 'Must be at least 1'),
  durationType: z.enum(DURATION_TYPES, { error: 'Choose days, months or years' })
})
export type DurationInput = z.input<typeof durationInput>

export const membershipTypeInput = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  price: money('price'),
  numberOfMembers: z
    .number({ error: 'Enter the number of members' })
    .int('Whole numbers only')
    .min(1, 'At least 1 member')
    .max(10, 'At most 10 members'),
  durationId: id('Choose a duration'),
  /** Charged once per new member, on top of the price. */
  joiningFee: money('joining fee')
})
export type MembershipTypeInput = z.input<typeof membershipTypeInput>

// Whether this member pays the plan's joining fee. Left out or null: the usual
// rule decides (new members, and anyone back after a long break).
const chargeJoiningFee = z.boolean().nullable().optional()

export const registrationMemberInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), memberId: id('Choose a member'), chargeJoiningFee }),
  z.object({ kind: z.literal('new'), member: memberInput, chargeJoiningFee })
])
export type RegistrationMemberInput = z.input<typeof registrationMemberInput>

export const registrationCreateInput = z
  .object({
    membershipTypeId: id('Choose a plan'),
    startDate: isoDate,
    endDate: isoDate,
    /** The plan price agreed, without joining fees (those are added per member). */
    amount: money('amount'),
    members: z.array(registrationMemberInput).min(1, 'Add at least one member'),
    payment: z.object({
      amount: money('amount paid'),
      paymentType: z.enum(PAYMENT_TYPES, { error: 'Choose how they paid' })
    })
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate']
  })
  .refine(
    (v) => {
      const ids = v.members.flatMap((m) => (m.kind === 'existing' ? [m.memberId] : []))
      return new Set(ids).size === ids.length
    },
    { message: 'The same member is added twice', path: ['members'] }
  )
export type RegistrationCreateInput = z.input<typeof registrationCreateInput>

export const registrationUpdateInput = z
  .object({
    membershipTypeId: id('Choose a plan'),
    startDate: isoDate,
    endDate: isoDate,
    amount: money('amount')
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate']
  })
export type RegistrationUpdateInput = z.input<typeof registrationUpdateInput>

export const paymentAddInput = z.object({
  registrationId: id('Choose a registration'),
  amount: z.number({ error: 'Enter the amount' }).positive('Must be more than 0'),
  paymentType: z.enum(PAYMENT_TYPES, { error: 'Choose how they paid' })
})
export type PaymentAddInput = z.input<typeof paymentAddInput>

export const paymentFilterInput = z.object({
  from: isoDate,
  to: isoDate,
  categories: z.array(z.enum(PAYMENT_CATEGORIES)).optional(),
  paymentType: z.enum(PAYMENT_TYPES).nullable().optional()
})
export type PaymentFilterInput = z.input<typeof paymentFilterInput>

export const productInput = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  productType: z.enum(PRODUCT_TYPES, { error: 'Choose a type' }),
  quantity: z.number({ error: 'Enter the stock' }).int('Whole numbers only').min(0, "Stock can't be negative"),
  price: money('cost price'),
  sellingPrice: money('selling price')
})
export type ProductInput = z.input<typeof productInput>

/** Editing a product never changes its stock: that's Received or Count, so a sale made meanwhile isn't undone. */
export const productEditInput = productInput.omit({ quantity: true })
export type ProductEditInput = z.input<typeof productEditInput>

const stockQuantity = z.number({ error: 'Enter a number' }).int('Whole numbers only')
export const stockReceivedInput = z.object({
  productId: id('Choose a product'),
  quantity: stockQuantity.min(1, 'At least 1')
})
export const stockCountInput = z.object({
  productId: id('Choose a product'),
  quantity: stockQuantity.min(0, "Stock can't be negative")
})
export type StockInput = z.input<typeof stockCountInput>

export const sellInput = z
  .object({
    productId: id('Choose a product'),
    quantity: z.number({ error: 'Enter a quantity' }).int('Whole numbers only').min(1, 'At least 1'),
    paymentType: z.enum(SALE_METHODS, { error: 'Choose how they paid' }),
    /** The member who bought it; none for a walk-in. */
    memberId: z.string().min(1).nullish()
  })
  .refine((v) => v.paymentType !== 'CREDIT' || Boolean(v.memberId), {
    message: 'Choose who’s buying: only members can pay later.',
    path: ['memberId']
  })
export type SellInput = z.input<typeof sellInput>

/** Money towards a member's store credit; the oldest items are paid off first. */
export const creditPaymentInput = z.object({
  memberId: id('Choose a member'),
  amount: z.number({ error: 'Enter the amount' }).positive('Must be more than 0'),
  paymentType: z.enum(PAYMENT_TYPES, { error: 'Choose how they paid' })
})
export type CreditPaymentInput = z.input<typeof creditPaymentInput>

export const trainerInput = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  /** The owner gets no commission. */
  isOwner: z.boolean(),
  commissionPercent: z
    .number({ error: 'Enter a percentage' })
    .min(0, "Can't be negative")
    .max(100, 'At most 100%')
})
export type TrainerInput = z.input<typeof trainerInput>

const ptSessions = z
  .number({ error: 'Enter the number of sessions' })
  .int('Whole numbers only')
  .min(1, 'At least 1 session')
  .max(500, 'At most 500 sessions')

/** A personal training session type: so many sessions for a price, used within a time. */
export const ptPackageInput = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  sessions: ptSessions,
  price: money('price'),
  validDuration: durationInput.shape.duration,
  validDurationType: durationInput.shape.durationType
})
export type PtPackageInput = z.input<typeof ptPackageInput>

const ptTerms = {
  trainerId: id('Choose a trainer'),
  sessions: ptSessions,
  startDate: isoDate,
  endDate: isoDate,
  amount: money('price'),
  /** The trainer's share, in rupees. */
  commission: money('commission')
}
const endsAfterStart = (v: { startDate: string; endDate: string }) => v.endDate >= v.startDate
const commissionWithin = (v: { amount: number; commission: number }) => v.commission <= v.amount
const ENDS_AFTER_START = { message: 'Must be on or after the start date', path: ['endDate'] }
const COMMISSION_WITHIN = { message: 'Can’t be more than the price', path: ['commission'] }

export const ptCreateInput = z
  .object({
    memberId: id('Choose a member'),
    packageId: id('Choose a session type'),
    ...ptTerms,
    payment: z.object({
      amount: money('amount paid'),
      paymentType: z.enum(PAYMENT_TYPES, { error: 'Choose how they paid' })
    })
  })
  .refine(endsAfterStart, ENDS_AFTER_START)
  .refine(commissionWithin, COMMISSION_WITHIN)
  .refine((v) => v.payment.amount <= v.amount, { message: 'More than the price', path: ['payment', 'amount'] })
export type PtCreateInput = z.input<typeof ptCreateInput>

export const ptUpdateInput = z
  .object(ptTerms)
  .refine(endsAfterStart, ENDS_AFTER_START)
  .refine(commissionWithin, COMMISSION_WITHIN)
export type PtUpdateInput = z.input<typeof ptUpdateInput>

export const ptPaymentInput = z.object({
  ptRegistrationId: id('Choose a package'),
  amount: z.number({ error: 'Enter the amount' }).positive('Must be more than 0'),
  paymentType: z.enum(PAYMENT_TYPES, { error: 'Choose how they paid' })
})
export type PtPaymentInput = z.input<typeof ptPaymentInput>

export const dateRangeInput = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: 'End must be after start', path: ['to'] })
export type DateRangeInput = z.input<typeof dateRangeInput>

/** 'YYYY-MM' */
export const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month')

export const passwordInput = z.string().min(6, 'Use at least 6 characters')

export const joiningFeeSettingsInput = z.object({
  breakDays: z
    .number({ error: 'Enter a number of days' })
    .int('Whole days only')
    .min(0, "Can't be negative")
    .max(3650, 'At most 3650 days')
})
export type JoiningFeeSettingsInput = z.input<typeof joiningFeeSettingsInput>

export const receiptRecipientInput = z.union([
  z.object({ memberId: id('Choose who to send it to') }),
  z.object({ phone: z.string().trim().min(1, 'Enter a mobile number') })
])
export type ReceiptRecipientInput = z.input<typeof receiptRecipientInput>

const shortText = z.string().trim().max(200, 'Keep it under 200 characters')
export const receiptSettingsInput = z.object({
  gymName: shortText.min(1, 'The gym name is required'),
  address: shortText,
  phone: shortText,
  footer: shortText,
  ownerPhone: shortText
})
export type ReceiptSettingsInput = z.input<typeof receiptSettingsInput>

/** The owner's Google account for the daily summary sheet; '' for nobody. */
export const ownerEmailInput = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.union([z.literal(''), z.email('Enter the owner’s Google (Gmail) address, e.g. name@gmail.com')])
)

const packageIds = z.array(z.string()).max(8, 'List at most 8 packages')

export const reminderInput = z.object({
  registrationId: id('Choose a registration'),
  memberId: id('Choose a member'),
  // Store credit isn't about a registration: that's reminders.sendCredit.
  kind: z.enum(REMINDER_KINDS).exclude(['CREDIT']),
  /** The plans {packages} lists in this message; left out, the ones ticked by default. */
  packageIds: packageIds.optional()
})
export type ReminderInput = z.input<typeof reminderInput>

// Kept short: the message travels inside a link, and Sinhala text takes ~9 characters per letter there.
const template = z.string().trim().min(1, 'The message can’t be empty').max(600, 'Keep the message under 600 characters')
export const reminderSettingsInput = z.object({
  templates: z.object({ EXPIRING: template, EXPIRED: template, BALANCE: template, CREDIT: template }),
  /** Plans ticked for {packages} when a reminder is sent; empty means the most popular ones. */
  packageIds
})
export type ReminderSettingsInput = z.input<typeof reminderSettingsInput>
