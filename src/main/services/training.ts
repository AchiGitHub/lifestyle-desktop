import { randomUUID } from 'node:crypto'
import { eq, sql, type SQL } from 'drizzle-orm'
import type {
  CheckInOption,
  NewPtRegistration,
  PtPackage,
  PtRegistration,
  PtSession,
  Trainer,
  TrainerCommission
} from '../../shared/api'
import { monthRange, nowLocalIso, todayIso } from '../../shared/dates'
import { rupees } from '../../shared/format'
import {
  dateRangeInput,
  monthInput,
  ptCreateInput,
  ptPackageInput,
  ptPaymentInput,
  ptUpdateInput,
  trainerInput,
  type DateRangeInput,
  type PtCreateInput,
  type PtPackageInput,
  type PtPaymentInput,
  type PtUpdateInput,
  type TrainerInput
} from '../../shared/schemas'
import type { Db } from '../db/client'
import { members, payments, ptPackages, ptRegistrations, trainers } from '../db/schema'
import { AppError, nowUtc, plural } from './errors'
import { nextReceiptNo } from './payments'
import { registrationsForMember } from './registrations'

const money = (value: number): number => Math.round(value * 100) / 100

// ---------------------------------------------------------------- trainers

export function listTrainers(db: Db): Trainer[] {
  return db
    .all<Trainer>(sql`
      select t.id, t.name, t.is_owner as isOwner, t.commission_percent as commissionPercent, t.archived,
        (select count(*) from pt_registrations p where p.trainer_id = t.id) as packageCount
      from trainers t
      order by t.archived, t.is_owner desc, t.name collate nocase`)
    .map((t) => ({ ...t, isOwner: Boolean(t.isOwner), archived: Boolean(t.archived) }))
}

function trainerValues(raw: TrainerInput) {
  const input = trainerInput.parse(raw)
  return { ...input, commissionPercent: input.isOwner ? 0 : input.commissionPercent }
}

export function createTrainer(db: Db, raw: TrainerInput): void {
  db.insert(trainers).values({ id: randomUUID(), ...trainerValues(raw) }).run()
}

/** A new commission % only fills in future packages; ones already sold keep theirs. */
export function updateTrainer(db: Db, id: string, raw: TrainerInput): void {
  const result = db
    .update(trainers)
    .set({ ...trainerValues(raw), updatedAt: nowUtc() })
    .where(eq(trainers.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That trainer no longer exists.')
}

export function setTrainerArchived(db: Db, id: string, archived: boolean): void {
  db.update(trainers).set({ archived, updatedAt: nowUtc() }).where(eq(trainers.id, id)).run()
}

export function deleteTrainer(db: Db, id: string): void {
  const trainer = listTrainers(db).find((t) => t.id === id)
  if (!trainer) return
  if (trainer.packageCount > 0) {
    throw new AppError(
      `${trainer.name} has ${plural(trainer.packageCount, 'package')}, so they can't be deleted. Archive them to hide them from new packages.`
    )
  }
  db.delete(trainers).where(eq(trainers.id, id)).run()
}

// ----------------------------------------------------------- session types

export function listPtPackages(db: Db): PtPackage[] {
  return db
    .all<PtPackage>(sql`
      select k.id, k.name, k.sessions, k.price, k.valid_duration as validDuration,
        k.valid_duration_type as validDurationType, k.archived,
        (select count(*) from pt_registrations p where p.package_id = k.id) as soldCount
      from pt_packages k
      order by k.archived, k.sessions, k.name collate nocase`)
    .map((k) => ({ ...k, archived: Boolean(k.archived) }))
}

export function createPtPackage(db: Db, raw: PtPackageInput): void {
  db.insert(ptPackages)
    .values({ id: randomUUID(), ...ptPackageInput.parse(raw) })
    .run()
}

export function updatePtPackage(db: Db, id: string, raw: PtPackageInput): void {
  const result = db
    .update(ptPackages)
    .set({ ...ptPackageInput.parse(raw), updatedAt: nowUtc() })
    .where(eq(ptPackages.id, id))
    .run()
  if (result.changes === 0) throw new AppError('That session type no longer exists.')
}

export function setPtPackageArchived(db: Db, id: string, archived: boolean): void {
  db.update(ptPackages).set({ archived, updatedAt: nowUtc() }).where(eq(ptPackages.id, id)).run()
}

export function deletePtPackage(db: Db, id: string): void {
  const k = listPtPackages(db).find((p) => p.id === id)
  if (!k) return
  if (k.soldCount > 0) {
    throw new AppError(
      `"${k.name}" has been sold ${plural(k.soldCount, 'time')}, so it can't be deleted. Archive it to hide it from new packages.`
    )
  }
  db.delete(ptPackages).where(eq(ptPackages.id, id)).run()
}

// --------------------------------------------------------------- packages

interface PtRow extends Omit<PtRegistration, 'left' | 'balance' | 'trainerIsOwner'> {
  trainerIsOwner: number
}

/** Packages matching `where` (an SQL condition on alias `p`), newest first. */
export function loadPtRegistrations(db: Db, where?: SQL): PtRegistration[] {
  return db
    .all<PtRow>(sql`
      select p.id, p.member_id as memberId, trim(m.first_name || ' ' || m.last_name) as memberName,
        m.mobile_number as mobileNumber, p.trainer_id as trainerId, t.name as trainerName,
        t.is_owner as trainerIsOwner, p.package_id as packageId, p.package_name as packageName, p.sessions,
        p.start_date as startDate, p.end_date as endDate, p.amount, p.commission,
        (select count(*) from visits v where v.pt_registration_id = p.id) as used,
        (select max(v.checked_in_at) from visits v where v.pt_registration_id = p.id) as lastSessionAt,
        coalesce((select sum(pay.amount) from payments pay where pay.pt_registration_id = p.id), 0) as paid
      from pt_registrations p
      join members m on m.id = p.member_id
      join trainers t on t.id = p.trainer_id
      ${where ? sql`where ${where}` : sql``}
      order by p.start_date desc, p.created_at desc`)
    .map((p) => ({
      ...p,
      trainerIsOwner: Boolean(p.trainerIsOwner),
      left: Math.max(0, p.sessions - p.used),
      balance: Math.max(0, money(p.amount - p.paid))
    }))
}

export function listPtRegistrations(db: Db): PtRegistration[] {
  return loadPtRegistrations(db)
}

export function getPtRegistration(db: Db, id: string): PtRegistration {
  const [pt] = loadPtRegistrations(db, sql`p.id = ${id}`)
  if (!pt) throw new AppError('That personal training package no longer exists.')
  return pt
}

export function ptForMember(db: Db, memberId: string): PtRegistration[] {
  return loadPtRegistrations(db, sql`p.member_id = ${memberId}`)
}

function findTrainer(db: Db, id: string, allowArchived = false) {
  const trainer = db.select().from(trainers).where(eq(trainers.id, id)).get()
  if (!trainer) throw new AppError('That trainer no longer exists.')
  if (trainer.archived && !allowArchived) throw new AppError(`${trainer.name} is archived. Choose a current trainer.`)
  return trainer
}

/** Personal training is on top of a membership, so they need one that hasn't ended. */
function checkMembership(db: Db, memberId: string): void {
  const member = db.select().from(members).where(eq(members.id, memberId)).get()
  if (!member) throw new AppError('That member no longer exists.')
  const today = todayIso()
  if (!registrationsForMember(db, memberId).some((r) => r.endDate >= today)) {
    throw new AppError(`${member.firstName} has no current membership. Register or renew them first.`)
  }
}

export function createPtRegistration(db: Db, raw: PtCreateInput): NewPtRegistration {
  const input = ptCreateInput.parse(raw)
  checkMembership(db, input.memberId)
  const trainer = findTrainer(db, input.trainerId)
  const type = db.select().from(ptPackages).where(eq(ptPackages.id, input.packageId)).get()
  if (!type) throw new AppError('That session type no longer exists.')
  if (type.archived) throw new AppError(`"${type.name}" is archived. Choose a current session type.`)

  const id = randomUUID()
  const paymentId = input.payment.amount > 0 ? randomUUID() : null
  db.transaction((tx) => {
    tx.insert(ptRegistrations)
      .values({
        id,
        memberId: input.memberId,
        trainerId: trainer.id,
        packageId: type.id,
        packageName: type.name,
        sessions: input.sessions,
        startDate: input.startDate,
        endDate: input.endDate,
        amount: input.amount,
        commission: trainer.isOwner ? 0 : input.commission
      })
      .run()
    if (paymentId) {
      tx.insert(payments)
        .values({
          id: paymentId,
          ptRegistrationId: id,
          memberId: input.memberId,
          amount: input.payment.amount,
          paymentType: input.payment.paymentType,
          category: 'PERSONAL_TRAINING',
          paidAt: nowLocalIso(),
          receiptNo: nextReceiptNo(tx)
        })
        .run()
    }
  })
  return { ...getPtRegistration(db, id), paymentId }
}

export function updatePtRegistration(db: Db, id: string, raw: PtUpdateInput): void {
  const input = ptUpdateInput.parse(raw)
  const pt = getPtRegistration(db, id)
  // An archived trainer can stay on a package they already have.
  const trainer = findTrainer(db, input.trainerId, input.trainerId === pt.trainerId)
  if (input.sessions < pt.used) {
    throw new AppError(`They've already had ${plural(pt.used, 'session')}, so it can't be fewer than that.`)
  }
  db.update(ptRegistrations)
    .set({ ...input, commission: trainer.isOwner ? 0 : input.commission, updatedAt: nowUtc() })
    .where(eq(ptRegistrations.id, id))
    .run()
}

/** Only for a package entered by mistake: nothing paid and no sessions had. */
export function deletePtRegistration(db: Db, id: string): void {
  const pt = getPtRegistration(db, id)
  if (pt.paid > 0) throw new AppError('This package has payments, so it can’t be deleted.')
  if (pt.used > 0) {
    throw new AppError(`They’ve had ${plural(pt.used, 'session')} on this package, so it can’t be deleted.`)
  }
  db.delete(ptRegistrations).where(eq(ptRegistrations.id, id)).run()
}

/** Returns the payment's id, for its receipt. */
export function addPtPayment(db: Db, raw: PtPaymentInput): string {
  const input = ptPaymentInput.parse(raw)
  const pt = getPtRegistration(db, input.ptRegistrationId)
  if (pt.balance <= 0) throw new AppError('This package is already paid for.')
  if (input.amount > pt.balance) throw new AppError(`Only ${rupees(pt.balance)} is still to pay.`)
  const id = randomUUID()
  db.transaction((tx) => {
    tx.insert(payments)
      .values({
        id,
        ptRegistrationId: pt.id,
        memberId: pt.memberId,
        amount: input.amount,
        paymentType: input.paymentType,
        category: 'PERSONAL_TRAINING',
        paidAt: nowLocalIso(),
        receiptNo: nextReceiptNo(tx)
      })
      .run()
  })
  return id
}

/** Packages a member can have a session on today: started, not past their date, with sessions left. */
export function usablePt(db: Db, memberId: string, today: string): CheckInOption[] {
  return loadPtRegistrations(db, sql`p.member_id = ${memberId} and p.start_date <= ${today} and p.end_date >= ${today}`)
    .filter((p) => p.left > 0)
    .map((p) => ({
      ptRegistrationId: p.id,
      trainerName: p.trainerName,
      packageName: p.packageName,
      sessionsLeft: p.left,
      endDate: p.endDate
    }))
}

/** A balance on a package that's still running, as counts for "owes money" at check-in. */
export function owesForPt(db: Db, memberId: string, today: string): boolean {
  return loadPtRegistrations(db, sql`p.member_id = ${memberId} and p.end_date >= ${today}`).some((p) => p.balance > 0)
}

/** Sessions had in a date range, newest first, numbered within their package. */
export function listPtSessions(db: Db, raw: DateRangeInput): PtSession[] {
  const range = dateRangeInput.parse(raw)
  return db.all<PtSession>(sql`
    select v.id, v.checked_in_at as checkedInAt, v.member_id as memberId,
      trim(m.first_name || ' ' || m.last_name) as memberName, t.id as trainerId, t.name as trainerName,
      p.id as ptRegistrationId, p.package_name as packageName, p.sessions,
      (select count(*) from visits v2 where v2.pt_registration_id = v.pt_registration_id
        and (v2.checked_in_at < v.checked_in_at or (v2.checked_in_at = v.checked_in_at and v2.id <= v.id))) as number
    from visits v
    join pt_registrations p on p.id = v.pt_registration_id
    join members m on m.id = v.member_id
    join trainers t on t.id = p.trainer_id
    where substr(v.checked_in_at, 1, 10) between ${range.from} and ${range.to}
    order by v.checked_in_at desc`)
}

/**
 * Commission is earned when a package is sold: each trainer's packages
 * starting in the month, with what's been paid so far, and the sessions they
 * gave that month. Trainers with nothing that month are left out.
 */
export function commissionReport(db: Db, raw: string): TrainerCommission[] {
  const { from, to } = monthRange(`${monthInput.parse(raw)}-01`)
  const sold = loadPtRegistrations(db, sql`p.start_date between ${from} and ${to}`)
  const sessions = new Map(
    db
      .all<{ trainerId: string; n: number }>(sql`
        select p.trainer_id as trainerId, count(*) as n from visits v
        join pt_registrations p on p.id = v.pt_registration_id
        where substr(v.checked_in_at, 1, 10) between ${from} and ${to}
        group by p.trainer_id`)
      .map((r) => [r.trainerId, r.n])
  )
  return listTrainers(db)
    .map((t) => {
      const packages = sold.filter((p) => p.trainerId === t.id)
      const sum = (f: (p: PtRegistration) => number) => money(packages.reduce((s, p) => s + f(p), 0))
      return {
        trainerId: t.id,
        trainerName: t.name,
        isOwner: t.isOwner,
        packages,
        total: sum((p) => p.amount),
        paid: sum((p) => p.paid),
        commission: sum((p) => p.commission),
        sessions: sessions.get(t.id) ?? 0
      }
    })
    .filter((t) => t.packages.length > 0 || t.sessions > 0)
}
