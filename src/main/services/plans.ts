import { randomUUID } from 'node:crypto'
import { asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { Duration, MembershipType } from '../../shared/api'
import { durationLabel } from '../../shared/enums'
import {
  durationInput,
  membershipTypeInput,
  type DurationInput,
  type MembershipTypeInput
} from '../../shared/schemas'
import type { Db } from '../db/client'
import { durations, membershipTypes, registrations } from '../db/schema'
import { AppError, nowUtc, plural } from './errors'

export function listDurations(db: Db): Duration[] {
  return db
    .select({
      id: durations.id,
      duration: durations.duration,
      durationType: durations.durationType,
      // Spelled out: a bare "id" here would bind to mt.id (see listMembers).
      planCount: sql<number>`(select count(*) from membership_types mt where mt.duration_id = durations.id)`
    })
    .from(durations)
    .orderBy(
      sql`case ${durations.durationType} when 'DAY' then 0 when 'MONTH' then 1 else 2 end`,
      asc(durations.duration)
    )
    .all()
}

export function createDuration(db: Db, raw: DurationInput): void {
  const input = durationInput.parse(raw)
  db.insert(durations).values({ id: randomUUID(), ...input }).run()
}

export function updateDuration(db: Db, id: string, raw: DurationInput): void {
  const input = durationInput.parse(raw)
  const result = db
    .update(durations)
    .set({ ...input, updatedAt: nowUtc() })
    .where(eq(durations.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That duration no longer exists.')
}

export function deleteDurations(db: Db, ids: string[]): void {
  if (ids.length === 0) return
  const used = db
    .select({ duration: durations.duration, durationType: durations.durationType, n: sql<number>`count(*)` })
    .from(membershipTypes)
    .innerJoin(durations, eq(durations.id, membershipTypes.durationId))
    .where(inArray(membershipTypes.durationId, ids))
    .groupBy(durations.id)
    .all()
  if (used.length > 0) {
    const d = used[0]
    throw new AppError(
      `${durationLabel(d.duration, d.durationType)} is used by ${plural(d.n, 'plan')}, so it can't be deleted.`
    )
  }
  db.delete(durations).where(inArray(durations.id, ids)).run()
}

export function listMembershipTypes(db: Db): MembershipType[] {
  return db
    .select({
      ...getTableColumns(membershipTypes),
      duration: durations.duration,
      durationType: durations.durationType,
      registrationCount: sql<number>`(select count(*) from registrations r where r.membership_type_id = membership_types.id)`
    })
    .from(membershipTypes)
    .innerJoin(durations, eq(durations.id, membershipTypes.durationId))
    .orderBy(asc(membershipTypes.archived), asc(sql`${membershipTypes.name} collate nocase`))
    .all()
    .map(({ createdAt: _c, updatedAt: _u, ...t }) => t)
}

function checkDuration(db: Db, durationId: string): void {
  if (!db.select().from(durations).where(eq(durations.id, durationId)).get()) {
    throw new AppError('That duration no longer exists.')
  }
}

export function createMembershipType(db: Db, raw: MembershipTypeInput): void {
  const input = membershipTypeInput.parse(raw)
  checkDuration(db, input.durationId)
  db.insert(membershipTypes).values({ id: randomUUID(), ...input }).run()
}

export function updateMembershipType(db: Db, id: string, raw: MembershipTypeInput): void {
  const input = membershipTypeInput.parse(raw)
  checkDuration(db, input.durationId)
  const result = db
    .update(membershipTypes)
    .set({ ...input, updatedAt: nowUtc() })
    .where(eq(membershipTypes.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That plan no longer exists.')
}

export function setMembershipTypeArchived(db: Db, id: string, archived: boolean): void {
  db.update(membershipTypes).set({ archived, updatedAt: nowUtc() }).where(eq(membershipTypes.id, id)).run()
}

export function deleteMembershipTypes(db: Db, ids: string[]): void {
  if (ids.length === 0) return
  const used = db
    .select({ name: membershipTypes.name, n: sql<number>`count(*)` })
    .from(registrations)
    .innerJoin(membershipTypes, eq(membershipTypes.id, registrations.membershipTypeId))
    .where(inArray(registrations.membershipTypeId, ids))
    .groupBy(membershipTypes.id)
    .all()
  if (used.length > 0) {
    throw new AppError(
      `"${used[0].name}" has ${plural(used[0].n, 'registration')}, so it can't be deleted. Archive it to hide it from new registrations.`
    )
  }
  db.delete(membershipTypes).where(inArray(membershipTypes.id, ids)).run()
}
