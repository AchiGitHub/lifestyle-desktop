import { randomUUID } from 'node:crypto'
import { and, eq, gte, sql, type SQL } from 'drizzle-orm'
import type { ClassSeries, ClassSession, ClassType } from '../../shared/api'
import { addDays, parseIsoDate, todayIso } from '../../shared/dates'
import {
  classSeriesInput,
  classSessionInput,
  classTypeInput,
  dateRangeInput,
  type ClassSeriesInput,
  type ClassSessionInput,
  type ClassTypeInput,
  type DateRangeInput
} from '../../shared/schemas'
import type { Db, Executor } from '../db/client'
import { classSeries, classSessions, classTypes } from '../db/schema'
import { AppError, nowUtc, plural } from './errors'

// ------------------------------------------------------------- class types

export function listClassTypes(db: Db): ClassType[] {
  return db
    .all<ClassType>(sql`
      select c.id, c.name, c.color, c.minutes, c.archived,
        (select count(*) from class_series s where s.class_type_id = c.id)
          + (select count(*) from class_sessions s where s.class_type_id = c.id) as used
      from class_types c
      order by c.archived, c.name collate nocase`)
    .map((c) => ({ ...c, archived: Boolean(c.archived) }))
}

export function createClassType(db: Db, raw: ClassTypeInput): void {
  db.insert(classTypes)
    .values({ id: randomUUID(), ...classTypeInput.parse(raw) })
    .run()
}

export function updateClassType(db: Db, id: string, raw: ClassTypeInput): void {
  const result = db
    .update(classTypes)
    .set({ ...classTypeInput.parse(raw), updatedAt: nowUtc() })
    .where(eq(classTypes.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That class no longer exists.')
}

export function setClassTypeArchived(db: Db, id: string, archived: boolean): void {
  db.update(classTypes).set({ archived, updatedAt: nowUtc() }).where(eq(classTypes.id, id)).run()
}

export function deleteClassType(db: Db, id: string): void {
  const type = listClassTypes(db).find((c) => c.id === id)
  if (!type) return
  if (type.used > 0) {
    throw new AppError(
      `"${type.name}" is on the calendar ${plural(type.used, 'time')}, so it can't be deleted. Archive it to hide it from new classes.`
    )
  }
  db.delete(classTypes).where(eq(classTypes.id, id)).run()
}

// ---------------------------------------------------------- weekly classes

type SeriesRow = typeof classSeries.$inferSelect

const parseWeekdays = (value: string): number[] => value.split(',').map(Number)

function runsOn(series: Pick<SeriesRow, 'weekdays' | 'startsOn' | 'endsOn'>, date: string): boolean {
  return (
    date >= series.startsOn &&
    (!series.endsOn || date <= series.endsOn) &&
    parseWeekdays(series.weekdays).includes(parseIsoDate(date).getDay())
  )
}

/**
 * Adds a series' classes between two dates. Ones already there stay as they
 * are, so a cancelled date stays cancelled.
 */
function fillSeries(db: Executor, series: SeriesRow, from: string, to: string): void {
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!runsOn(series, date)) continue
    db.insert(classSessions)
      .values({
        id: randomUUID(),
        classTypeId: series.classTypeId,
        seriesId: series.id,
        date,
        startTime: series.startTime,
        minutes: series.minutes,
        trainerId: series.trainerId
      })
      .onConflictDoNothing()
      .run()
  }
}

function seriesValues(raw: ClassSeriesInput) {
  const { weekdays, ...input } = classSeriesInput.parse(raw)
  return { ...input, weekdays: [...new Set(weekdays)].sort((a, b) => a - b).join(',') }
}

function findSeries(db: Executor, id: string): SeriesRow | undefined {
  return db.select().from(classSeries).where(eq(classSeries.id, id)).get()
}

export function listClassSeries(db: Db): ClassSeries[] {
  return db
    .all<Omit<ClassSeries, 'weekdays'> & { weekdays: string }>(sql`
      select s.id, s.class_type_id as classTypeId, c.name as className, c.color, s.weekdays, s.start_time as startTime,
        s.minutes, s.trainer_id as trainerId, t.name as trainerName, s.starts_on as startsOn, s.ends_on as endsOn
      from class_series s
      join class_types c on c.id = s.class_type_id
      left join trainers t on t.id = s.trainer_id
      order by s.start_time, c.name collate nocase`)
    .map((s) => ({ ...s, weekdays: parseWeekdays(s.weekdays) }))
}

export function createClassSeries(db: Db, raw: ClassSeriesInput): void {
  db.insert(classSeries)
    .values({ id: randomUUID(), ...seriesValues(raw) })
    .run()
}

/**
 * The change runs from today, or from the new first day if that's later.
 * Classes before then keep the old days and time, even if nobody has opened
 * those dates yet. A date changed by itself keeps that change if the class
 * still runs that day.
 */
export function updateClassSeries(db: Db, id: string, raw: ClassSeriesInput): void {
  const values = seriesValues(raw)
  const today = todayIso()
  db.transaction((tx) => {
    const series = findSeries(tx, id)
    if (!series) throw new AppError('That class no longer exists.')
    fillSeries(tx, series, series.startsOn, addDays(today, -1))

    const next = { ...values, startsOn: values.startsOn > today ? values.startsOn : today }
    tx.update(classSeries)
      .set({ ...next, updatedAt: nowUtc() })
      .where(eq(classSeries.id, id))
      .run()

    const upcoming = tx
      .select()
      .from(classSessions)
      .where(and(eq(classSessions.seriesId, id), gte(classSessions.date, today)))
      .all()
    for (const session of upcoming) {
      if (session.changed && runsOn(next, session.date)) continue
      tx.delete(classSessions).where(eq(classSessions.id, session.id)).run()
    }
  })
}

/** Stops it from today on. Past classes stay on the calendar, as one-offs. */
export function deleteClassSeries(db: Db, id: string): void {
  const today = todayIso()
  db.transaction((tx) => {
    const series = findSeries(tx, id)
    if (!series) return
    fillSeries(tx, series, series.startsOn, addDays(today, -1))
    tx.delete(classSessions)
      .where(and(eq(classSessions.seriesId, id), gte(classSessions.date, today)))
      .run()
    tx.delete(classSeries).where(eq(classSeries.id, id)).run()
  })
}

// ----------------------------------------------------------------- classes

function loadSessions(db: Db, where: SQL): ClassSession[] {
  return db
    .all<ClassSession>(sql`
      select s.id, s.class_type_id as classTypeId, c.name as className, c.color, s.series_id as seriesId, s.date,
        s.start_time as startTime, s.minutes, s.trainer_id as trainerId, t.name as trainerName, s.cancelled
      from class_sessions s
      join class_types c on c.id = s.class_type_id
      left join trainers t on t.id = s.trainer_id
      where ${where}
      order by s.date, s.start_time, c.name collate nocase`)
    .map((s) => ({ ...s, cancelled: Boolean(s.cancelled) }))
}

/** The classes between two dates, cancelled ones included, oldest first. */
export function listClassSessions(db: Db, raw: DateRangeInput): ClassSession[] {
  const { from, to } = dateRangeInput.parse(raw)
  db.transaction((tx) => {
    for (const series of tx.select().from(classSeries).all()) fillSeries(tx, series, from, to)
  })
  return loadSessions(db, sql`s.date between ${from} and ${to}`)
}

function findSession(db: Executor, id: string) {
  return db.select().from(classSessions).where(eq(classSessions.id, id)).get()
}

export function createClassSession(db: Db, raw: ClassSessionInput): void {
  db.insert(classSessions)
    .values({ id: randomUUID(), ...classSessionInput.parse(raw) })
    .run()
}

export function updateClassSession(db: Db, id: string, raw: ClassSessionInput): void {
  const input = classSessionInput.parse(raw)
  db.transaction((tx) => {
    const session = findSession(tx, id)
    if (!session) throw new AppError('That class no longer exists.')
    if (session.seriesId && input.date !== session.date) {
      // The series would put a moved class back, so the old date stays as cancelled.
      tx.update(classSessions).set({ cancelled: true, changed: true, updatedAt: nowUtc() }).where(eq(classSessions.id, id)).run()
      tx.insert(classSessions).values({ id: randomUUID(), ...input }).run()
      return
    }
    tx.update(classSessions)
      .set({ ...input, changed: true, updatedAt: nowUtc() })
      .where(eq(classSessions.id, id))
      .run()
  })
}

export function setClassSessionCancelled(db: Db, id: string, cancelled: boolean): void {
  const result = db
    .update(classSessions)
    .set({ cancelled, changed: true, updatedAt: nowUtc() })
    .where(eq(classSessions.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That class no longer exists.')
}

export function deleteClassSession(db: Db, id: string): void {
  const session = findSession(db, id)
  if (!session) return
  if (session.seriesId) throw new AppError("This date is part of a weekly class, so it can't be deleted. Cancel it instead.")
  db.delete(classSessions).where(eq(classSessions.id, id)).run()
}
