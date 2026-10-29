import type {
  DurationType,
  Gender,
  PaymentCategory,
  PaymentType,
  ProductType,
  ReminderKind,
  SaleMethod,
  StockChangeKind,
  VisitSource,
  VisitStatus
} from './enums'
import type {
  CreditPaymentInput,
  DateRangeInput,
  DurationInput,
  JoiningFeeSettingsInput,
  MemberInput,
  MembershipTypeInput,
  PaymentAddInput,
  PaymentFilterInput,
  ProductEditInput,
  ProductInput,
  PtCreateInput,
  PtPackageInput,
  PtPaymentInput,
  PtUpdateInput,
  ReceiptRecipientInput,
  ReceiptSettingsInput,
  RegistrationCreateInput,
  RegistrationUpdateInput,
  ReminderInput,
  ReminderSettingsInput,
  SellInput,
  StockInput,
  TrainerInput
} from './schemas'

export interface Member {
  id: string
  firstName: string
  lastName: string
  gender: Gender
  dob: string | null
  mobileNumber: string | null
  secondaryNumber: string | null
  nic: string | null
  address: string | null
  occupation: string | null
  weight: number | null
  height: number | null
  createdAt: string
  updatedAt: string
}

export interface MemberListItem extends Member {
  /** Latest registration end date, or null if the member was never registered. */
  lastEndDate: string | null
  registrationCount: number
}

export interface Duration {
  id: string
  duration: number
  durationType: DurationType
  planCount: number
}

export interface MembershipType {
  id: string
  name: string
  price: number
  numberOfMembers: number
  durationId: string
  duration: number
  durationType: DurationType
  archived: boolean
  /** Per new member, on top of the price. */
  joiningFee: number
  registrationCount: number
}

export interface JoiningFeeSettings {
  /** Returning members pay the joining fee again after a break longer than this. */
  breakDays: number
}

export interface RegistrationMember {
  id: string
  firstName: string
  lastName: string
  mobileNumber: string | null
}

export interface Registration {
  id: string
  name: string
  membershipTypeId: string
  membershipTypeName: string
  startDate: string
  endDate: string
  /** Everything due, joining fees included. */
  amount: number
  /** The joining fees within `amount`. */
  joiningFee: number
  paid: number
  balance: number
  dismissedAt: string | null
  /** True when one of its members has a registration ending later. */
  renewed: boolean
  /** When a WhatsApp renewal reminder was last opened for it (UTC). */
  remindedAt: string | null
  members: RegistrationMember[]
}

/** A new registration, with the payment taken at sign-up (null if nothing was paid). */
export type NewRegistration = Registration & { paymentId: string | null }

export interface Payment {
  id: string
  registrationId: string | null
  legacyRegistrationId: string | null
  productId: string | null
  quantity: number | null
  amount: number
  paymentType: PaymentType
  category: PaymentCategory
  paidAt: string | null
  /** Member names, product name, or a note for migrated payments. */
  description: string
  receiptNo: number | null
  /** Store sales: the member who bought it, if they're one. */
  memberId: string | null
  memberName: string | null
  /** The instructor who recorded it on their phone; null at the front desk. */
  recordedBy: string | null
}

export interface Product {
  id: string
  name: string
  productType: ProductType
  quantity: number
  price: number
  sellingPrice: number
  sold: number
}

/** A product as an instructor's phone sees it: no cost price. */
export type StaffProduct = Pick<Product, 'id' | 'name' | 'productType' | 'sellingPrice' | 'quantity'>

/** A sale on an instructor's phone, in its list for today. */
export interface StaffSale {
  id: string
  /** Local 'YYYY-MM-DDTHH:mm:ss'. */
  paidAt: string
  productName: string
  quantity: number
  amount: number
  paymentType: SaleMethod
  /** Who bought it, if a member was chosen. */
  memberName: string | null
  /** How much longer the phone may undo it, as of the reply (0 when it can't). */
  undoSecondsLeft: number
}

/** A member an instructor can choose as the buyer: name, and the last digits of their phone to tell two apart. */
export interface MemberChoice {
  id: string
  name: string
  phoneEnding: string | null
}

export interface StockChange {
  id: string
  productId: string
  productName: string
  kind: StockChangeKind
  /** +12 for a delivery; for a count, the difference from what was recorded. */
  change: number
  quantityAfter: number
  /** The instructor's name; null at the front desk. */
  recordedBy: string | null
  /** Local 'YYYY-MM-DDTHH:mm:ss'. */
  changedAt: string
}

/** Where a product's stock stands after Received or Count. */
export interface StockResult {
  productName: string
  change: number
  quantityAfter: number
}

/** Something an instructor just did on their phone, for the notice at the desk. */
export type StoreChange =
  | {
      kind: 'SALE' | 'UNDO'
      by: string
      productName: string
      quantity: number
      amount: number
      paymentType: SaleMethod
      memberName: string | null
    }
  | ({ kind: StockChangeKind; by: string } & StockResult)

/** An item taken on credit. */
export interface CreditSale {
  id: string
  memberId: string
  memberName: string
  productName: string
  quantity: number
  amount: number
  /** What's still to pay on it: payments go to the oldest items first. */
  owed: number
  /** Local 'YYYY-MM-DDTHH:mm:ss'. */
  soldAt: string
  /** The instructor's name; null at the front desk. */
  recordedBy: string | null
}

/** Where a member's store credit stands. */
export interface MemberCredit {
  memberId: string
  firstName: string
  lastName: string
  mobileNumber: string | null
  owed: number
  /** Items not yet paid off, oldest first. */
  items: CreditSale[]
  /** When a WhatsApp reminder about it was last opened (UTC). */
  remindedAt: string | null
  /** When they last paid towards it (local time). */
  lastPaidAt: string | null
}

export interface MemberDetail {
  member: Member
  registrations: Registration[]
  payments: Payment[]
  visits: { lastAt: string | null; last30Days: number }
  credit: MemberCredit
  personalTraining: PtRegistration[]
}

export interface Trainer {
  id: string
  name: string
  /** The owner gets no commission. */
  isOwner: boolean
  commissionPercent: number
  archived: boolean
  packageCount: number
}

/** A personal training session type. */
export interface PtPackage {
  id: string
  name: string
  sessions: number
  price: number
  /** Sessions are used within this long from the start. */
  validDuration: number
  validDurationType: DurationType
  archived: boolean
  soldCount: number
}

/** A member's personal training package. */
export interface PtRegistration {
  id: string
  memberId: string
  memberName: string
  mobileNumber: string | null
  trainerId: string
  trainerName: string
  trainerIsOwner: boolean
  packageId: string | null
  packageName: string
  sessions: number
  /** Sessions had: check-ins for personal training. */
  used: number
  left: number
  startDate: string
  /** Sessions left after this day can't be used. */
  endDate: string
  amount: number
  /** The trainer's share, in rupees; 0 for the owner. */
  commission: number
  paid: number
  balance: number
  /** Local 'YYYY-MM-DDTHH:mm:ss'. */
  lastSessionAt: string | null
}

export type NewPtRegistration = PtRegistration & { paymentId: string | null }

/** A personal training session: a check-in against a package. */
export interface PtSession {
  /** The visit's id. */
  id: string
  checkedInAt: string
  memberId: string
  memberName: string
  trainerId: string
  trainerName: string
  ptRegistrationId: string
  packageName: string
  /** Which of the package's sessions this was: 6 (of 12). */
  number: number
  sessions: number
}

/** Packages sold in a month by one trainer, and the commission on them. */
export interface TrainerCommission {
  trainerId: string
  trainerName: string
  isOwner: boolean
  packages: PtRegistration[]
  total: number
  paid: number
  commission: number
  /** Sessions they gave that month. */
  sessions: number
}

/** A personal training package someone can use at check-in today. */
export interface CheckInOption {
  ptRegistrationId: string
  trainerName: string
  packageName: string
  sessionsLeft: number
  endDate: string
}

export interface Visit {
  id: string
  memberId: string
  memberName: string
  /** Local 'YYYY-MM-DDTHH:mm:ss'. */
  checkedInAt: string
  source: VisitSource
  status: VisitStatus
  /** A personal training session, with whom. */
  ptRegistrationId: string | null
  trainerName: string | null
}

/** The outcome of a check-in, for the door tablet and the desk alert. Never includes money. */
export interface CheckInResult {
  /** Null when they had already checked in within the last 2 hours. */
  visitId: string | null
  repeat: boolean
  memberId: string
  firstName: string
  fullName: string
  status: VisitStatus
  /** Latest membership end date, if they have one. */
  endDate: string | null
  source: VisitSource
  /** For a personal training session: with whom, and how many sessions are left after it. */
  session: { trainerName: string; sessionsLeft: number } | null
}

/** A member offered on the door tablet: first name and initial only. */
export interface CheckInCandidate {
  id: string
  name: string
}

/** A door tablet or instructor phone paired with this PC. */
export interface LanDevice {
  id: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
}

/** The door tablet's or instructor phones' server on the gym network. */
export interface LanStatus {
  enabled: boolean
  running: boolean
  port: number
  /** Addresses the device can open, e.g. http://192.168.1.20:8787. */
  addresses: string[]
  devices: LanDevice[]
  error: string | null
}

export interface LanPairing {
  code: string
  url: string
  expiresAt: string
}

export interface DuplicateGroup {
  mobileNumber: string
  members: MemberListItem[]
}

/** Money taken, and registrations starting, over a stretch of days. */
export interface PeriodFigures {
  income: number
  memberships: number
  personalTraining: number
  store: number
  newSignUps: number
  renewals: number
}

export interface MonthFigures extends PeriodFigures {
  /** 'YYYY-MM' */
  month: string
  /** The month in progress: its figures run up to today. */
  partial: boolean
  /** Last day counted (the month's end, or today); active members are counted on it. */
  through: string
  activeMembers: number
  /** Memberships ending in the month, and how many of them were renewed. */
  ending: number
  renewed: number
}

export interface DashboardReport {
  /** The chosen month and the 11 before it, oldest first. */
  months: MonthFigures[]
  /**
   * The month before the chosen one. While the chosen month is in progress,
   * only up to the same day, so 1–28 Oct is compared with 1–28 Sep.
   */
  previous: PeriodFigures & { from: string; to: string }
  /** The chosen month's income by payment method. */
  byPaymentType: Record<PaymentType, number>
  /** Joining fees on the chosen month's registrations. */
  joiningFees: number
  /** Ending in the chosen month, not renewed and not dismissed. */
  toRenew: number
  /** The chosen month's registrations by plan. */
  byPlan: Array<{ membershipTypeId: string; name: string; count: number; amount: number }>
}

export interface AuthStatus {
  hasPassword: boolean
  authenticated: boolean
  isEmpty: boolean
}

export interface LocalBackup {
  name: string
  size: number
  createdAt: string
}

export interface DriveBackup {
  id: string
  name: string
  createdTime: string
  size: number
}

export interface BackupStatus {
  dbPath: string
  driveConfigured: boolean
  driveConnected: boolean
  driveAccount: string | null
  lastBackupAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  running: boolean
  localBackups: LocalBackup[]
}

export interface UpdateStatus {
  /** Off in development builds. */
  enabled: boolean
  currentVersion: string
  state: 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'
  /** The newer version being downloaded or ready to install. */
  version: string | null
  percent: number | null
  error: string | null
  lastCheckedAt: string | null
}

export interface ReceiptSettings {
  gymName: string
  address: string
  phone: string
  footer: string
  /** WhatsApp number the daily summary is sent to. */
  ownerPhone: string
}

export interface Receipt {
  paymentId: string
  /** "R-00124"; null only for a payment that somehow has no number. */
  number: string | null
  paidAt: string | null
  method: PaymentType
  category: PaymentCategory
  amount: number
  gym: ReceiptSettings
  /** Members on the registration; empty for a store sale. */
  members: RegistrationMember[]
  /** What was paid for: the plan or product. */
  item: string
  /** Membership period, or "2 × Rs. 350". */
  detail: string | null
  /** Membership payments: where the registration stands after this payment. */
  registration: { total: number; joiningFee: number; paid: number; balance: number } | null
}

export interface MethodTotal {
  count: number
  total: number
}

/** One day's takings and activity, worked out from the records; nothing to close or count. */
export interface DaySummary {
  date: string
  byMethod: Record<PaymentType, MethodTotal>
  total: number
  /** Number of payments. */
  count: number
  /** Membership payments, joining fees included. */
  memberships: number
  personalTraining: number
  /** Store sales and other payments. */
  store: number
  /** Registrations entered that day where nobody had registered before. */
  newSignUps: number
  /** Registrations entered that day for people who had registered before. */
  renewals: number
  checkIns: number
}

/** The owner's daily summary: a Google Sheet in the gym's Drive that the app keeps up to date. */
export interface OwnerSummaryStatus {
  driveConnected: boolean
  enabled: boolean
  /** Google account the sheet is shared with, if any. */
  ownerEmail: string
  /** Link to the sheet, once it exists. */
  url: string | null
  /** When it was last uploaded (UTC). */
  lastUpdatedAt: string | null
  lastError: string | null
  running: boolean
}

export type ReminderTemplates = Record<ReminderKind, string>

export interface ReminderSettings {
  templates: ReminderTemplates
  /** Plans chosen for {packages}; empty means the most popular ones are listed. */
  packageIds: string[]
  /** The most popular current plans of the last 12 months. */
  popularPackageIds: string[]
  /** WhatsApp Desktop is installed; otherwise messages open in WhatsApp Web. */
  whatsappDesktop: boolean
}

export interface Api {
  auth: {
    status(): Promise<AuthStatus>
    login(password: string): Promise<boolean>
    setPassword(password: string): Promise<void>
    changePassword(current: string, next: string): Promise<void>
    logout(): Promise<void>
  }
  members: {
    list(): Promise<MemberListItem[]>
    get(id: string): Promise<MemberDetail>
    create(input: MemberInput): Promise<Member>
    update(id: string, input: MemberInput): Promise<Member>
    delete(ids: string[]): Promise<void>
    findByMobile(mobile: string): Promise<Member[]>
    possibleDuplicates(): Promise<DuplicateGroup[]>
    merge(keepId: string, mergeIds: string[]): Promise<void>
  }
  durations: {
    list(): Promise<Duration[]>
    create(input: DurationInput): Promise<void>
    update(id: string, input: DurationInput): Promise<void>
    delete(ids: string[]): Promise<void>
  }
  membershipTypes: {
    list(): Promise<MembershipType[]>
    create(input: MembershipTypeInput): Promise<void>
    update(id: string, input: MembershipTypeInput): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
    delete(ids: string[]): Promise<void>
  }
  joiningFee: {
    settings(): Promise<JoiningFeeSettings>
    save(input: JoiningFeeSettingsInput): Promise<void>
  }
  registrations: {
    list(filter: { status: 'active' | 'all' }): Promise<Registration[]>
    get(id: string): Promise<Registration>
    create(input: RegistrationCreateInput): Promise<NewRegistration>
    update(id: string, input: RegistrationUpdateInput): Promise<void>
    dismiss(ids: string[]): Promise<void>
    undismiss(ids: string[]): Promise<void>
    delete(ids: string[]): Promise<void>
    expiring(range: DateRangeInput): Promise<Registration[]>
    expired(): Promise<Registration[]>
  }
  payments: {
    list(filter: PaymentFilterInput): Promise<Payment[]>
    /** Returns the new payment's id. */
    add(input: PaymentAddInput): Promise<string>
    delete(id: string): Promise<void>
  }
  products: {
    list(): Promise<Product[]>
    create(input: ProductInput): Promise<void>
    update(id: string, input: ProductEditInput): Promise<void>
    delete(ids: string[]): Promise<void>
    /** Returns the sale's payment id, or for a sale on credit the credit sale's id. */
    sell(input: SellInput): Promise<string>
    /** Adds a delivery to the stock. */
    receiveStock(input: StockInput): Promise<StockResult>
    /** Sets the stock to what's on the shelf. */
    countStock(input: StockInput): Promise<StockResult>
    stockChanges(range: DateRangeInput): Promise<StockChange[]>
  }
  /** Personal trainers, set up in Settings. */
  trainers: {
    list(): Promise<Trainer[]>
    create(input: TrainerInput): Promise<void>
    update(id: string, input: TrainerInput): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
    delete(id: string): Promise<void>
  }
  /** Personal training session types. */
  ptPackages: {
    list(): Promise<PtPackage[]>
    create(input: PtPackageInput): Promise<void>
    update(id: string, input: PtPackageInput): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
    delete(id: string): Promise<void>
  }
  /** Members' personal training packages, kept apart from membership registrations. */
  personalTraining: {
    /** All of them, newest first. */
    list(): Promise<PtRegistration[]>
    create(input: PtCreateInput): Promise<NewPtRegistration>
    update(id: string, input: PtUpdateInput): Promise<void>
    delete(id: string): Promise<void>
    /** Returns the payment's id, for its receipt. */
    addPayment(input: PtPaymentInput): Promise<string>
    sessions(range: DateRangeInput): Promise<PtSession[]>
    /** A 'YYYY-MM' month: packages sold per trainer and their commission. */
    commission(month: string): Promise<TrainerCommission[]>
  }
  /** Store items members took to pay for later. */
  credit: {
    /** Everyone who owes, most owed first. */
    owed(): Promise<MemberCredit[]>
    sales(range: DateRangeInput): Promise<CreditSale[]>
    /** Returns the payment's id, for its receipt. */
    pay(input: CreditPaymentInput): Promise<string>
    /** A mistake: the items go back into stock. */
    deleteSale(id: string): Promise<void>
  }
  reports: {
    /** The dashboard for a 'YYYY-MM' month (a later month means this one). */
    dashboard(month: string): Promise<DashboardReport>
  }
  backup: {
    status(): Promise<BackupStatus>
    backupNow(): Promise<void>
    connectDrive(): Promise<void>
    disconnectDrive(): Promise<void>
    listDriveBackups(): Promise<DriveBackup[]>
    restoreFromDrive(fileId: string): Promise<void>
    restoreFromFile(): Promise<boolean>
    restoreLocal(name: string): Promise<void>
  }
  reminders: {
    settings(): Promise<ReminderSettings>
    save(input: ReminderSettingsInput): Promise<void>
    /** Opens WhatsApp with the message filled in; staff check it and press send. */
    send(input: ReminderInput): Promise<void>
    /** The same, about what a member owes for store items. */
    sendCredit(memberId: string): Promise<void>
  }
  receipts: {
    get(paymentId: string): Promise<Receipt>
    /** Opens the Windows print dialog. */
    print(paymentId: string): Promise<void>
    sendWhatsApp(paymentId: string, to: ReceiptRecipientInput): Promise<void>
    printSample(): Promise<void>
    settings(): Promise<ReceiptSettings>
    saveSettings(input: ReceiptSettingsInput): Promise<void>
  }
  visits: {
    list(range: DateRangeInput): Promise<Visit[]>
    /** Personal training packages they could check in for today; none means it's a gym visit. */
    options(memberId: string): Promise<CheckInOption[]>
    /** A check-in at the front desk; with a package, a personal training session. */
    checkIn(memberId: string, ptRegistrationId?: string | null): Promise<CheckInResult>
    /** Removing a personal training session gives the session back. */
    delete(id: string): Promise<void>
  }
  doorTablet: {
    status(): Promise<LanStatus>
    setEnabled(enabled: boolean): Promise<void>
    setPort(port: number): Promise<void>
    /** A one-time code (10 minutes) and link for pairing a tablet. */
    startPairing(): Promise<LanPairing>
    removeDevice(id: string): Promise<void>
  }
  /** Instructors' phones, for store sales and stock. */
  staffDevices: {
    status(): Promise<LanStatus>
    setEnabled(enabled: boolean): Promise<void>
    setPort(port: number): Promise<void>
    /** As for the door tablet; the phone is listed under the instructor's name. */
    startPairing(name: string): Promise<LanPairing>
    removeDevice(id: string): Promise<void>
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<void>
    /** Closes the app, installs the downloaded update and opens it again. */
    install(): Promise<void>
  }
  summary: {
    /** Every day in the range, newest first. */
    days(range: DateRangeInput): Promise<DaySummary[]>
    /** Opens WhatsApp with the day's summary for the owner. */
    sendToOwner(date: string): Promise<void>
    status(): Promise<OwnerSummaryStatus>
    setEnabled(enabled: boolean): Promise<void>
    /** Shares the sheet with this Google account ('' to stop adding anyone). */
    setOwnerEmail(email: string): Promise<void>
    updateNow(): Promise<void>
  }
}

/** Things the main process tells the window about; each returns an unsubscribe function. */
export interface AppEvents {
  onCheckIn(callback: (result: CheckInResult) => void): () => void
  onStoreChange(callback: (change: StoreChange) => void): () => void
}

/** What crosses the IPC boundary: errors travel as plain messages. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
