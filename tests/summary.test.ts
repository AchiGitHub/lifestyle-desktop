import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/client'
import { payments, registrations, visits } from '../src/main/db/schema'
import { daySummaries, daySummary } from '../src/main/services/summary'
import { summaryRows, titleRows, toCsv } from '../src/main/summary/sheet'
import { syncSheet, type SheetStore } from '../src/main/summary/sync'
import type { DaySummary } from '../src/shared/api'
import type { PaymentCategory, PaymentType } from '../src/shared/enums'
import { daySummaryText } from '../src/shared/receipts'
import { makeDb, seedMember, seedPlan, seedRegistration } from './helpers'

let db: Db
let plan: string

beforeEach(() => {
  db = makeDb()
  plan = seedPlan(db)
})

/** A registration entered at 10 am local time on `enteredOn`. */
function register(memberIds: string[], start: string, enteredOn: string): string {
  const id = seedRegistration(db, plan, memberIds, start, '2026-12-31')
  const [y, m, d] = enteredOn.split('-').map(Number)
  db.update(registrations)
    .set({ createdAt: new Date(y, m - 1, d, 10).toISOString() })
    .where(eq(registrations.id, id))
    .run()
  return id
}

function pay(registrationId: string | null, amount: number, paymentType: PaymentType, category: PaymentCategory, paidAt: string) {
  db.insert(payments).values({ id: randomUUID(), registrationId, amount, paymentType, category, paidAt }).run()
}

function visit(memberId: string, checkedInAt: string) {
  db.insert(visits).values({ id: randomUUID(), memberId, checkedInAt, source: 'DOOR', status: 'OK' }).run()
}

describe('day summaries', () => {
  it('adds up each day from the records, including quiet days, newest first', () => {
    const regular = seedMember(db)
    const newcomer = seedMember(db)
    const partner = seedMember(db)
    register([regular], '2026-09-01', '2026-09-01')
    const renewal = register([regular], '2026-10-01', '2026-10-27')
    const signUp = register([newcomer], '2026-10-27', '2026-10-27')
    // A couple where one of them has been before counts as a renewal.
    register([partner, regular], '2026-10-28', '2026-10-28')

    pay(renewal, 10000, 'CASH', 'MEMBERSHIP', '2026-10-27T09:15:00')
    pay(signUp, 5000, 'CARD', 'MEMBERSHIP', '2026-10-27T18:40:00')
    pay(null, 350, 'CASH', 'BEVERAGE', '2026-10-27T19:05:00')
    pay(renewal, 2000, 'ONLINE', 'MEMBERSHIP', '2026-10-28T08:00:00')
    visit(regular, '2026-10-27T07:00:00')
    visit(newcomer, '2026-10-27T18:30:00')
    visit(regular, '2026-10-28T07:05:00')

    const days = daySummaries(db, { from: '2026-10-26', to: '2026-10-28' })
    expect(days.map((d) => d.date)).toEqual(['2026-10-28', '2026-10-27', '2026-10-26'])

    expect(days[1]).toEqual({
      date: '2026-10-27',
      byMethod: { CASH: { count: 2, total: 10350 }, CARD: { count: 1, total: 5000 }, ONLINE: { count: 0, total: 0 } },
      total: 15350,
      count: 3,
      memberships: 15000,
      store: 350,
      newSignUps: 1,
      renewals: 1,
      checkIns: 2
    })
    expect(days[0]).toMatchObject({ total: 2000, newSignUps: 0, renewals: 1, checkIns: 1 })
    expect(days[2]).toMatchObject({ total: 0, count: 0, newSignUps: 0, renewals: 0, checkIns: 0 })
    expect(daySummary(db, '2026-10-27')).toEqual(days[1])
  })

  it('reads as a WhatsApp message for the owner', () => {
    pay(null, 350, 'CASH', 'BEVERAGE', '2026-10-27T19:05:00')
    const text = daySummaryText(daySummary(db, '2026-10-27'), 'LSFS')
    expect(text).toContain('*LSFS: daily summary*\n27 Oct 2026')
    expect(text).toContain('Cash: Rs. 350 (1)')
    expect(text).toContain('*Total: Rs. 350*')
    expect(text).toContain('Memberships Rs. 0 · store Rs. 350')
    expect(text).toContain('New sign-ups: 0 · renewals: 0\nCheck-ins: 0')
  })
})

function day(date: string, cash = 0, extra: Partial<DaySummary> = {}): DaySummary {
  return {
    date,
    byMethod: { CASH: { count: cash ? 1 : 0, total: cash }, CARD: { count: 0, total: 0 }, ONLINE: { count: 0, total: 0 } },
    total: cash,
    count: cash ? 1 : 0,
    memberships: cash,
    store: 0,
    newSignUps: 0,
    renewals: 0,
    checkIns: 0,
    ...extra
  }
}

describe('the owner’s sheet', () => {
  it('groups days under a total for each month, newest first', () => {
    const days = [day('2026-10-02', 12000, { checkIns: 30 }), day('2026-10-01'), day('2026-09-30', 1500.5), day('2026-09-29', 500)]
    const rows = summaryRows(days, '2026-10-02')
    expect(rows[0][0]).toBe('Day')
    expect(rows.slice(1).map((r) => r[0] ?? '')).toEqual([
      '',
      'OCTOBER 2026 SO FAR',
      'Fri 2 Oct',
      'Thu 1 Oct',
      '',
      'SEPTEMBER 2026 TOTAL',
      'Wed 30 Sep',
      'Tue 29 Sep'
    ])
    // Month total: Rs 12,000 and 30 check-ins; a quiet day shows 0 total and blanks.
    expect(rows[2]).toEqual(['OCTOBER 2026 SO FAR', '12,000', '12,000', '', '', '12,000', '', '', '', '30'])
    expect(rows[4]).toEqual(['Thu 1 Oct', '0', '', '', '', '', '', '', '', ''])
    expect(rows[6][1]).toBe('2,000.5')
  })

  it('writes CSV that keeps "12,000" in one cell', () => {
    const csv = toCsv([...titleRows('LSFS', '2026-10-28T18:15:00'), ['Wed 28 Oct', '12,000', 'say "hi"']])
    expect(csv).toBe(
      'LSFS: daily summary\r\n' +
        '"Updated 28 Oct 2026, 6:15 PM by the Lifestyle app. It rewrites this sheet, so changes made here are lost."\r\n' +
        '\r\n' +
        'Wed 28 Oct,"12,000","say ""hi"""\r\n'
    )
  })
})

/** Drive as a map of files, recording what was called. */
function fakeDrive(existing: { id: string; shared: string[] }[] = []) {
  const files = new Map(existing.map((f) => [f.id, { ...f, csv: '' }]))
  const calls: string[] = []
  let next = 0
  const url = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`
  const store: SheetStore = {
    find: async () => {
      calls.push('find')
      const f = [...files.values()][0]
      return f ? { id: f.id, url: url(f.id) } : null
    },
    create: async (csv) => {
      calls.push('create')
      const id = `sheet${++next}`
      files.set(id, { id, shared: [], csv })
      return { id, url: url(id) }
    },
    update: async (id, csv) => {
      calls.push(`update ${id}`)
      const f = files.get(id)
      if (!f) return null
      f.csv = csv
      return { id, url: url(id) }
    },
    sharedWith: async (id) => files.get(id)!.shared,
    share: async (id, email) => {
      calls.push(`share ${email}`)
      files.get(id)!.shared.push(email)
    }
  }
  return { store, files, calls }
}

describe('keeping the sheet in Drive', () => {
  const owner = 'owner@gmail.com'

  it('makes the sheet the first time and shares it with the owner once', async () => {
    const drive = fakeDrive()
    const state = await syncSheet(drive.store, {}, 'v1', owner)
    expect(drive.calls).toEqual(['find', 'create', `share ${owner}`])
    expect(state).toEqual({ fileId: 'sheet1', url: 'https://docs.google.com/spreadsheets/d/sheet1/edit', sharedWith: owner })

    drive.calls.length = 0
    await syncSheet(drive.store, state, 'v2', owner)
    expect(drive.calls).toEqual(['update sheet1'])
    expect(drive.files.get('sheet1')!.csv).toBe('v2')
  })

  it('makes it again, and shares it again, if someone deleted it', async () => {
    const drive = fakeDrive()
    const state = await syncSheet(drive.store, {}, 'v1', owner)
    drive.files.clear()
    drive.calls.length = 0
    const after = await syncSheet(drive.store, state, 'v2', owner)
    expect(drive.calls).toEqual(['update sheet1', 'find', 'create', `share ${owner}`])
    expect(after.fileId).toBe('sheet2')
  })

  it('on a new PC, carries on with the sheet already in Drive without sharing it twice', async () => {
    const drive = fakeDrive([{ id: 'old', shared: [owner] }])
    const state = await syncSheet(drive.store, {}, 'v1', owner)
    expect(drive.calls).toEqual(['find', 'update old'])
    expect(state).toMatchObject({ fileId: 'old', sharedWith: owner })
  })

  it('shares only when an owner is set, and with a new owner when it changes', async () => {
    const drive = fakeDrive()
    const state = await syncSheet(drive.store, {}, 'v1', '')
    expect(drive.calls).toEqual(['find', 'create'])
    expect(state.sharedWith).toBeUndefined()

    const shared = await syncSheet(drive.store, state, 'v2', owner)
    await syncSheet(drive.store, shared, 'v3', 'partner@gmail.com')
    expect(drive.files.get('sheet1')!.shared).toEqual([owner, 'partner@gmail.com'])
  })
})
