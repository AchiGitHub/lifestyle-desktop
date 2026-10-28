import { randomUUID } from 'node:crypto'
import { asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { DuplicateGroup, Member, MemberDetail, MemberListItem } from '../../shared/api'
import { memberInput, type MemberInput } from '../../shared/schemas'
import type { Db, Executor } from '../db/client'
import { addDays, todayIso } from '../../shared/dates'
import { members, registrationMembers, visits } from '../db/schema'
import { AppError, nowUtc, plural } from './errors'
import { paymentsForMember } from './payments'
import { registrationsForMember } from './registrations'

const fullName = (m: Pick<Member, 'firstName' | 'lastName'>): string => `${m.firstName} ${m.lastName}`.trim()

/**
 * Phone numbers were typed in many shapes (077 123 4567, +94771234567, ...).
 * Comparing the last 9 digits matches them all.
 */
export function phoneKey(mobile: string | null | undefined): string | null {
  const digits = (mobile ?? '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : null
}

export function listMembers(db: Db): MemberListItem[] {
  // The outer column is spelled out: in a single-table query Drizzle renders
  // ${members.id} as a bare "id", which the subquery would bind to r.id.
  return db
    .select({
      ...getTableColumns(members),
      lastEndDate: sql<string | null>`(
        select max(r.end_date) from registration_members rm
        join registrations r on r.id = rm.registration_id
        where rm.member_id = members.id)`,
      registrationCount: sql<number>`(
        select count(*) from registration_members rm where rm.member_id = members.id)`
    })
    .from(members)
    .orderBy(asc(sql`${members.firstName} collate nocase`), asc(sql`${members.lastName} collate nocase`))
    .all()
}

function findMember(db: Executor, id: string): Member {
  const member = db.select().from(members).where(eq(members.id, id)).get()
  if (!member) throw new AppError('That member no longer exists.')
  return member
}

export function getMember(db: Db, id: string): MemberDetail {
  const since = addDays(todayIso(), -29)
  const visitStats = db.get<{ lastAt: string | null; last30Days: number }>(sql`
    select max(checked_in_at) as lastAt,
      sum(case when substr(checked_in_at, 1, 10) >= ${since} then 1 else 0 end) as last30Days
    from visits where member_id = ${id}`)
  return {
    member: findMember(db, id),
    registrations: registrationsForMember(db, id),
    payments: paymentsForMember(db, id),
    visits: { lastAt: visitStats?.lastAt ?? null, last30Days: visitStats?.last30Days ?? 0 }
  }
}

export function createMember(db: Db, raw: MemberInput): Member {
  const input = memberInput.parse(raw)
  return db
    .insert(members)
    .values({ id: randomUUID(), ...input })
    .returning()
    .get()
}

export function updateMember(db: Db, id: string, raw: MemberInput): Member {
  const input = memberInput.parse(raw)
  const updated = db
    .update(members)
    .set({ ...input, updatedAt: nowUtc() })
    .where(eq(members.id, id))
    .returning()
    .get()
  if (!updated) throw new AppError('That member no longer exists.')
  return updated
}

export function deleteMembers(db: Db, ids: string[]): void {
  if (ids.length === 0) return
  const inUse = db
    .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, n: sql<number>`count(*)` })
    .from(registrationMembers)
    .innerJoin(members, eq(members.id, registrationMembers.memberId))
    .where(inArray(registrationMembers.memberId, ids))
    .groupBy(members.id)
    .all()
  if (inUse.length > 0) {
    const first = inUse[0]
    const who = `${first.firstName} ${first.lastName}`.trim()
    throw new AppError(
      inUse.length === 1
        ? `${who} is on ${plural(first.n, 'registration')}, so they can't be deleted. If they're a duplicate, merge them instead.`
        : `${plural(inUse.length, 'member')} are on registrations and can't be deleted. If they're duplicates, merge them instead.`
    )
  }
  db.delete(members).where(inArray(members.id, ids)).run()
}

export function findByMobile(db: Db, mobile: string): Member[] {
  const key = phoneKey(mobile)
  if (!key) return []
  return db
    .select()
    .from(members)
    .all()
    .filter((m) => phoneKey(m.mobileNumber) === key)
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'rev', 'prof'])

/** Lower-case name words without titles or punctuation: "Dr. A.B. Perera" → ["ab", "perera"]. */
function nameWords(m: Pick<Member, 'firstName' | 'lastName'>): string[] {
  return `${m.firstName} ${m.lastName}`
    .toLowerCase()
    .replace(/\./g, '')
    .split(/[^a-z]+/)
    .filter((w) => w && !TITLES.has(w))
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/** Same first name, allowing a typo or two ("Mithm"/"Mithmi"), or the same words in another order. */
export function similarNames(a: Pick<Member, 'firstName' | 'lastName'>, b: Pick<Member, 'firstName' | 'lastName'>): boolean {
  const wa = nameWords(a)
  const wb = nameWords(b)
  if (wa.length === 0 || wb.length === 0) return false
  if ([...wa].sort().join(' ') === [...wb].sort().join(' ')) return true
  const [fa, fb] = [wa[0], wb[0]]
  if (fa === fb) return true
  const shorter = Math.min(fa.length, fb.length)
  if (shorter >= 4 && (fa.startsWith(fb) || fb.startsWith(fa))) return true
  // Typos keep the first letter; "Amal" and "Kamal" are different people.
  return shorter >= 4 && fa[0] === fb[0] && editDistance(fa, fb) <= (shorter >= 7 ? 2 : 1)
}

const normalNic = (nic: string | null): string => (nic ?? '').toUpperCase().replace(/[^0-9VX]/g, '')

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Every pair of members listed together on a registration: couple and family plans. */
function registeredTogether(db: Db): Set<string> {
  const byRegistration = new Map<string, string[]>()
  for (const link of db.select().from(registrationMembers).all()) {
    byRegistration.set(link.registrationId, [...(byRegistration.get(link.registrationId) ?? []), link.memberId])
  }
  const pairs = new Set<string>()
  for (const ids of byRegistration.values()) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.add(pairKey(ids[i], ids[j]))
  }
  return pairs
}

/**
 * Records that are probably the same person entered twice: the old app made
 * a new member every time someone re-registered. Sharing a phone number
 * isn't enough (couples and families often give one number), so a pair also
 * needs similar names, must not have different NICs, and must never have been
 * on the same registration together.
 */
export function possibleDuplicates(db: Db): DuplicateGroup[] {
  const byPhone = new Map<string, MemberListItem[]>()
  for (const m of listMembers(db)) {
    const key = phoneKey(m.mobileNumber)
    if (key) byPhone.set(key, [...(byPhone.get(key) ?? []), m])
  }
  const together = registeredTogether(db)

  const groups: DuplicateGroup[] = []
  for (const sharing of byPhone.values()) {
    if (sharing.length < 2) continue
    // Join likely-same pairs into groups (A~B and B~C put all three together).
    const parent = sharing.map((_, i) => i)
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
    for (let i = 0; i < sharing.length; i++) {
      for (let j = i + 1; j < sharing.length; j++) {
        const [a, b] = [sharing[i], sharing[j]]
        const nicA = normalNic(a.nic)
        const nicB = normalNic(b.nic)
        if (together.has(pairKey(a.id, b.id))) continue
        if (nicA && nicB && nicA !== nicB) continue
        if (similarNames(a, b)) parent[root(j)] = root(i)
      }
    }
    const components = new Map<number, MemberListItem[]>()
    sharing.forEach((m, i) => components.set(root(i), [...(components.get(root(i)) ?? []), m]))
    for (const members of components.values()) {
      if (members.length > 1) groups.push({ mobileNumber: members[0].mobileNumber ?? '', members })
    }
  }
  return groups.sort((a, b) => a.members[0].firstName.localeCompare(b.members[0].firstName))
}

const FILLABLE = [
  'dob',
  'mobileNumber',
  'secondaryNumber',
  'nic',
  'address',
  'occupation',
  'weight',
  'height'
] as const satisfies readonly (keyof Member)[]

/**
 * Moves every registration of the duplicates onto the member being kept,
 * copies details the kept member is missing, then deletes the duplicates.
 * Payments hang off registrations, so they follow automatically.
 */
export function mergeMembers(db: Db, keepId: string, mergeIds: string[]): void {
  const others = mergeIds.filter((id) => id !== keepId)
  if (others.length === 0) throw new AppError('Choose at least one other member to merge.')
  const together = registeredTogether(db)

  db.transaction((tx) => {
    const keep = findMember(tx, keepId)
    const patch: Partial<Record<(typeof FILLABLE)[number], unknown>> = {}
    for (const otherId of others) {
      const other = findMember(tx, otherId)
      if (together.has(pairKey(keepId, otherId))) {
        throw new AppError(
          `${fullName(keep)} and ${fullName(other)} are on the same registration, so they're different people and can't be merged.`
        )
      }
      for (const field of FILLABLE) {
        const current = patch[field] ?? keep[field]
        if ((current === null || current === '') && other[field] !== null && other[field] !== '') {
          patch[field] = other[field]
        }
      }
      tx.update(registrationMembers)
        .set({ memberId: keepId })
        .where(eq(registrationMembers.memberId, otherId))
        .run()
      // Visits would otherwise be deleted along with the duplicate.
      tx.update(visits).set({ memberId: keepId }).where(eq(visits.memberId, otherId)).run()
      tx.delete(members).where(eq(members.id, otherId)).run()
    }
    tx.update(members)
      .set({ ...(patch as Partial<Member>), updatedAt: nowUtc() })
      .where(eq(members.id, keepId))
      .run()
  })
}
