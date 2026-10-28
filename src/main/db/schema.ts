import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  DURATION_TYPES,
  GENDERS,
  PAYMENT_CATEGORIES,
  PAYMENT_TYPES,
  PRODUCT_TYPES,
  REMINDER_KINDS,
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
    ...timestamps()
  },
  (t) => [
    index('payments_paid_at_idx').on(t.paidAt),
    index('payments_registration_idx').on(t.registrationId),
    uniqueIndex('payments_receipt_no_idx').on(t.receiptNo)
  ]
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
    status: text('status', { enum: VISIT_STATUSES }).notNull()
  },
  (t) => [index('visits_checked_in_idx').on(t.checkedInAt), index('visits_member_idx').on(t.memberId)]
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
