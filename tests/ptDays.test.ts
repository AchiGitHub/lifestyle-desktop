import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { ptRegistrations, trainers, visits } from '../src/main/db/schema'
import { calendarDays } from '../src/main/services/calendar'
import { createClassSeries, listClassTypes, listClassSessions, setClassSessionCancelled } from '../src/main/services/classes'
import {
  addPtDay,
  deletePtDay,
  deletePtRegistration,
  getPtRegistration,
  listPtDays,
  ptDayClashes,
  setPtDays,
  updatePtDay,
  updatePtRegistration,
  upcomingPtDays
} from '../src/main/services/training'
import { deleteVisit } from '../src/main/services/visits'
import { makeDb, seedMember } from './helpers'

// 2 Nov 2026 is a Monday.
const NOW = new Date(2026, 10, 2, 9, 0)

let db: Db
let memberId: string
let pt: string

function seedPt(overrides: Partial<typeof ptRegistrations.$inferInsert> = {}): string {
  const id = randomUUID()
  db.insert(ptRegistrations)
    .values({
      id,
      memberId,
      trainerId: 'kasun',
      packageName: 'Ten sessions',
      sessions: 4,
      startDate: '2026-10-20',
      endDate: '2026-11-30',
      amount: 15000,
      ...overrides
    })
    .run()
  return id
}

const day = (date: string, startTime = '07:00', minutes = 60) => ({ date, startTime, minutes })
const dates = () => upcomingPtDays(db, pt).map((d) => d.date)

function checkIn(ptRegistrationId: string, at: string): string {
  const id = randomUUID()
  db.insert(visits).values({ id, memberId, checkedInAt: at, source: 'DOOR', status: 'OK', ptRegistrationId }).run()
  return id
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  db = makeDb()
  memberId = seedMember(db)
  db.insert(trainers)
    .values([
      { id: 'kasun', name: 'Kasun' },
      { id: 'dilini', name: 'Dilini' }
    ])
    .run()
  pt = seedPt()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('setting a package’s days', () => {
  it('saves the days chosen, each with its own time', () => {
    setPtDays(db, pt, [day('2026-11-05', '18:30'), day('2026-11-03')])
    expect(upcomingPtDays(db, pt)).toMatchObject([
      { date: '2026-11-03', startTime: '07:00', memberName: 'Kamal Silva', trainerName: 'Kasun', came: false },
      { date: '2026-11-05', startTime: '18:30' }
    ])
    expect(getPtRegistration(db, pt).nextDay).toBe('2026-11-03')
  })

  it('replaces the days still to come', () => {
    setPtDays(db, pt, [day('2026-11-03'), day('2026-11-05')])
    setPtDays(db, pt, [day('2026-11-06')])
    expect(dates()).toEqual(['2026-11-06'])
  })

  it('can clear them all', () => {
    setPtDays(db, pt, [day('2026-11-03')])
    setPtDays(db, pt, [])
    expect(dates()).toEqual([])
    expect(getPtRegistration(db, pt).nextDay).toBeNull()
  })

  it('leaves past days alone', () => {
    vi.setSystemTime(new Date(2026, 9, 26, 9, 0))
    setPtDays(db, pt, [day('2026-10-28')])
    vi.setSystemTime(NOW)
    setPtDays(db, pt, [day('2026-11-03')])
    expect(listPtDays(db, { from: '2026-10-01', to: '2026-11-30' }).map((d) => d.date)).toEqual(['2026-10-28', '2026-11-03'])
  })

  it('stays within the package: today on, after it starts, by its use-by date', () => {
    expect(() => setPtDays(db, pt, [day('2026-11-01')])).toThrow(/within the package/)
    expect(() => setPtDays(db, pt, [day('2026-12-01')])).toThrow(/within the package/)
    const later = seedPt({ startDate: '2026-11-10' })
    expect(() => setPtDays(db, later, [day('2026-11-09')])).toThrow(/within the package/)
  })

  it("can't have more days than sessions left", () => {
    const five = ['03', '04', '05', '06', '09'].map((d) => day(`2026-11-${d}`))
    expect(() => setPtDays(db, pt, five)).toThrow(/4 sessions left/)
  })

  it('counts sessions already had', () => {
    checkIn(pt, '2026-10-25T07:00:00')
    const four = ['03', '04', '05', '06'].map((d) => day(`2026-11-${d}`))
    expect(() => setPtDays(db, pt, four)).toThrow(/3 sessions left/)
  })

  it('takes each date once', () => {
    expect(() => setPtDays(db, pt, [day('2026-11-03'), day('2026-11-03', '18:00')])).toThrow(/only be chosen once/)
  })

  it("needs a time for every day", () => {
    expect(() => setPtDays(db, pt, [day('2026-11-03', '')])).toThrow(/Pick a time/)
  })

  it("keeps today's day once they've had that session", () => {
    setPtDays(db, pt, [day('2026-11-02'), day('2026-11-03')])
    checkIn(pt, '2026-11-02T07:05:00')

    setPtDays(db, pt, [day('2026-11-05')])

    expect(upcomingPtDays(db, pt)).toMatchObject([{ date: '2026-11-02', came: true }, { date: '2026-11-05' }])
    expect(() => setPtDays(db, pt, [day('2026-11-02')])).toThrow(/already had/)
  })
})

describe('changing one day', () => {
  it('can add a day', () => {
    addPtDay(db, { ptRegistrationId: pt, ...day('2026-11-10', '06:30', 45) })
    expect(upcomingPtDays(db, pt)).toMatchObject([{ date: '2026-11-10', startTime: '06:30', minutes: 45 }])
  })

  it("won't add a second session on the same day", () => {
    setPtDays(db, pt, [day('2026-11-10')])
    expect(() => addPtDay(db, { ptRegistrationId: pt, ...day('2026-11-10', '18:00') })).toThrow(/already has a session/)
  })

  it("won't add more days than sessions left", () => {
    setPtDays(db, pt, ['03', '04', '05', '06'].map((d) => day(`2026-11-${d}`)))
    expect(() => addPtDay(db, { ptRegistrationId: pt, ...day('2026-11-10') })).toThrow(/Remove one first/)
  })

  it('can move a day or change its time, even with every session planned', () => {
    setPtDays(db, pt, ['03', '04', '05', '06'].map((d) => day(`2026-11-${d}`)))
    const [first] = upcomingPtDays(db, pt)

    updatePtDay(db, first.id, day('2026-11-12', '19:00', 30))

    expect(dates()).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-12'])
    expect(upcomingPtDays(db, pt)[3]).toMatchObject({ startTime: '19:00', minutes: 30 })
  })

  it("can't move onto a day the package already has, or outside its dates", () => {
    setPtDays(db, pt, [day('2026-11-03'), day('2026-11-05')])
    const [first] = upcomingPtDays(db, pt)
    expect(() => updatePtDay(db, first.id, day('2026-11-05'))).toThrow(/already has a session/)
    expect(() => updatePtDay(db, first.id, day('2026-12-05'))).toThrow(/within the package/)
  })

  it("can't change a day they came for", () => {
    setPtDays(db, pt, [day('2026-11-02')])
    checkIn(pt, '2026-11-02T07:05:00')
    expect(() => updatePtDay(db, upcomingPtDays(db, pt)[0].id, day('2026-11-03'))).toThrow(/They came/)
  })

  it('can remove a day', () => {
    setPtDays(db, pt, [day('2026-11-03')])
    deletePtDay(db, upcomingPtDays(db, pt)[0].id)
    expect(dates()).toEqual([])
  })
})

describe('days and sessions', () => {
  it("doesn't use up a session until they check in", () => {
    setPtDays(db, pt, [day('2026-11-03'), day('2026-11-05')])
    expect(getPtRegistration(db, pt)).toMatchObject({ used: 0, left: 4 })
  })

  it('shows who came', () => {
    vi.setSystemTime(new Date(2026, 9, 26, 9, 0))
    setPtDays(db, pt, [day('2026-10-27'), day('2026-10-29')])
    vi.setSystemTime(NOW)
    checkIn(pt, '2026-10-27T07:02:00')

    expect(listPtDays(db, { from: '2026-10-01', to: '2026-10-31' })).toMatchObject([
      { date: '2026-10-27', came: true },
      { date: '2026-10-29', came: false }
    ])
  })

  it("moves the next day on once they've had today's session", () => {
    setPtDays(db, pt, [day('2026-11-02'), day('2026-11-05')])
    expect(getPtRegistration(db, pt).nextDay).toBe('2026-11-02')

    checkIn(pt, '2026-11-02T07:05:00')

    expect(getPtRegistration(db, pt).nextDay).toBe('2026-11-05')
  })

  it('ignores a session on a different package that day', () => {
    setPtDays(db, pt, [day('2026-11-02')])
    checkIn(seedPt(), '2026-11-02T07:05:00')
    expect(upcomingPtDays(db, pt)[0].came).toBe(false)
  })

  it('takes days still to come off the calendar once the package is used up, and back with a removed check-in', () => {
    const short = seedPt({ sessions: 1 })
    setPtDays(db, short, [day('2026-11-05')])
    const range = { from: '2026-11-01', to: '2026-11-30' }

    const visit = checkIn(short, '2026-11-02T07:05:00')
    expect(listPtDays(db, range)).toEqual([])

    deleteVisit(db, visit)
    expect(listPtDays(db, range).map((d) => d.date)).toEqual(['2026-11-05'])
  })

  it('are on the calendar', () => {
    setPtDays(db, pt, [day('2026-11-03')])
    const [cal] = calendarDays(db, { from: '2026-11-03', to: '2026-11-03' })
    expect(cal.ptDays).toMatchObject([{ memberName: 'Kamal Silva', startTime: '07:00' }])
  })
})

describe('changing the package', () => {
  const terms = { trainerId: 'kasun', sessions: 4, startDate: '2026-10-20', amount: 15000, commission: 0 }

  it('drops days past a new use-by date', () => {
    setPtDays(db, pt, [day('2026-11-03'), day('2026-11-20')])
    updatePtRegistration(db, pt, { ...terms, endDate: '2026-11-10' })
    expect(dates()).toEqual(['2026-11-03'])
  })

  it('keeps days within a longer use-by date', () => {
    setPtDays(db, pt, [day('2026-11-03')])
    updatePtRegistration(db, pt, { ...terms, endDate: '2026-12-31' })
    expect(dates()).toEqual(['2026-11-03'])
    setPtDays(db, pt, [day('2026-12-20')])
    expect(dates()).toEqual(['2026-12-20'])
  })

  it('drops days before a later start', () => {
    setPtDays(db, pt, [day('2026-11-03'), day('2026-11-20')])
    updatePtRegistration(db, pt, { ...terms, startDate: '2026-11-10', endDate: '2026-11-30' })
    expect(dates()).toEqual(['2026-11-20'])
  })

  it('follows a new trainer', () => {
    setPtDays(db, pt, [day('2026-11-03')])
    updatePtRegistration(db, pt, { ...terms, trainerId: 'dilini', endDate: '2026-11-30' })
    expect(upcomingPtDays(db, pt)[0].trainerName).toBe('Dilini')
  })

  it('takes its days with it when deleted', () => {
    setPtDays(db, pt, [day('2026-11-03')])
    deletePtRegistration(db, pt)
    expect(listPtDays(db, { from: '2026-11-01', to: '2026-11-30' })).toEqual([])
  })
})

describe('clashes', () => {
  const clashes = (...days: ReturnType<typeof day>[]) => ptDayClashes(db, { ptRegistrationId: pt, days })

  function zumba(trainerId: string | null = 'kasun') {
    createClassSeries(db, {
      classTypeId: listClassTypes(db).find((c) => c.name === 'Zumba')!.id,
      weekdays: [2],
      startTime: '18:00',
      minutes: 60,
      trainerId,
      startsOn: '2026-11-01',
      endsOn: null
    })
  }

  it("find the trainer's class at the same time", () => {
    zumba()
    expect(clashes(day('2026-11-03', '18:30'))).toEqual([{ date: '2026-11-03', name: 'Zumba', startTime: '18:00' }])
  })

  it('leave times that only touch', () => {
    zumba()
    expect(clashes(day('2026-11-03', '17:00'), day('2026-11-03', '19:00'))).toEqual([])
  })

  it('ignore a cancelled class', () => {
    zumba()
    setClassSessionCancelled(db, listClassSessions(db, { from: '2026-11-03', to: '2026-11-03' })[0].id, true)
    expect(clashes(day('2026-11-03', '18:00'))).toEqual([])
  })

  it("ignore another instructor's class", () => {
    zumba('dilini')
    expect(clashes(day('2026-11-03', '18:00'))).toEqual([])
  })

  it("find the trainer's other client", () => {
    const other = seedPt({ memberId: seedMember(db, { firstName: 'Nimal', lastName: 'Perera' }) })
    setPtDays(db, other, [day('2026-11-03', '07:30')])
    expect(clashes(day('2026-11-03', '07:00'))).toEqual([{ date: '2026-11-03', name: 'Nimal Perera', startTime: '07:30' }])
  })

  it("don't count the package's own days", () => {
    setPtDays(db, pt, [day('2026-11-03')])
    expect(clashes(day('2026-11-03'))).toEqual([])
  })

  it('stop nothing being saved: the owner decides', () => {
    zumba()
    setPtDays(db, pt, [day('2026-11-03', '18:00')])
    expect(dates()).toEqual(['2026-11-03'])
  })
})
