import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { ReminderSettings, ReminderTemplates } from '../../shared/api'
import { addDays, todayIso } from '../../shared/dates'
import { REMINDER_KINDS, type ReminderKind } from '../../shared/enums'
import {
  DEFAULT_TEMPLATES,
  fillTemplate,
  reminderValues,
  whatsappNumber,
  type PackagePrice
} from '../../shared/reminders'
import {
  reminderInput,
  reminderSettingsInput,
  type ReminderInput,
  type ReminderSettingsInput
} from '../../shared/schemas'
import type { Db } from '../db/client'
import { membershipTypes, reminders } from '../db/schema'
import { AppError, nowUtc } from './errors'
import { getRegistration } from './registrations'
import { putSetting, readSettings } from './settings'

const templateKey = (kind: ReminderKind): string => `reminders.template.${kind}`
const PACKAGES_KEY = 'reminders.packages'
const POPULAR_COUNT = 5

/** The saved message for each kind, or the default where none was saved. */
export function reminderTemplates(db: Db): ReminderTemplates {
  const saved = readSettings(db, REMINDER_KINDS.map(templateKey))
  return Object.fromEntries(
    REMINDER_KINDS.map((kind) => [kind, saved.get(templateKey(kind)) ?? DEFAULT_TEMPLATES[kind]])
  ) as ReminderTemplates
}

/** The plans among `ids` that can still be offered: not archived or deleted. */
function currentPlans(db: Db, ids: string[]): (PackagePrice & { id: string })[] {
  if (ids.length === 0) return []
  return db
    .select({ id: membershipTypes.id, name: membershipTypes.name, price: membershipTypes.price })
    .from(membershipTypes)
    .where(and(inArray(membershipTypes.id, ids), eq(membershipTypes.archived, false)))
    .all()
}

/** Plans the owner picked to be ticked for {packages}, leaving out any since archived or deleted. */
export function chosenPackageIds(db: Db): string[] {
  const saved = readSettings(db, [PACKAGES_KEY]).get(PACKAGES_KEY)
  const ids: string[] = saved ? JSON.parse(saved) : []
  const current = new Set(currentPlans(db, ids).map((t) => t.id))
  return ids.filter((id) => current.has(id))
}

/** Current paid plans with the most registrations started in the last 12 months. */
export function popularPackageIds(db: Db): string[] {
  return db
    .all<{ id: string }>(
      sql`select mt.id from membership_types mt
        left join registrations r on r.membership_type_id = mt.id and r.start_date >= ${addDays(todayIso(), -365)}
        where mt.archived = 0 and mt.price > 0
        group by mt.id
        order by count(r.id) desc, mt.price
        limit ${POPULAR_COUNT}`
    )
    .map((r) => r.id)
}

/**
 * What {packages} lists: the plans picked when sending, or else the ones
 * ticked by default (chosen in Settings, or the most popular).
 */
export function reminderPackages(db: Db, picked?: string[]): PackagePrice[] {
  const chosen = chosenPackageIds(db)
  const ids = picked ?? (chosen.length > 0 ? chosen : popularPackageIds(db))
  return currentPlans(db, ids).map(({ name, price }) => ({ name, price }))
}

export function reminderSettings(db: Db): Omit<ReminderSettings, 'whatsappDesktop'> {
  return {
    templates: reminderTemplates(db),
    packageIds: chosenPackageIds(db),
    popularPackageIds: popularPackageIds(db)
  }
}

/**
 * A message equal to the default isn't stored, so it follows future changes
 * to the default. No chosen packages means "the most popular".
 */
export function saveReminderSettings(db: Db, raw: ReminderSettingsInput): void {
  const input = reminderSettingsInput.parse(raw)
  db.transaction((tx) => {
    for (const kind of REMINDER_KINDS) {
      const value = input.templates[kind]
      putSetting(tx, templateKey(kind), value === DEFAULT_TEMPLATES[kind] ? null : value)
    }
    putSetting(tx, PACKAGES_KEY, input.packageIds.length > 0 ? JSON.stringify(input.packageIds) : null)
  })
}

export interface PreparedReminder {
  registrationId: string
  kind: ReminderKind
  phone: string
  text: string
}

/** The WhatsApp number and filled-in message for one member of a registration. */
export function prepareReminder(db: Db, raw: ReminderInput): PreparedReminder {
  const input = reminderInput.parse(raw)
  const registration = getRegistration(db, input.registrationId)
  const member = registration.members.find((m) => m.id === input.memberId)
  if (!member) throw new AppError('That member is no longer on this registration.')
  const phone = whatsappNumber(member.mobileNumber)
  if (!phone) {
    throw new AppError(
      `${member.firstName}'s mobile number (${member.mobileNumber || 'none'}) can't be used for WhatsApp. Check it in their details.`
    )
  }
  const values = reminderValues({
    firstName: member.firstName,
    plan: registration.membershipTypeName,
    endDate: registration.endDate,
    balance: registration.balance,
    packages: reminderPackages(db, input.packageIds)
  })
  return {
    registrationId: registration.id,
    kind: input.kind,
    phone,
    text: fillTemplate(reminderTemplates(db)[input.kind], values)
  }
}

export function recordReminder(db: Db, reminder: Pick<PreparedReminder, 'registrationId' | 'kind'>): void {
  db.insert(reminders)
    .values({ id: randomUUID(), registrationId: reminder.registrationId, kind: reminder.kind, sentAt: nowUtc() })
    .run()
}
