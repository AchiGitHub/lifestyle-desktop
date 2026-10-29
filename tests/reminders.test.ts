import { count, eq, like } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/client'
import { membershipTypes, reminders, settings } from '../src/main/db/schema'
import { AppError } from '../src/main/services/errors'
import { deleteRegistrations, getRegistration } from '../src/main/services/registrations'
import {
  chosenPackageIds,
  popularPackageIds,
  prepareReminder,
  recordReminder,
  reminderPackages,
  reminderTemplates,
  saveReminderSettings
} from '../src/main/services/reminders'
import { addDays, todayIso } from '../src/shared/dates'
import {
  DEFAULT_TEMPLATES,
  fillTemplate,
  packageLines,
  reminderValues,
  whatsappNumber
} from '../src/shared/reminders'
import { MOBILE_HINT, memberInput } from '../src/shared/schemas'
import { makeDb, memberData, seedMember, seedPlan, seedRegistration } from './helpers'

describe('whatsappNumber', () => {
  it.each([
    ['0771234567', '94771234567'],
    ['077 123 4567', '94771234567'],
    ['077-1234567', '94771234567'],
    ['771234567', '94771234567'],
    ['94771234567', '94771234567'],
    ['+94 77 123 4567', '94771234567'],
    ['+94 077 123 4567', '94771234567'],
    ['0094771234567', '94771234567'],
    ['+0771234567', '94771234567'],
    ['+44 7700 900123', '447700900123']
  ])('%s → %s', (raw, expected) => {
    expect(whatsappNumber(raw)).toBe(expected)
  })

  it.each([null, '', '12345', '+9477123456', '0771234567 / 0711234567'])('rejects %s', (raw) => {
    expect(whatsappNumber(raw)).toBeNull()
  })

  it('is what the member form accepts', () => {
    const check = (mobileNumber: string) => memberInput.safeParse(memberData({ mobileNumber }))
    for (const ok of ['077 123 4567', '+94 77 123 4567', '+44 7700 900123']) expect(check(ok).success).toBe(true)
    // Shapes found in the old data: a digit short, a digit extra, "N/A", two numbers in one field.
    for (const bad of ['077123456', '07712345678', 'N/A', '0771234567, 0711234567']) {
      expect(check(bad).error?.issues[0].message).toBe(MOBILE_HINT)
    }
    expect(check('').error?.issues[0].message).toBe('Mobile number is required')
  })
})

describe('message templates', () => {
  const values = reminderValues({
    firstName: 'NIMAL',
    plan: 'Gold',
    endDate: '2026-11-03',
    balance: 8000,
    packages: [
      { name: 'Gold', price: 12000 },
      { name: 'Silver', price: 6000 }
    ]
  })

  it('formats names, dates, money and the package list the way the app shows them', () => {
    expect(values).toEqual({
      name: 'Nimal',
      plan: 'Gold',
      endDate: '3 Nov 2026',
      balance: 'Rs. 8,000',
      packages: '• Silver – Rs. 6,000\n• Gold – Rs. 12,000'
    })
    expect(packageLines([])).toBe('')
  })

  it('fills known placeholders and leaves anything else alone', () => {
    expect(fillTemplate('Hi {name}, {plan} ends {endDate}. Due: {balance}. {other} {toString}', values)).toBe(
      'Hi Nimal, Gold ends 3 Nov 2026. Due: Rs. 8,000. {other} {toString}'
    )
  })
})

describe('reminders', () => {
  let db: Db
  let typeId: string
  let registrationId: string
  let memberId: string
  const today = todayIso()

  beforeEach(() => {
    db = makeDb()
    typeId = seedPlan(db)
    memberId = seedMember(db, { firstName: 'Kamal', mobileNumber: '071 111 1111' })
    registrationId = seedRegistration(db, typeId, [memberId], addDays(today, -25), addDays(today, 5))
  })

  const save = (templates = {}, packageIds: string[] = []) =>
    saveReminderSettings(db, { templates: { ...DEFAULT_TEMPLATES, ...templates }, packageIds })
  const plan = (price: number, registrationsStarted: string[], archived = false) => {
    const id = seedPlan(db, { price })
    for (const start of registrationsStarted) seedRegistration(db, id, [memberId], start, addDays(start, 30))
    if (archived) db.update(membershipTypes).set({ archived: true }).where(eq(membershipTypes.id, id)).run()
    return id
  }

  it('uses the default messages until they are changed', () => {
    expect(reminderTemplates(db)).toEqual(DEFAULT_TEMPLATES)
    save({ EXPIRING: 'Hello {name}' })
    expect(reminderTemplates(db).EXPIRING).toBe('Hello {name}')
    expect(reminderTemplates(db).EXPIRED).toBe(DEFAULT_TEMPLATES.EXPIRED)
    // Setting a message back to the default, with no packages chosen, stores nothing.
    save()
    expect(db.select({ n: count() }).from(settings).where(like(settings.key, 'reminders.%')).get()!.n).toBe(0)
  })

  it('refuses an empty message', () => {
    expect(() => save({ BALANCE: '   ' })).toThrow()
  })

  it('lists the most popular current paid plans of the last 12 months', () => {
    const recent = addDays(today, -60)
    const old = addDays(today, -800)
    const busy = plan(6000, [recent, recent, recent])
    const quiet = plan(15000, [recent])
    const once = plan(9000, [old, old, old])
    plan(0, [recent, recent, recent, recent]) // complimentary
    plan(7000, [recent, recent, recent, recent], true) // archived
    // Ties go to the cheaper plan; the beforeEach plan (Rs. 10,000) has one recent registration.
    expect(popularPackageIds(db)).toEqual([busy, typeId, quiet, once])
  })

  it('lists the chosen plans instead, skipping any archived since', () => {
    const chosen = plan(9000, [])
    const retired = plan(7000, [], true)
    save({}, [chosen, retired])
    expect(chosenPackageIds(db)).toEqual([chosen])
    expect(reminderPackages(db)).toEqual([{ name: expect.any(String), price: 9000 }])
    save({}, [])
    expect(chosenPackageIds(db)).toEqual([])
  })

  it('fills in the member, plan, end date, balance and packages', () => {
    plan(6000, [addDays(today, -10)])
    save({ BALANCE: '{name} owes {balance}, ends {endDate}', EXPIRING: 'Prices:\n{packages}' })
    const balance = prepareReminder(db, { registrationId, memberId, kind: 'BALANCE' })
    const { endDate } = reminderValues({ firstName: '', plan: '', endDate: addDays(today, 5), balance: 0, packages: [] })
    expect(balance.phone).toBe('94711111111')
    expect(balance.text).toBe(`Kamal owes Rs. 10,000, ends ${endDate}`)
    const expiring = prepareReminder(db, { registrationId, memberId, kind: 'EXPIRING' })
    expect(expiring.text).toMatch(/^Prices:\n• Plan \w+ – Rs\. 6,000\n• Plan \w+ – Rs\. 10,000$/)
  })

  it('lists the packages picked when sending, instead of the defaults', () => {
    const cheap = plan(6000, [addDays(today, -10)])
    const dear = plan(25000, [])
    const retired = plan(7000, [], true)
    save({ EXPIRED: '{packages}' }, [cheap])
    const text = (packageIds?: string[]) => prepareReminder(db, { registrationId, memberId, kind: 'EXPIRED', packageIds }).text
    expect(text()).toMatch(/^• Plan \w+ – Rs\. 6,000$/)
    expect(text([dear, retired, 'deleted'])).toMatch(/^• Plan \w+ – Rs\. 25,000$/)
    expect(text([dear, cheap])).toMatch(/^• Plan \w+ – Rs\. 6,000\n• Plan \w+ – Rs\. 25,000$/)
    expect(text([])).toBe('')
  })

  it('explains when a member can’t be messaged', () => {
    const noPhone = seedMember(db, { mobileNumber: '12345' })
    const other = seedRegistration(db, typeId, [noPhone], today, addDays(today, 30))
    expect(() => prepareReminder(db, { registrationId: other, memberId: noPhone, kind: 'EXPIRING' })).toThrow(AppError)
    expect(() => prepareReminder(db, { registrationId, memberId: noPhone, kind: 'EXPIRING' })).toThrow(
      /no longer on this registration/
    )
  })

  it('shows renewal reminders on the registration, but not payment reminders', () => {
    expect(getRegistration(db, registrationId).remindedAt).toBeNull()
    recordReminder(db, { registrationId, kind: 'BALANCE' })
    expect(getRegistration(db, registrationId).remindedAt).toBeNull()
    recordReminder(db, { registrationId, kind: 'EXPIRING' })
    expect(getRegistration(db, registrationId).remindedAt).not.toBeNull()
  })

  it('removes reminders with their registration', () => {
    recordReminder(db, { registrationId, kind: 'EXPIRING' })
    deleteRegistrations(db, [registrationId])
    expect(db.select().from(reminders).where(eq(reminders.registrationId, registrationId)).all()).toEqual([])
  })
})
