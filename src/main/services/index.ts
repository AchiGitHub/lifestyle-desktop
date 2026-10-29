import type { Api } from '../../shared/api'
import type { SellInput, StockInput } from '../../shared/schemas'
import type { Db } from '../db/client'
import * as credit from './credit'
import * as joining from './joining'
import * as members from './members'
import * as payments from './payments'
import * as plans from './plans'
import * as products from './products'
import * as registrations from './registrations'
import { dashboardReport } from './reports'
import * as training from './training'
import * as visits from './visits'

export type DomainApi = Omit<
  Api,
  'auth' | 'backup' | 'reminders' | 'receipts' | 'summary' | 'updates' | 'doorTablet' | 'staffDevices' | 'reports'
> & {
  // Saving the accounts workbook needs a file dialog, so that part is in ipc.ts.
  reports: Pick<Api['reports'], 'dashboard'>
}

/**
 * The data-handling half of the API. Auth, backup, and the groups that open
 * WhatsApp, print or use Google Drive (reminders, receipts, summary) live in ipc.ts.
 */
export function createServices(db: Db): DomainApi {
  const sync =
    <A extends unknown[], R>(fn: (db: Db, ...args: A) => R) =>
    async (...args: A): Promise<R> =>
      fn(db, ...args)

  return {
    members: {
      list: sync(members.listMembers),
      get: sync(members.getMember),
      create: sync(members.createMember),
      update: sync(members.updateMember),
      delete: sync(members.deleteMembers),
      findByMobile: sync(members.findByMobile),
      possibleDuplicates: sync(members.possibleDuplicates),
      merge: sync(members.mergeMembers)
    },
    durations: {
      list: sync(plans.listDurations),
      create: sync(plans.createDuration),
      update: sync(plans.updateDuration),
      delete: sync(plans.deleteDurations)
    },
    membershipTypes: {
      list: sync(plans.listMembershipTypes),
      create: sync(plans.createMembershipType),
      update: sync(plans.updateMembershipType),
      setArchived: sync(plans.setMembershipTypeArchived),
      delete: sync(plans.deleteMembershipTypes)
    },
    joiningFee: {
      settings: sync(joining.joiningFeeSettings),
      save: sync(joining.saveJoiningFeeSettings)
    },
    visits: {
      list: sync(visits.listVisits),
      options: sync((d: Db, memberId: string) => visits.checkInOptions(d, memberId)),
      checkIn: sync((d: Db, memberId: string, ptRegistrationId?: string | null) =>
        visits.checkIn(d, memberId, 'DESK', new Date(), ptRegistrationId ?? null)
      ),
      delete: sync(visits.deleteVisit)
    },
    trainers: {
      list: sync(training.listTrainers),
      create: sync(training.createTrainer),
      update: sync(training.updateTrainer),
      setArchived: sync(training.setTrainerArchived),
      delete: sync(training.deleteTrainer)
    },
    ptPackages: {
      list: sync(training.listPtPackages),
      create: sync(training.createPtPackage),
      update: sync(training.updatePtPackage),
      setArchived: sync(training.setPtPackageArchived),
      delete: sync(training.deletePtPackage)
    },
    personalTraining: {
      list: sync(training.listPtRegistrations),
      create: sync(training.createPtRegistration),
      update: sync(training.updatePtRegistration),
      delete: sync(training.deletePtRegistration),
      addPayment: sync(training.addPtPayment),
      sessions: sync(training.listPtSessions),
      commission: sync(training.commissionReport)
    },
    registrations: {
      list: sync(registrations.listRegistrations),
      get: sync(registrations.getRegistration),
      create: sync(registrations.createRegistration),
      update: sync(registrations.updateRegistration),
      dismiss: sync((d: Db, ids: string[]) => registrations.setDismissed(d, ids, true)),
      undismiss: sync((d: Db, ids: string[]) => registrations.setDismissed(d, ids, false)),
      delete: sync(registrations.deleteRegistrations),
      expiring: sync(registrations.expiringRegistrations),
      expired: sync(registrations.expiredRegistrations)
    },
    payments: {
      list: sync(payments.listPayments),
      add: sync(payments.addPayment),
      delete: sync(payments.deletePayment)
    },
    products: {
      list: sync(products.listProducts),
      create: sync(products.createProduct),
      update: sync(products.updateProduct),
      delete: sync(products.deleteProducts),
      // At the front desk: nobody's phone is recorded.
      sell: sync((d: Db, input: SellInput) => products.sellProduct(d, input)),
      receiveStock: sync((d: Db, input: StockInput) => products.receiveStock(d, input)),
      countStock: sync((d: Db, input: StockInput) => products.countStock(d, input)),
      stockChanges: sync(products.listStockChanges)
    },
    credit: {
      owed: sync(credit.owedList),
      sales: sync(credit.listCreditSales),
      pay: sync(credit.payCredit),
      deleteSale: sync(credit.deleteCreditSale)
    },
    reports: {
      dashboard: sync(dashboardReport)
    }
  }
}
