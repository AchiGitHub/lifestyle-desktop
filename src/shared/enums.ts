export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const
export type Gender = (typeof GENDERS)[number]
export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other'
}

export const DURATION_TYPES = ['DAY', 'MONTH', 'YEAR'] as const
export type DurationType = (typeof DURATION_TYPES)[number]
export const DURATION_TYPE_LABELS: Record<DurationType, string> = {
  DAY: 'Day',
  MONTH: 'Month',
  YEAR: 'Year'
}

/** ONLINE is bank transfer; the old app's name for it is kept in the data. */
export const PAYMENT_TYPES = ['CASH', 'CARD', 'ONLINE'] as const
export type PaymentType = (typeof PAYMENT_TYPES)[number]
export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  ONLINE: 'Bank transfer'
}

/** How a store sale is settled: paid now, or on credit to a member who pays later. */
export const SALE_METHODS = [...PAYMENT_TYPES, 'CREDIT'] as const
export type SaleMethod = (typeof SALE_METHODS)[number]
export const SALE_METHOD_LABELS: Record<SaleMethod, string> = { ...PAYMENT_TYPE_LABELS, CREDIT: 'On credit' }

export const PRODUCT_TYPES = ['SUPPLEMENT', 'BEVERAGE', 'OTHER'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  SUPPLEMENT: 'Supplement',
  BEVERAGE: 'Beverage',
  OTHER: 'Other'
}

/** Stock at or below this shows as running low. */
export const LOW_STOCK = 5

/** How stock changed other than by a sale: a delivery, or a count of the shelf. */
export const STOCK_CHANGE_KINDS = ['RECEIVED', 'COUNT'] as const
export type StockChangeKind = (typeof STOCK_CHANGE_KINDS)[number]
export const STOCK_CHANGE_KIND_LABELS: Record<StockChangeKind, string> = { RECEIVED: 'Received', COUNT: 'Count' }

/**
 * Store sales use the product type as their category. STORE_CREDIT is money
 * paid towards items taken on credit; the items themselves are in credit_sales.
 */
export const PAYMENT_CATEGORIES = [
  'MEMBERSHIP',
  'PERSONAL_TRAINING',
  'SUPPLEMENT',
  'BEVERAGE',
  'OTHER',
  'STORE_CREDIT'
] as const
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number]
export const PAYMENT_CATEGORY_LABELS: Record<PaymentCategory, string> = {
  MEMBERSHIP: 'Membership fees',
  PERSONAL_TRAINING: 'Personal training',
  SUPPLEMENT: 'Supplements',
  BEVERAGE: 'Beverages',
  OTHER: 'Other sales',
  STORE_CREDIT: 'Credit paid'
}
export const STORE_CATEGORIES: PaymentCategory[] = ['SUPPLEMENT', 'BEVERAGE', 'OTHER']

/** Which income heading a payment is under: memberships, personal training, or the store (credit paid included). */
export function incomeGroup(category: PaymentCategory): 'memberships' | 'personalTraining' | 'store' {
  if (category === 'MEMBERSHIP') return 'memberships'
  if (category === 'PERSONAL_TRAINING') return 'personalTraining'
  return 'store'
}

export const VISIT_SOURCES = ['DOOR', 'DESK'] as const
export type VisitSource = (typeof VISIT_SOURCES)[number]
export const VISIT_SOURCE_LABELS: Record<VisitSource, string> = { DOOR: 'Door tablet', DESK: 'Front desk' }

/** The member's state when they checked in. */
export const VISIT_STATUSES = ['OK', 'EXPIRED', 'OWES', 'NO_PLAN'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  OK: 'Active',
  EXPIRED: 'Expired',
  OWES: 'Owes money',
  NO_PLAN: 'No plan'
}

/** What a WhatsApp reminder is about. CREDIT is about the member's store credit, not a registration. */
export const REMINDER_KINDS = ['EXPIRING', 'EXPIRED', 'BALANCE', 'CREDIT'] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]
export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  EXPIRING: 'Membership ending soon',
  EXPIRED: 'Membership has ended',
  BALANCE: 'Balance still to pay',
  CREDIT: 'Store items on credit'
}

export function durationLabel(duration: number, type: DurationType): string {
  const unit = DURATION_TYPE_LABELS[type].toLowerCase()
  return `${duration} ${unit}${duration === 1 ? '' : 's'}`
}
