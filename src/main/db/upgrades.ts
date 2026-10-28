// One-time data changes that schema migrations can't express. They run when a
// database is opened, so a restored older backup is brought up to date too.
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { putSetting, readSettings } from '../services/settings'
import type { Executor } from './client'
import { durations, membershipTypes, registrationMembers, registrations } from './schema'

/**
 * The old app charged the joining fee through copies of plans "with Reg.".
 * Each maps to its plain plan; the price difference is the joining fee.
 */
export const JOINING_FEE_PLANS: Array<{ plan: string; becomes: string; createWithFeePerPerson?: number }> = [
  { plan: 'One Months with Reg.', becomes: 'One Month' },
  { plan: 'Three Months with Reg.', becomes: 'Three Months' },
  { plan: 'Annual With Reg.', becomes: 'Annual' },
  { plan: 'Six Months With Reg.', becomes: '6 Months - Single' },
  { plan: 'One Month Couple with Reg', becomes: 'One Month Couple Package' },
  { plan: 'Annual Couple with Reg', becomes: 'Annual Couple Package' },
  { plan: 'Three months Couple with Reg', becomes: 'Three Months Couple Package' },
  { plan: 'Monthly Week Ends with Reg', becomes: 'One Month ( Week Ends Only )' },
  { plan: 'Off peak one Months with Reg', becomes: 'Off Peak Monthly ( 11.00am -4.00pm)' },
  { plan: 'One month 3 members with Reg', becomes: 'One Month - 3 Membes' },
  // There was no plain version; it's created with the usual couple fee.
  { plan: 'Off peak Three Months Couple with Reg', becomes: 'Off peak Three Months Couple', createWithFeePerPerson: 1500 }
]

const JOINING_FEE_FLAG = 'upgrade.joiningFeePlans'
const norm = (name: string): string => name.toLowerCase().replace(/\s+/g, ' ').trim()

export interface JoiningFeeConversion {
  registrations: number
  plansRemoved: number
  plansCreated: string[]
  skipped: string[]
}

/**
 * Moves registrations on "with Reg." plans onto the plain plan and records the
 * difference as each member's joining fee. Amounts and payments don't change.
 */
export function convertJoiningFeePlans(db: Executor): JoiningFeeConversion {
  const result: JoiningFeeConversion = { registrations: 0, plansRemoved: 0, plansCreated: [], skipped: [] }
  const plans = db
    .select({
      id: membershipTypes.id,
      name: membershipTypes.name,
      price: membershipTypes.price,
      people: membershipTypes.numberOfMembers,
      durationId: membershipTypes.durationId,
      archived: membershipTypes.archived,
      joiningFee: membershipTypes.joiningFee,
      length: sql<string>`${durations.duration} || ' ' || ${durations.durationType}`
    })
    .from(membershipTypes)
    .innerJoin(durations, eq(durations.id, membershipTypes.durationId))
    .all()
  const byName = (name: string) => plans.find((p) => norm(p.name) === norm(name))

  for (const { plan, becomes, createWithFeePerPerson } of JOINING_FEE_PLANS) {
    const withFee = byName(plan)
    if (!withFee) continue
    let plain = byName(becomes)
    if (!plain && createWithFeePerPerson !== undefined) {
      const created = {
        id: randomUUID(),
        name: becomes,
        price: withFee.price - createWithFeePerPerson * withFee.people,
        numberOfMembers: withFee.people,
        durationId: withFee.durationId,
        archived: withFee.archived,
        joiningFee: createWithFeePerPerson
      }
      db.insert(membershipTypes).values(created).run()
      plain = { ...created, people: created.numberOfMembers, length: withFee.length }
      plans.push(plain)
      result.plansCreated.push(becomes)
    }
    const fee = plain ? withFee.price - plain.price : 0
    if (!plain || plain.people !== withFee.people || plain.length !== withFee.length || fee <= 0) {
      result.skipped.push(plan)
      continue
    }
    // The plan's fee is per person; leave it for the owner if it doesn't split evenly.
    if (plain.joiningFee === 0 && fee % plain.people === 0) {
      db.update(membershipTypes).set({ joiningFee: fee / plain.people }).where(eq(membershipTypes.id, plain.id)).run()
    }

    const regs = db.select().from(registrations).where(eq(registrations.membershipTypeId, withFee.id)).all()
    for (const reg of regs) {
      const links = db.select().from(registrationMembers).where(eq(registrationMembers.registrationId, reg.id)).all()
      const total = Math.min(fee, reg.amount)
      links.forEach((link, i) => {
        // Split evenly; any cents go to the first member.
        const share = Math.floor((total / links.length) * 100) / 100
        const joiningFee = i === 0 ? Math.round((total - share * (links.length - 1)) * 100) / 100 : share
        db.update(registrationMembers)
          .set({ joiningFee })
          .where(sql`${registrationMembers.registrationId} = ${reg.id} and ${registrationMembers.memberId} = ${link.memberId}`)
          .run()
      })
      db.update(registrations).set({ membershipTypeId: plain.id }).where(eq(registrations.id, reg.id)).run()
      result.registrations++
    }
    db.delete(membershipTypes).where(eq(membershipTypes.id, withFee.id)).run()
    result.plansRemoved++
  }
  return result
}

/** Runs the one-time upgrades this database hasn't had yet. */
export function upgradeData(db: Executor): void {
  if (readSettings(db, [JOINING_FEE_FLAG]).has(JOINING_FEE_FLAG)) return
  const result = convertJoiningFeePlans(db)
  putSetting(db, JOINING_FEE_FLAG, new Date().toISOString())
  if (result.registrations > 0 || result.skipped.length > 0) console.log('Joining fee plans converted:', result)
}
