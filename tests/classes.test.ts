import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/main/db/client'
import { trainers } from '../src/main/db/schema'
import { upgradeData } from '../src/main/db/upgrades'
import {
  createClassSeries,
  createClassSession,
  createClassType,
  deleteClassSeries,
  deleteClassSession,
  deleteClassType,
  listClassSeries,
  listClassSessions,
  listClassTypes,
  setClassSessionCancelled,
  setClassTypeArchived,
  updateClassSeries,
  updateClassSession
} from '../src/main/services/classes'
import { deleteTrainer } from '../src/main/services/training'
import type { ClassSeriesInput } from '../src/shared/schemas'
import { makeDb } from './helpers'

// 2 Nov 2026 is a Monday.
const MONDAY = new Date(2026, 10, 2, 9, 0)

let db: Db
let zumba: string

function series(overrides: Partial<ClassSeriesInput> = {}): ClassSeriesInput {
  return {
    classTypeId: zumba,
    weekdays: [1, 3],
    startTime: '18:00',
    minutes: 60,
    trainerId: null,
    startsOn: '2026-11-02',
    endsOn: null,
    ...overrides
  }
}

const dates = (from: string, to: string) => listClassSessions(db, { from, to }).map((s) => s.date)
const on = (date: string) => listClassSessions(db, { from: date, to: date })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(MONDAY)
  db = makeDb()
  zumba = listClassTypes(db).find((c) => c.name === 'Zumba')!.id
})

afterEach(() => {
  vi.useRealTimers()
})

describe('class types', () => {
  it('start with Zumba and HIIT, and a deleted one does not come back', () => {
    expect(listClassTypes(db).map((c) => c.name)).toEqual(['HIIT', 'Zumba'])
    deleteClassType(db, zumba)
    upgradeData(db)
    expect(listClassTypes(db).map((c) => c.name)).toEqual(['HIIT'])
  })

  it('can be added', () => {
    createClassType(db, { name: 'Yoga', color: 'teal', minutes: 75 })
    expect(listClassTypes(db).find((c) => c.name === 'Yoga')).toMatchObject({ color: 'teal', minutes: 75, used: 0 })
  })

  it("can't be deleted once on the calendar, only archived", () => {
    createClassSeries(db, series())
    expect(() => deleteClassType(db, zumba)).toThrow(/Archive it/)
    setClassTypeArchived(db, zumba, true)
    expect(listClassTypes(db).find((c) => c.id === zumba)).toMatchObject({ archived: true, used: 1 })
  })
})

describe('weekly classes', () => {
  it('run on the chosen days from the first day on', () => {
    createClassSeries(db, series({ startsOn: '2026-11-03' }))
    expect(dates('2026-11-01', '2026-11-15')).toEqual(['2026-11-04', '2026-11-09', '2026-11-11'])
  })

  it('stop after the last day', () => {
    createClassSeries(db, series({ endsOn: '2026-11-04' }))
    expect(dates('2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-04'])
  })

  it('keep going into any month with no end date', () => {
    createClassSeries(db, series({ weekdays: [1] }))
    expect(dates('2027-03-01', '2027-03-07')).toEqual(['2027-03-01'])
  })

  it("aren't added twice when a month is looked at again", () => {
    createClassSeries(db, series())
    dates('2026-11-01', '2026-11-30')
    expect(dates('2026-11-01', '2026-11-30')).toHaveLength(9)
  })

  it('list their days in order, whichever way they were ticked', () => {
    createClassSeries(db, series({ weekdays: [5, 1, 1] }))
    expect(listClassSeries(db)[0].weekdays).toEqual([1, 5])
  })

  it('need at least one day, and a last day on or after the first', () => {
    expect(() => createClassSeries(db, series({ weekdays: [] }))).toThrow(/at least one day/)
    expect(() => createClassSeries(db, series({ endsOn: '2026-11-01' }))).toThrow(/on or after/)
  })

  it('change from today on and leave earlier classes as they were', () => {
    createClassSeries(db, series({ startsOn: '2026-10-05', weekdays: [1] }))
    updateClassSeries(db, listClassSeries(db)[0].id, series({ startsOn: '2026-10-05', weekdays: [1], startTime: '19:30' }))

    expect(on('2026-10-26')[0].startTime).toBe('18:00')
    expect(on('2026-11-02')[0].startTime).toBe('19:30')
    expect(on('2026-11-09')[0].startTime).toBe('19:30')
  })

  it("don't appear on the new days before today, even in a month nobody had opened", () => {
    createClassSeries(db, series({ startsOn: '2026-10-05', weekdays: [1] }))
    updateClassSeries(db, listClassSeries(db)[0].id, series({ startsOn: '2026-10-05', weekdays: [2] }))

    expect(dates('2026-10-05', '2026-10-11')).toEqual(['2026-10-05'])
    expect(dates('2026-11-02', '2026-11-08')).toEqual(['2026-11-03'])
  })

  it('keep a date changed by itself when the pattern changes', () => {
    createClassSeries(db, series({ weekdays: [1] }))
    const [nextWeek] = on('2026-11-09')
    setClassSessionCancelled(db, nextWeek.id, true)

    updateClassSeries(db, listClassSeries(db)[0].id, series({ weekdays: [1], startTime: '19:30' }))

    expect(on('2026-11-09')[0].cancelled).toBe(true)
    expect(on('2026-11-16')[0]).toMatchObject({ startTime: '19:30', cancelled: false })
  })

  it('drop a changed date when the class no longer runs that day', () => {
    createClassSeries(db, series({ weekdays: [1] }))
    setClassSessionCancelled(db, on('2026-11-09')[0].id, true)

    updateClassSeries(db, listClassSeries(db)[0].id, series({ weekdays: [2] }))

    expect(dates('2026-11-09', '2026-11-10')).toEqual(['2026-11-10'])
  })

  it('stop when deleted, keeping past classes as one-offs', () => {
    createClassSeries(db, series({ startsOn: '2026-10-05', weekdays: [1] }))
    deleteClassSeries(db, listClassSeries(db)[0].id)

    expect(listClassSeries(db)).toEqual([])
    expect(on('2026-10-26')[0].seriesId).toBeNull()
    expect(dates('2026-11-02', '2026-11-30')).toEqual([])
  })
})

describe('classes on one date', () => {
  const oneOff = { classTypeId: '', startTime: '09:00', minutes: 45, trainerId: null, date: '2026-11-14' }

  it('can be added and deleted', () => {
    createClassSession(db, { ...oneOff, classTypeId: zumba })
    const [session] = on('2026-11-14')
    expect(session).toMatchObject({ className: 'Zumba', seriesId: null, startTime: '09:00', cancelled: false })
    deleteClassSession(db, session.id)
    expect(on('2026-11-14')).toEqual([])
  })

  it('sit beside a weekly class on the same day, earliest first', () => {
    createClassSeries(db, series({ weekdays: [6] }))
    createClassSession(db, { ...oneOff, classTypeId: zumba })
    expect(on('2026-11-14').map((s) => s.startTime)).toEqual(['09:00', '18:00'])
  })

  it('stay cancelled without touching the rest of the series, and can be restored', () => {
    createClassSeries(db, series({ weekdays: [1] }))
    const [session] = on('2026-11-09')
    setClassSessionCancelled(db, session.id, true)

    expect(on('2026-11-09')[0].cancelled).toBe(true)
    expect(on('2026-11-16')[0].cancelled).toBe(false)

    setClassSessionCancelled(db, session.id, false)
    expect(on('2026-11-09')[0].cancelled).toBe(false)
  })

  it('can change just that date of a weekly class', () => {
    createClassSeries(db, series({ weekdays: [1] }))
    const [session] = on('2026-11-09')
    updateClassSession(db, session.id, { ...oneOff, classTypeId: zumba, date: '2026-11-09', startTime: '20:00' })

    expect(on('2026-11-09')[0]).toMatchObject({ startTime: '20:00', seriesId: session.seriesId })
    expect(on('2026-11-16')[0].startTime).toBe('18:00')
  })

  it('move to another day by cancelling the old date, which the series leaves alone', () => {
    createClassSeries(db, series({ weekdays: [1] }))
    const [session] = on('2026-11-09')
    updateClassSession(db, session.id, { ...oneOff, classTypeId: zumba, date: '2026-11-10', startTime: '18:00' })

    expect(on('2026-11-09')).toMatchObject([{ id: session.id, cancelled: true }])
    expect(on('2026-11-10')).toMatchObject([{ cancelled: false, seriesId: null }])
  })

  it('from a weekly class can only be cancelled, not deleted', () => {
    createClassSeries(db, series({ weekdays: [1] }))
    expect(() => deleteClassSession(db, on('2026-11-09')[0].id)).toThrow(/Cancel it instead/)
  })

  it('lose the instructor if that trainer is deleted', () => {
    db.insert(trainers).values({ id: 'kasun', name: 'Kasun' }).run()
    createClassSeries(db, series({ weekdays: [1], trainerId: 'kasun' }))
    expect(on('2026-11-09')[0].trainerName).toBe('Kasun')

    deleteTrainer(db, 'kasun')

    expect(on('2026-11-09')[0]).toMatchObject({ trainerId: null, trainerName: null })
    expect(listClassSeries(db)[0].trainerName).toBeNull()
  })

  it('refuse a time that is not a time', () => {
    expect(() => createClassSession(db, { ...oneOff, classTypeId: zumba, startTime: '25:00' })).toThrow(/Pick a time/)
  })

  it('need a class type that exists', () => {
    expect(() => createClassSession(db, { ...oneOff, classTypeId: 'nothing' })).toThrow()
  })
})
