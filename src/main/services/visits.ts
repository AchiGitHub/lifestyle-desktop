import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { CheckInCandidate, CheckInOption, CheckInResult, Visit } from '../../shared/api'
import { nowLocalIso, todayIso } from '../../shared/dates'
import type { VisitSource, VisitStatus } from '../../shared/enums'
import { dateRangeInput, type DateRangeInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import { members, ptRegistrations, trainers, visits } from '../db/schema'
import { AppError } from './errors'
import { lastEndDate } from './joining'
import { findByMobile } from './members'
import { registrationsForMember } from './registrations'
import { owesForPt, usablePt } from './training'

/** A second check-in within this time isn't recorded again. */
const REPEAT_HOURS = 2

const shortName = (m: { firstName: string; lastName: string }): string => {
  const last = m.lastName.trim()
  return `${m.firstName.trim()}${last ? ` ${last[0].toUpperCase()}.` : ''}`
}

/**
 * People on this mobile number, for the door tablet: first name and initial
 * only. Duplicate records of one person collapse into the one with the latest
 * membership, so the visit lands where staff will look for it.
 */
export function findForCheckIn(db: Db, mobile: string): CheckInCandidate[] {
  const matches = findByMobile(db, mobile)
    .map((m) => ({ m, end: lastEndDate(db, m.id) ?? '' }))
    .sort((a, b) => b.end.localeCompare(a.end))
  const byName = new Map<string, CheckInCandidate>()
  for (const { m } of matches) {
    const key = `${m.firstName} ${m.lastName}`.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!byName.has(key)) byName.set(key, { id: m.id, name: shortName(m) })
  }
  return [...byName.values()]
}

/**
 * Where the member stands today. A balance only counts on a current
 * registration or personal training package.
 */
export function memberStatus(db: Db, memberId: string, today: string): { status: VisitStatus; endDate: string | null } {
  const regs = registrationsForMember(db, memberId)
  if (regs.length === 0) return { status: 'NO_PLAN', endDate: null }
  const endDate = regs.reduce((max, r) => (r.endDate > max ? r.endDate : max), regs[0].endDate)
  if (endDate < today) return { status: 'EXPIRED', endDate }
  const owes = regs.some((r) => r.endDate >= today && r.balance > 0) || owesForPt(db, memberId, today)
  return { status: owes ? 'OWES' : 'OK', endDate }
}

/** Personal training they can check in for today. Only with a membership that hasn't ended. */
export function checkInOptions(db: Db, memberId: string, now = new Date()): CheckInOption[] {
  const today = todayIso(now)
  const { status } = memberStatus(db, memberId, today)
  return status === 'OK' || status === 'OWES' ? usablePt(db, memberId, today) : []
}

/**
 * A visit; with a package, a personal training session, which uses one of
 * its sessions. A second check-in within 2 hours isn't recorded again, except
 * that choosing personal training after checking in for the gym turns that
 * visit into the session.
 */
export function checkIn(
  db: Db,
  memberId: string,
  source: VisitSource,
  now = new Date(),
  ptRegistrationId: string | null = null
): CheckInResult {
  const member = db.select().from(members).where(eq(members.id, memberId)).get()
  if (!member) throw new AppError('That member no longer exists.')
  const { status, endDate } = memberStatus(db, memberId, todayIso(now))
  const pt = ptRegistrationId
    ? checkInOptions(db, memberId, now).find((o) => o.ptRegistrationId === ptRegistrationId)
    : undefined
  if (ptRegistrationId && !pt) throw new AppError('That personal training package can’t be used today.')

  const since = nowLocalIso(new Date(now.getTime() - REPEAT_HOURS * 60 * 60 * 1000))
  const recent = db
    .select({ id: visits.id, ptRegistrationId: visits.ptRegistrationId })
    .from(visits)
    .where(and(eq(visits.memberId, memberId), gte(visits.checkedInAt, since)))
    .orderBy(desc(visits.checkedInAt))
    .get()
  let visitId: string | null = null
  if (!recent || (pt && recent.ptRegistrationId !== null && recent.ptRegistrationId !== pt.ptRegistrationId)) {
    visitId = randomUUID()
    db.insert(visits)
      .values({ id: visitId, memberId, checkedInAt: nowLocalIso(now), source, status, ptRegistrationId: pt?.ptRegistrationId })
      .run()
  } else if (pt && recent.ptRegistrationId === null) {
    visitId = recent.id
    db.update(visits).set({ ptRegistrationId: pt.ptRegistrationId }).where(eq(visits.id, recent.id)).run()
  }
  return {
    visitId,
    repeat: visitId === null,
    memberId,
    firstName: member.firstName.trim(),
    fullName: `${member.firstName} ${member.lastName}`.trim(),
    status,
    endDate,
    source,
    session: pt ? { trainerName: pt.trainerName, sessionsLeft: pt.sessionsLeft - (visitId ? 1 : 0) } : null
  }
}

/** Newest first. */
export function listVisits(db: Db, raw: DateRangeInput): Visit[] {
  const range = dateRangeInput.parse(raw)
  return db
    .select({
      id: visits.id,
      memberId: visits.memberId,
      memberName: sql<string>`trim(${members.firstName} || ' ' || ${members.lastName})`,
      checkedInAt: visits.checkedInAt,
      source: visits.source,
      status: visits.status,
      ptRegistrationId: visits.ptRegistrationId,
      trainerName: trainers.name
    })
    .from(visits)
    .innerJoin(members, eq(members.id, visits.memberId))
    .leftJoin(ptRegistrations, eq(ptRegistrations.id, visits.ptRegistrationId))
    .leftJoin(trainers, eq(trainers.id, ptRegistrations.trainerId))
    .where(sql`substr(${visits.checkedInAt}, 1, 10) between ${range.from} and ${range.to}`)
    .orderBy(desc(visits.checkedInAt))
    .all()
}

export function deleteVisit(db: Db, id: string): void {
  db.delete(visits).where(eq(visits.id, id)).run()
}
