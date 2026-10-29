import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  DURATION_TYPES,
  GENDERS,
  PAYMENT_CATEGORIES,
  PAYMENT_TYPES,
  PRODUCT_TYPES,
  REMINDER_KINDS,
  STOCK_CHANGE_KINDS,
  VISIT_SOURCES,
  VISIT_STATUSES
} from '../../shared/enums'

const timestamps = () => ({
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
})

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull().default(''),
    gender: text('gender', { enum: GENDERS }).notNull(),
    dob: text('dob'),
    mobileNumber: text('mobile_number'),
    secondaryNumber: text('secondary_number'),
    nic: text('nic'),
    address: text('address'),
    occupation: text('occupation'),
    weight: real('weight'),
    height: real('height'),
    ...timestamps()
  },
  (t) => [index('members_mobile_idx').on(t.mobileNumber)]
)

export const durations = sqliteTable('durations', {
  id: text('id').primaryKey(),
  duration: integer('duration').notNull(),
  durationType: text('duration_type', { enum: DURATION_TYPES }).notNull(),
  ...timestamps()
})

export const membershipTypes = sqliteTable('membership_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price: real('price').notNull(),
  numberOfMembers: integer('number_of_members').notNull(),
  durationId: text('duration_id')
    .notNull()
    .references(() => durations.id, { onDelete: 'restrict' }),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  /** Per new member, on top of the price. */
  joiningFee: real('joining_fee').notNull().default(0),
  ...timestamps()
})

export const registrations = sqliteTable(
  'registrations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    membershipTypeId: text('membership_type_id')
      .notNull()
      .references(() => membershipTypes.id, { onDelete: 'restrict' }),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    amount: real('amount').notNull(),
    dismissedAt: text('dismissed_at'),
    ...timestamps()
  },
  (t) => [index('registrations_end_idx').on(t.endDate), index('registrations_start_idx').on(t.startDate)]
)

export const registrationMembers = sqliteTable(
  'registration_members',
  {
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** What this member was charged to join; part of the registration amount. */
    joiningFee: real('joining_fee').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.registrationId, t.memberId] }), index('registration_members_member_idx').on(t.memberId)]
)

/** Personal trainers: the owner (no commission) and the trainers paid a commission on what they sell. */
export const trainers = sqliteTable('trainers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
  /** Fills in the commission on a new package; 0 for the owner. */
  commissionPercent: real('commission_percent').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...timestamps()
})

/** Personal training session types: so many sessions for a price, to use within a time. */
export const ptPackages = sqliteTable('pt_packages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sessions: integer('sessions').notNull(),
  price: real('price').notNull(),
  validDuration: integer('valid_duration').notNull(),
  validDurationType: text('valid_duration_type', { enum: DURATION_TYPES }).notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...timestamps()
})

/**
 * A member's personal training package, kept apart from membership
 * registrations. Sessions used are the visits that point at it.
 */
export const ptRegistrations = sqliteTable(
  'pt_registrations',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    trainerId: text('trainer_id')
      .notNull()
      .references(() => trainers.id, { onDelete: 'restrict' }),
    packageId: text('package_id').references(() => ptPackages.id, { onDelete: 'set null' }),
    /** Kept so the history reads the same after the session type is renamed or deleted. */
    packageName: text('package_name').notNull(),
    sessions: integer('sessions').notNull(),
    startDate: text('start_date').notNull(),
    /** Sessions left after this day can't be used. */
    endDate: text('end_date').notNull(),
    amount: real('amount').notNull(),
    /** The trainer's share of the amount, in rupees; 0 for the owner. */
    commission: real('commission').notNull().default(0),
    ...timestamps()
  },
  (t) => [
    index('pt_registrations_member_idx').on(t.memberId),
    index('pt_registrations_trainer_idx').on(t.trainerId),
    index('pt_registrations_start_idx').on(t.startDate),
    index('pt_registrations_end_idx').on(t.endDate)
  ]
)

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  productType: text('product_type', { enum: PRODUCT_TYPES }).notNull(),
  quantity: integer('quantity').notNull(),
  price: real('price').notNull(),
  sellingPrice: real('selling_price').notNull(),
  sold: integer('sold').notNull().default(0),
  ...timestamps()
})

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    registrationId: text('registration_id').references(() => registrations.id, { onDelete: 'restrict' }),
    /** Migrated payments whose registration had been deleted in the old app. */
    legacyRegistrationId: text('legacy_registration_id'),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    quantity: integer('quantity'),
    amount: real('amount').notNull(),
    paymentType: text('payment_type', { enum: PAYMENT_TYPES }).notNull(),
    category: text('category', { enum: PAYMENT_CATEGORIES }).notNull(),
    /** Local time 'YYYY-MM-DDTHH:mm:ss'. Null only for a few migrated payments. */
    paidAt: text('paid_at'),
    /** Shown as R-00124. Numbered in date order for migrated payments. */
    receiptNo: integer('receipt_no'),
    /** Store sales: the member who bought it, if they're one. */
    memberId: text('member_id').references(() => members.id, { onDelete: 'set null' }),
    /** The instructor who recorded it on their phone (their name at the time); null at the front desk. */
    recordedBy: text('recorded_by'),
    /** The instructor's phone, for its own list of today's sales and Undo. */
    deviceId: text('device_id'),
    /** A payment towards a personal training package. */
    ptRegistrationId: text('pt_registration_id').references(() => ptRegistrations.id, { onDelete: 'restrict' }),
    /** Store sales: the product's cost price when sold, for the accounts. Null on sales from before it was kept. */
    unitCost: real('unit_cost'),
    ...timestamps()
  },
  (t) => [
    index('payments_paid_at_idx').on(t.paidAt),
    index('payments_registration_idx').on(t.registrationId),
    index('payments_member_idx').on(t.memberId),
    index('payments_pt_registration_idx').on(t.ptRegistrationId),
    uniqueIndex('payments_receipt_no_idx').on(t.receiptNo)
  ]
)

/** Stock received or counted. Sales are in payments. */
export const stockChanges = sqliteTable(
  'stock_changes',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: STOCK_CHANGE_KINDS }).notNull(),
    /** +12 for a delivery; for a count, the difference from what was recorded (−2). */
    change: integer('change').notNull(),
    quantityAfter: integer('quantity_after').notNull(),
    /** As on payments: the instructor's name, or null at the front desk. */
    recordedBy: text('recorded_by'),
    deviceId: text('device_id'),
    /** Local time 'YYYY-MM-DDTHH:mm:ss'. */
    changedAt: text('changed_at').notNull()
  },
  (t) => [index('stock_changes_changed_at_idx').on(t.changedAt), index('stock_changes_product_idx').on(t.productId)]
)

/**
 * Store items a member took to pay for later. Not income: what they pay
 * towards them is a payment (category STORE_CREDIT), oldest items first.
 */
export const creditSales = sqliteTable(
  'credit_sales',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Kept so reminders still say what they took after the product is deleted. */
    productName: text('product_name').notNull(),
    quantity: integer('quantity').notNull(),
    amount: real('amount').notNull(),
    /** As on payments: the cost price when sold. */
    unitCost: real('unit_cost'),
    /** Local time 'YYYY-MM-DDTHH:mm:ss'. */
    soldAt: text('sold_at').notNull(),
    /** As on payments: the instructor's name, or null at the front desk. */
    recordedBy: text('recorded_by'),
    deviceId: text('device_id')
  },
  (t) => [index('credit_sales_member_idx').on(t.memberId), index('credit_sales_sold_at_idx').on(t.soldAt)]
)

/** WhatsApp reminders about store credit (the others are per registration, in reminders). */
export const creditReminders = sqliteTable(
  'credit_reminders',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    sentAt: text('sent_at').notNull()
  },
  (t) => [index('credit_reminders_member_idx').on(t.memberId)]
)

/** Check-ins at the door tablet or the front desk. */
export const visits = sqliteTable(
  'visits',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** Local time 'YYYY-MM-DDTHH:mm:ss'. */
    checkedInAt: text('checked_in_at').notNull(),
    source: text('source', { enum: VISIT_SOURCES }).notNull(),
    status: text('status', { enum: VISIT_STATUSES }).notNull(),
    /** A personal training session: it uses one of that package's sessions. */
    ptRegistrationId: text('pt_registration_id').references(() => ptRegistrations.id, { onDelete: 'set null' })
  },
  (t) => [
    index('visits_checked_in_idx').on(t.checkedInAt),
    index('visits_member_idx').on(t.memberId),
    index('visits_pt_registration_idx').on(t.ptRegistrationId)
  ]
)

/** WhatsApp messages opened from the app, so staff can see who has been contacted. */
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: REMINDER_KINDS }).notNull(),
    sentAt: text('sent_at').notNull()
  },
  (t) => [index('reminders_registration_idx').on(t.registrationId)]
)

/** App settings that travel with the database (and so with backups). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
