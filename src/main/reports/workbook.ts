// The accounts report as an Excel workbook, for the gym's accountant. Plain Node,
// so tests can build one and read it back.
import ExcelJS from 'exceljs'
import {
  PAYMENT_CATEGORY_LABELS,
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABELS,
  PRODUCT_TYPE_LABELS,
  type PaymentCategory
} from '../../shared/enums'
import { longDate, longDateTime, receiptNumber } from '../../shared/format'
import type { AccountsReport, StoreLine } from '../services/accounts'

type Kind = 'text' | 'date' | 'datetime' | 'money' | 'int'
type Value = string | number | null

interface Column<T> {
  header: string
  width: number
  kind: Kind
  value: (row: T) => Value
  /** Add up this column in a totals row. */
  total?: boolean
}

const FORMATS: Record<Kind, string | undefined> = {
  text: undefined,
  int: '#,##0',
  money: '#,##0.00',
  date: 'd mmm yyyy',
  datetime: 'd mmm yyyy h:mm AM/PM'
}

/**
 * A local 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss' as an Excel date. Excel dates
 * have no time zone and ExcelJS reads a Date's UTC parts, so they go in as UTC.
 */
function excelDate(iso: string): Date {
  const [day, time = '00:00:00'] = iso.split('T')
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi, s] = time.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, h, mi, s || 0))
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF3' } }

/** A sheet holding one table: bold frozen header, filters, formats, and a totals row. */
function addTable<T>(wb: ExcelJS.Workbook, name: string, columns: Column<T>[], rows: T[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width, style: { numFmt: FORMATS[c.kind] } }))
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = HEADER_FILL
  header.alignment = { vertical: 'middle', wrapText: true }
  for (const row of rows) {
    ws.addRow(
      columns.map((c) => {
        const v = c.value(row)
        return (c.kind === 'date' || c.kind === 'datetime') && typeof v === 'string' ? excelDate(v) : v
      })
    )
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  if (rows.length > 0 && columns.some((c) => c.total)) {
    const last = rows.length + 1
    const totals = ws.addRow(
      columns.map((c, i) => {
        if (i === 0) return 'Total'
        if (!c.total) return null
        const letter = ws.getColumn(i + 1).letter
        const result = Math.round(rows.reduce((s, r) => s + (Number(c.value(r)) || 0), 0) * 100) / 100
        return { formula: `SUM(${letter}2:${letter}${last})`, result }
      })
    )
    totals.font = { bold: true }
    totals.border = { top: { style: 'thin' } }
  }
  return ws
}

const methodLabel = (m: StoreLine['method']): string => (m === 'CREDIT' ? 'On credit (not yet income)' : PAYMENT_TYPE_LABELS[m])
const COST_FROM: Record<StoreLine['costFrom'], string> = {
  SALE: 'At sale',
  CURRENT: 'Current price (estimate)',
  UNKNOWN: 'Not known (no product on record)'
}
const OWED_KIND = { MEMBERSHIP: 'Membership', PERSONAL_TRAINING: 'Personal training', STORE_CREDIT: 'Store credit' } as const
const monthLabel = (m: string): string => longDate(`${m}-01`).replace(/^1 /, '')

function addSummary(wb: ExcelJS.Workbook, r: AccountsReport, appVersion: string): void {
  const ws = wb.addWorksheet('Summary')
  ws.columns = [{ width: 46 }, { width: 18, style: { numFmt: FORMATS.money } }, { width: 12, style: { numFmt: FORMATS.int } }, { width: 60 }]
  const add = (cells: Value[], style?: Partial<ExcelJS.Style>) => {
    const row = ws.addRow(cells)
    if (style?.font) row.font = style.font
    return row
  }
  // Headings for the amount and count columns (B and C).
  const section = (title: string, amount = 'Amount (Rs.)', count = '') => {
    add([])
    const row = add([title, amount, count, ''])
    row.font = { bold: true }
    row.fill = HEADER_FILL
  }
  const total = (label: string, amount: number, count: number | null = null, note = '') =>
    add([label, amount, count, note], { font: { bold: true } })

  add([r.gym.gymName], { font: { bold: true, size: 14 } })
  const contact = [r.gym.address, r.gym.phone].filter(Boolean).join(' · ')
  if (contact) add([contact])
  add([`Accounts for ${longDate(r.from)} to ${longDate(r.to)}`], { font: { bold: true } })
  add([`Made ${longDateTime(r.generatedAt)}, app version ${appVersion}`])
  add(['Income is money received in the period. Sales made and amounts still owed are shown separately below.'])

  const byCat = (c: PaymentCategory) => r.byCategory[c]
  section('Income received')
  const deleted = r.deletedRegistrations
  add([
    'Membership fees (joining fees included)',
    byCat('MEMBERSHIP'),
    null,
    deleted.count > 0
      ? `Includes Rs. ${deleted.total.toLocaleString('en-US')} (${deleted.count} payments) for registrations deleted in the old system`
      : ''
  ])
  add(['Personal training', byCat('PERSONAL_TRAINING')])
  add(['Store: supplements', byCat('SUPPLEMENT')])
  add(['Store: beverages', byCat('BEVERAGE')])
  add(['Store: other sales', byCat('OTHER')])
  add(['Store credit collected (items taken on credit, paid for in the period)', byCat('STORE_CREDIT')])
  total('Total income', r.total)

  section('By payment method', 'Amount (Rs.)', 'Payments')
  for (const t of PAYMENT_TYPES) add([PAYMENT_TYPE_LABELS[t], r.byMethod[t].total, r.byMethod[t].count])
  total('Total', r.total, r.payments.length)

  section('Receipts', '', 'Count')
  add(['Receipts in the period', null, r.payments.length])
  if (r.receipts.first !== null && r.receipts.last !== null) {
    add(['Receipt numbers', null, null, `${receiptNumber(r.receipts.first)} to ${receiptNumber(r.receipts.last)}`])
  }
  const missing = r.receipts.missing
  add([
    'Missing receipt numbers',
    null,
    missing.length,
    missing.length === 0
      ? 'None'
      : `${missing.slice(0, 40).map(receiptNumber).join(', ')}${missing.length > 40 ? ` and ${missing.length - 40} more` : ''}: payments deleted to fix mistakes`
  ])

  const owedOf = (kind: keyof typeof OWED_KIND) => r.owed.filter((o) => o.kind === kind)
  const sumOwed = (kind: keyof typeof OWED_KIND) => Math.round(owedOf(kind).reduce((s, o) => s + o.owed, 0) * 100) / 100
  section(`Owed at the end of the period (${longDate(r.to)})`, 'Amount (Rs.)', 'Count')
  add(['Memberships', sumOwed('MEMBERSHIP'), owedOf('MEMBERSHIP').length])
  add(['Personal training', sumOwed('PERSONAL_TRAINING'), owedOf('PERSONAL_TRAINING').length])
  add(['Store credit', sumOwed('STORE_CREDIT'), owedOf('STORE_CREDIT').length])
  total('Total owed', Math.round(r.owed.reduce((s, o) => s + o.owed, 0) * 100) / 100, r.owed.length, 'Listed on "Owed at period end"')

  const sum = <T>(rows: T[], f: (x: T) => number) => Math.round(rows.reduce((s, x) => s + f(x), 0) * 100) / 100
  const credit = r.store.filter((s) => s.method === 'CREDIT')
  section('Sales made in the period', 'Amount (Rs.)', 'Count')
  add([
    'Memberships starting in the period',
    sum(r.memberships, (m) => m.amount),
    r.memberships.length,
    `Of which joining fees: Rs. ${sum(r.memberships, (m) => m.joiningFee).toLocaleString('en-US')}`
  ])
  add(['Personal training packages starting in the period', sum(r.training, (t) => t.amount), r.training.length])
  add(['Store items taken on credit', sum(credit, (s) => s.amount), credit.length, 'Income only when paid for'])

  const costed = r.store.filter((s) => s.cost !== null)
  const estimated = r.store.filter((s) => s.costFrom === 'CURRENT').length
  const unknown = r.store.filter((s) => s.costFrom === 'UNKNOWN').length
  section('Store: items sold in the period (paid and on credit)', 'Amount (Rs.)', 'Items')
  add(['Sales', sum(r.store, (s) => s.amount), sum(r.store, (s) => s.quantity)])
  add([
    'Cost of goods sold',
    sum(costed, (s) => s.cost ?? 0),
    null,
    [
      estimated && `${estimated} sales costed at today's cost price (estimate)`,
      unknown && `${unknown} sales have no product on record (imported from the old system, or the product was deleted), so no cost`
    ]
      .filter(Boolean)
      .join('; ')
  ])
  total('Gross margin', sum(costed, (s) => s.amount - (s.cost ?? 0)), null, unknown ? 'On the sales with a cost only' : '')

  section('Trainer commission (packages starting in the period)', 'Commission (Rs.)', 'Packages')
  if (r.trainers.length === 0) add(['No personal training packages'])
  for (const t of r.trainers) {
    add([t.trainer, t.isOwner ? null : t.commission, t.packages, t.isOwner ? 'Owner: no commission' : `On sales of Rs. ${t.sales.toLocaleString('en-US')}`])
  }
  if (r.trainers.length > 0) total('Total commission', sum(r.trainers, (t) => t.commission))

  section('Notes', '')
  add(['Members are listed by name only.'])
  if (r.undated > 0) add([`${r.undated} payments imported from the old system have no date and aren't in any period.`])
  if (deleted.count > 0) {
    add([
      `${deleted.count} membership payments (Rs. ${deleted.total.toLocaleString('en-US')}) are for registrations deleted in the old system. They are income received, but can't be listed under "Memberships sold", so membership income is more than the memberships sold.`
    ])
  }
  add([
    r.stockLoggedFrom
      ? `Stock at the end of the period is worked back from today's stock using the sales, deliveries and counts recorded since. Deliveries and counts are recorded from ${longDate(r.stockLoggedFrom)}; for earlier dates it may be off. Stock is valued at today's cost prices.`
      : "Stock at the end of the period is worked back from today's stock using the sales recorded since; no deliveries or counts have been recorded yet, so it may be off. Stock is valued at today's cost prices."
  ])
  ws.getColumn(4).alignment = { wrapText: true, vertical: 'top' }
  ws.getColumn(1).alignment = { wrapText: true, vertical: 'top' }
}

/** The whole workbook: a summary, then a sheet for each list. */
export async function accountsWorkbook(r: AccountsReport, appVersion: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = r.gym.gymName
  wb.created = new Date()

  addSummary(wb, r, appVersion)

  addTable(
    wb,
    'Monthly',
    [
      { header: 'Month', width: 14, kind: 'text', value: (m) => monthLabel(m.month) },
      { header: 'Memberships', width: 15, kind: 'money', value: (m) => m.memberships, total: true },
      { header: 'Personal training', width: 15, kind: 'money', value: (m) => m.personalTraining, total: true },
      { header: 'Store sales', width: 15, kind: 'money', value: (m) => m.store, total: true },
      { header: 'Store credit collected', width: 15, kind: 'money', value: (m) => m.storeCredit, total: true },
      { header: 'Total', width: 15, kind: 'money', value: (m) => m.total, total: true },
      ...PAYMENT_TYPES.map((t) => ({
        header: PAYMENT_TYPE_LABELS[t],
        width: 15,
        kind: 'money' as const,
        value: (m: AccountsReport['months'][number]) => m.byMethod[t],
        total: true
      }))
    ],
    r.months
  )

  addTable(
    wb,
    'Daily takings',
    [
      { header: 'Date', width: 14, kind: 'date', value: (d) => d.date },
      { header: 'Payments', width: 10, kind: 'int', value: (d) => d.count, total: true },
      ...PAYMENT_TYPES.map((t) => ({
        header: PAYMENT_TYPE_LABELS[t],
        width: 14,
        kind: 'money' as const,
        value: (d: AccountsReport['days'][number]) => d.byMethod[t].total,
        total: true
      })),
      { header: 'Total', width: 14, kind: 'money', value: (d) => d.total, total: true },
      { header: 'Memberships', width: 14, kind: 'money', value: (d) => d.memberships, total: true },
      { header: 'Personal training', width: 14, kind: 'money', value: (d) => d.personalTraining, total: true },
      { header: 'Store', width: 14, kind: 'money', value: (d) => d.store, total: true }
    ],
    r.days
  )

  addTable(
    wb,
    'Payments',
    [
      { header: 'Date and time', width: 20, kind: 'datetime', value: (p) => p.paidAt },
      { header: 'Receipt', width: 10, kind: 'text', value: (p) => (p.receiptNo === null ? '' : receiptNumber(p.receiptNo)) },
      { header: 'Received from', width: 28, kind: 'text', value: (p) => p.from },
      { header: 'For', width: 36, kind: 'text', value: (p) => p.for },
      { header: 'Category', width: 18, kind: 'text', value: (p) => PAYMENT_CATEGORY_LABELS[p.category] },
      { header: 'Paid by', width: 14, kind: 'text', value: (p) => PAYMENT_TYPE_LABELS[p.method] },
      { header: 'Amount', width: 14, kind: 'money', value: (p) => p.amount, total: true },
      { header: 'Recorded by', width: 16, kind: 'text', value: (p) => p.recordedBy ?? 'Front desk' }
    ],
    r.payments
  )

  addTable(
    wb,
    'Store sales',
    [
      { header: 'Date and time', width: 20, kind: 'datetime', value: (s) => s.soldAt },
      { header: 'Receipt', width: 10, kind: 'text', value: (s) => (s.receiptNo === null ? '' : receiptNumber(s.receiptNo)) },
      { header: 'Product', width: 26, kind: 'text', value: (s) => s.productName },
      { header: 'Type', width: 12, kind: 'text', value: (s) => (s.productType ? PRODUCT_TYPE_LABELS[s.productType] : '') },
      { header: 'Quantity', width: 9, kind: 'int', value: (s) => s.quantity, total: true },
      { header: 'Unit price', width: 12, kind: 'money', value: (s) => s.unitPrice },
      { header: 'Amount', width: 13, kind: 'money', value: (s) => s.amount, total: true },
      { header: 'Unit cost', width: 12, kind: 'money', value: (s) => s.unitCost },
      { header: 'Cost', width: 13, kind: 'money', value: (s) => s.cost, total: true },
      { header: 'Margin', width: 13, kind: 'money', value: (s) => (s.cost === null ? null : Math.round((s.amount - s.cost) * 100) / 100), total: true },
      { header: 'Cost from', width: 24, kind: 'text', value: (s) => COST_FROM[s.costFrom] },
      { header: 'Paid by', width: 24, kind: 'text', value: (s) => methodLabel(s.method) },
      { header: 'Bought by', width: 24, kind: 'text', value: (s) => s.buyer ?? '' }
    ],
    r.store
  )

  addTable(
    wb,
    'Store by product',
    [
      { header: 'Product', width: 28, kind: 'text', value: (p) => p.productName },
      { header: 'Quantity', width: 10, kind: 'int', value: (p) => p.quantity, total: true },
      { header: 'Sales', width: 14, kind: 'money', value: (p) => p.sales, total: true },
      { header: 'Cost', width: 14, kind: 'money', value: (p) => p.cost, total: true },
      { header: 'Margin', width: 14, kind: 'money', value: (p) => (p.cost === null ? null : Math.round((p.sales - p.cost) * 100) / 100), total: true }
    ],
    r.products
  )

  addTable(
    wb,
    'Memberships sold',
    [
      { header: 'Start', width: 13, kind: 'date', value: (m) => m.startDate },
      { header: 'End', width: 13, kind: 'date', value: (m) => m.endDate },
      { header: 'Plan', width: 22, kind: 'text', value: (m) => m.plan },
      { header: 'Members', width: 32, kind: 'text', value: (m) => m.members },
      { header: 'Plan price', width: 13, kind: 'money', value: (m) => m.amount - m.joiningFee, total: true },
      { header: 'Joining fees', width: 13, kind: 'money', value: (m) => m.joiningFee, total: true },
      { header: 'Total', width: 13, kind: 'money', value: (m) => m.amount, total: true },
      { header: 'Paid by period end', width: 15, kind: 'money', value: (m) => m.paidByEnd, total: true },
      { header: 'Owed at period end', width: 15, kind: 'money', value: (m) => m.owedAtEnd, total: true }
    ],
    r.memberships
  )

  addTable(
    wb,
    'Personal training',
    [
      { header: 'Start', width: 13, kind: 'date', value: (t) => t.startDate },
      { header: 'Member', width: 26, kind: 'text', value: (t) => t.member },
      { header: 'Trainer', width: 18, kind: 'text', value: (t) => (t.trainerIsOwner ? `${t.trainer} (owner)` : t.trainer) },
      { header: 'Session type', width: 20, kind: 'text', value: (t) => t.packageName },
      { header: 'Sessions', width: 9, kind: 'int', value: (t) => t.sessions },
      { header: 'Price', width: 13, kind: 'money', value: (t) => t.amount, total: true },
      { header: 'Paid by period end', width: 15, kind: 'money', value: (t) => t.paidByEnd, total: true },
      { header: 'Owed at period end', width: 15, kind: 'money', value: (t) => t.owedAtEnd, total: true },
      { header: 'Trainer commission', width: 15, kind: 'money', value: (t) => t.commission, total: true }
    ],
    r.training
  )

  addTable(
    wb,
    'Owed at period end',
    [
      { header: 'What', width: 18, kind: 'text', value: (o) => OWED_KIND[o.kind] },
      { header: 'Member', width: 30, kind: 'text', value: (o) => o.member },
      { header: 'For', width: 40, kind: 'text', value: (o) => o.for },
      { header: 'Since', width: 13, kind: 'date', value: (o) => o.since },
      { header: 'Owed', width: 14, kind: 'money', value: (o) => o.owed, total: true }
    ],
    r.owed
  )

  addTable(
    wb,
    'Stock',
    [
      { header: 'Product', width: 28, kind: 'text', value: (s) => s.productName },
      { header: 'Type', width: 12, kind: 'text', value: (s) => PRODUCT_TYPE_LABELS[s.productType] },
      { header: 'Cost price', width: 12, kind: 'money', value: (s) => s.costPrice },
      { header: `Stock on ${longDate(r.to)}`, width: 14, kind: 'int', value: (s) => s.atEnd, total: true },
      { header: `Value on ${longDate(r.to)}`, width: 15, kind: 'money', value: (s) => s.atEnd * s.costPrice, total: true },
      { header: 'Stock now', width: 11, kind: 'int', value: (s) => s.now, total: true }
    ],
    r.stock
  )

  return Buffer.from(await wb.xlsx.writeBuffer())
}
