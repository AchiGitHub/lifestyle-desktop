import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { openDatabase, type Db } from '../src/main/db/client'
import { durations, members, membershipTypes, registrationMembers, registrations } from '../src/main/db/schema'
import type { MemberInput } from '../src/shared/schemas'

export function makeDb(): Db {
  return openDatabase(':memory:', resolve(__dirname, '../drizzle')).db
}

export function memberData(overrides: Partial<MemberInput> = {}): MemberInput {
  return {
    firstName: 'Nimal',
    lastName: 'Perera',
    gender: 'MALE',
    dob: '1995-04-12',
    mobileNumber: '0771234567',
    secondaryNumber: '',
    nic: '',
    address: 'Kandy',
    occupation: '',
    weight: '',
    height: '',
    ...overrides
  } as MemberInput
}

export function seedPlan(db: Db, opts: { members?: number; months?: number; price?: number } = {}): string {
  const durationId = randomUUID()
  db.insert(durations).values({ id: durationId, duration: opts.months ?? 1, durationType: 'MONTH' }).run()
  const typeId = randomUUID()
  db.insert(membershipTypes)
    .values({
      id: typeId,
      name: `Plan ${typeId.slice(0, 4)}`,
      price: opts.price ?? 10000,
      numberOfMembers: opts.members ?? 1,
      durationId
    })
    .run()
  return typeId
}

export function seedMember(db: Db, overrides: Partial<typeof members.$inferInsert> = {}): string {
  const id = randomUUID()
  db.insert(members)
    .values({ id, firstName: 'Kamal', lastName: 'Silva', gender: 'MALE', mobileNumber: '0711111111', ...overrides })
    .run()
  return id
}

/** Inserts a registration directly, bypassing the service (for history fixtures). */
export function seedRegistration(
  db: Db,
  typeId: string,
  memberIds: string[],
  startDate: string,
  endDate: string
): string {
  const id = randomUUID()
  db.insert(registrations).values({ id, name: 'Fixture', membershipTypeId: typeId, startDate, endDate, amount: 10000 }).run()
  db.insert(registrationMembers)
    .values(memberIds.map((memberId) => ({ registrationId: id, memberId })))
    .run()
  return id
}
