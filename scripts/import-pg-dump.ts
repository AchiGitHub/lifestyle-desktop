/**
 * One-time migration: reads the old app's plain-SQL pg_dump (no Postgres
 * needed) and writes a Lifestyle SQLite database, then prints a
 * reconciliation report to compare against the dump.
 *
 *   npm run import-dump -- <dump.sql> <out.db> [--force] [--as-of YYYY-MM-DD]
 *
 * Load the result on the gym PC with Settings → Restore from file.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { openDatabase, type Db } from '../src/main/db/client'
import * as t from '../src/main/db/schema'
import { convertJoiningFeePlans } from '../src/main/db/upgrades'
import { numberReceipts } from '../src/main/services/payments'
import { todayIso } from '../src/shared/dates'
import {
  DURATION_TYPES,
  GENDERS,
  PAYMENT_TYPES,
  PRODUCT_TYPES,
  type PaymentCategory,
  type ProductType
} from '../src/shared/enums'

type Row = Record<string, string | null>

// ---------------------------------------------------------------- parsing

const ESCAPES: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }

/** One field of PostgreSQL's COPY text format. */
function unescapeCopy(field: string): string | null {
  if (field === '\\N') return null
  return field.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|(.))/g, (_m, oct, hex, ch) =>
    oct ? String.fromCharCode(parseInt(oct, 8)) : hex ? String.fromCharCode(parseInt(hex, 16)) : (ESCAPES[ch] ?? ch)
  )
}

function parseDump(text: string): Map<string, Row[]> {
  const tables = new Map<string, Row[]>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const head = /^COPY public\.(\w+) \((.*)\) FROM stdin;$/.exec(lines[i])
    if (!head) continue
    const columns = head[2].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const rows: Row[] = []
    for (i++; i < lines.length && lines[i] !== '\\.'; i++) {
      const fields = lines[i].split('\t')
      rows.push(Object.fromEntries(columns.map((c, k) => [c, unescapeCopy(fields[k] ?? '\\N')])))
    }
    tables.set(head[1], rows)
  }
  return tables
}

// ------------------------------------------------------------ conversions

// The old backend stored browser UTC instants without a zone. IANA rules
// cover Sri Lanka's past offsets (+06:30 in 1996, +06:00 until 2006).
const colombo = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

function utcToColombo(value: string | null): { date: string; dateTime: string } | null {
  if (!value) return null
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(value)
  if (!m) return null
  const instant = new Date(`${m[1]}T${m[2]}${(m[3] ?? '').slice(0, 4)}Z`)
  const p = Object.fromEntries(colombo.formatToParts(instant).map((x) => [x.type, x.value]))
  const date = `${p.year}-${p.month}-${p.day}`
  return { date, dateTime: `${date}T${p.hour}:${p.minute}:${p.second}` }
}

const localDate = (v: string | null): string | null => utcToColombo(v)?.date ?? null

function utcIso(value: string | null): string | undefined {
  const m = value && /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(value)
  return m ? `${m[1]}T${m[2]}${(m[3] ?? '.000').padEnd(4, '0').slice(0, 4)}Z` : undefined
}

const text = (v: string | null): string | null => {
  const s = v?.replace(/\s+/g, ' ').trim()
  return s ? s : null
}
const num = (v: string | null): number => (v === null || v === '' ? 0 : Number(v))
const positive = (v: string | null): number | null => (v !== null && Number(v) > 0 ? Number(v) : null)
// Heights and weights: the old data has float noise such as 509.99999999999994.
const measurement = (v: string | null): number | null => {
  const n = positive(v)
  return n === null ? null : Math.round(n * 10) / 10
}
const enumAt = <T extends readonly string[]>(values: T, v: string | null, fallback: T[number]): T[number] =>
  values[Number(v)] ?? fallback

function category(value: string | null): PaymentCategory {
  if (value === null || /membership/i.test(value)) return 'MEMBERSHIP'
  return (['SUPPLEMENT', 'BEVERAGE', 'OTHER'] as const).find((c) => c === value.toUpperCase()) ?? 'OTHER'
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

function chunked<T>(rows: T[], insert: (chunk: T[]) => void): void {
  for (let i = 0; i < rows.length; i += 400) insert(rows.slice(i, i + 400))
}

// ------------------------------------------------------------------- main

function main(): void {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const asOfIndex = args.indexOf('--as-of')
  const asOf = asOfIndex >= 0 ? args[asOfIndex + 1] : todayIso()
  const [dumpPath, outPath] = args.filter((a, i) => !a.startsWith('--') && i !== asOfIndex + 1)
  if (!dumpPath || !outPath) {
    console.error('Usage: npm run import-dump -- <dump.sql> <out.db> [--force] [--as-of YYYY-MM-DD]')
    process.exit(1)
  }
  if (existsSync(outPath)) {
    if (!force) {
      console.error(`${outPath} already exists. Pass --force to replace it.`)
      process.exit(1)
    }
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${outPath}${suffix}`, { force: true })
  }

  const source = parseDump(readFileSync(dumpPath, 'utf8'))
  const src = (name: string): Row[] => source.get(name) ?? []
  const fixes: string[] = []
  const note = (msg: string): void => {
    fixes.push(msg)
  }

  const durations = src('duration').map((r) => ({
    id: r.id!,
    duration: num(r.duration),
    durationType: enumAt(DURATION_TYPES, r.duration_type, 'MONTH'),
    createdAt: utcIso(r.created_date),
    updatedAt: utcIso(r.last_modified_date ?? r.created_date)
  }))
  const durationIds = new Set(durations.map((d) => d.id))
  const fallbackDuration =
    durations.find((d) => d.durationType === 'MONTH' && d.duration === 1) ?? durations[0] ?? null

  const types = src('membership_type').map((r) => {
    let durationId = r.duration_id ?? ''
    if (!durationIds.has(durationId)) {
      if (!fallbackDuration) throw new Error('A plan points to a missing duration and there are no durations at all.')
      note(`Plan "${text(r.membership_name)}" pointed to a deleted duration; set to ${fallbackDuration.duration} ${fallbackDuration.durationType.toLowerCase()}(s).`)
      durationId = fallbackDuration.id
    }
    return {
      id: r.id!,
      name: text(r.membership_name) ?? '(unnamed plan)',
      price: num(r.price),
      numberOfMembers: Math.max(1, num(r.number_of_members)),
      durationId,
      archived: false,
      createdAt: utcIso(r.created_date),
      updatedAt: utcIso(r.last_modified_date ?? r.created_date)
    }
  })
  const typeIds = new Set(types.map((x) => x.id))

  const members = src('members').map((r) => {
    const firstName = text(r.first_name)
    if (!firstName) note(`Member ${r.id} had no first name; saved as "(no name)".`)
    return {
      id: r.id!,
      firstName: firstName ?? '(no name)',
      lastName: text(r.last_name) ?? '',
      gender: enumAt(GENDERS, r.gender, 'OTHER'),
      dob: localDate(r.dob),
      mobileNumber: text(r.mobile_number),
      secondaryNumber: text(r.secondary_number),
      nic: text(r.nic),
      address: text(r.address),
      occupation: text(r.occupation),
      weight: measurement(r.weight),
      height: measurement(r.height),
      createdAt: utcIso(r.created_date),
      updatedAt: utcIso(r.last_modified_date ?? r.created_date)
    }
  })
  const memberIds = new Set(members.map((m) => m.id))

  let placeholderTypeId: string | null = null
  const registrations = src('registration').map((r) => {
    let membershipTypeId = r.membership_type ?? ''
    if (!typeIds.has(membershipTypeId)) {
      if (!placeholderTypeId) {
        if (!fallbackDuration) throw new Error('A registration needs a placeholder plan but there are no durations.')
        placeholderTypeId = randomUUID()
        types.push({
          id: placeholderTypeId,
          name: '(deleted type)',
          price: 0,
          numberOfMembers: 1,
          durationId: fallbackDuration.id,
          archived: true,
          createdAt: undefined,
          updatedAt: undefined
        })
      }
      note(`Registration "${text(r.name)}" (${localDate(r.start_date)}) pointed to a deleted plan; linked to "(deleted type)".`)
      membershipTypeId = placeholderTypeId
    }
    return {
      id: r.id!,
      name: text(r.name) ?? '(no name)',
      membershipTypeId,
      startDate: localDate(r.start_date) ?? localDate(r.created_date) ?? asOf,
      endDate: localDate(r.end_date) ?? localDate(r.start_date) ?? asOf,
      amount: num(r.amount),
      createdAt: utcIso(r.created_date),
      updatedAt: utcIso(r.last_modified_date ?? r.created_date)
    }
  })
  const registrationIds = new Set(registrations.map((r) => r.id))

  const links: { registrationId: string; memberId: string }[] = []
  const seenLinks = new Set<string>()
  let droppedLinks = 0
  for (const r of src('registration_users')) {
    const registrationId = r.registration_id ?? ''
    const memberId = r.users ?? ''
    if (!registrationIds.has(registrationId) || !memberIds.has(memberId)) {
      droppedLinks++
      continue
    }
    const key = `${registrationId}|${memberId}`
    if (seenLinks.has(key)) continue
    seenLinks.add(key)
    links.push({ registrationId, memberId })
  }
  if (droppedLinks) note(`Dropped ${droppedLinks} member link(s) to members or registrations that no longer exist.`)

  const products = src('store').map((r) => ({
    id: r.id!,
    name: text(r.product_name) ?? '(unnamed product)',
    productType: enumAt(PRODUCT_TYPES, r.product_type, 'OTHER') as ProductType,
    quantity: num(r.quantity),
    price: num(r.price),
    sellingPrice: num(r.selling_price),
    sold: num(r.sold),
    createdAt: utcIso(r.created_date),
    updatedAt: utcIso(r.last_modified_date ?? r.created_date)
  }))

  let orphanPayments = 0
  let undated = 0
  let uncategorised = 0
  const payments = src('payments').map((r) => {
    let registrationId: string | null = r.registration_id
    let legacyRegistrationId: string | null = null
    if (registrationId === ZERO_UUID) registrationId = null
    else if (registrationId && !registrationIds.has(registrationId)) {
      legacyRegistrationId = registrationId
      registrationId = null
      orphanPayments++
    }
    if (r.category === null) uncategorised++
    const paid = utcToColombo(r.created_date)
    if (!paid) undated++
    return {
      id: r.id!,
      registrationId,
      legacyRegistrationId,
      productId: null,
      quantity: null,
      amount: num(r.amount),
      paymentType: enumAt(PAYMENT_TYPES, r.payment_type, 'CASH'),
      category: category(r.category),
      paidAt: paid?.dateTime ?? null,
      createdAt: utcIso(r.created_date),
      updatedAt: utcIso(r.last_modified_date ?? r.created_date)
    }
  })
  if (orphanPayments) note(`Kept ${orphanPayments} payment(s) whose registration had been deleted (marked "registration deleted").`)
  if (uncategorised) note(`Set ${uncategorised} payment(s) with no category to "Membership fees".`)
  if (undated) note(`${undated} payment(s) have no date; they're kept but won't appear in date-range reports.`)

  const { sqlite, db } = openDatabase(resolve(outPath), resolve(__dirname, '../drizzle'))
  db.transaction((tx) => {
    chunked(durations, (c) => tx.insert(t.durations).values(c).run())
    chunked(types, (c) => tx.insert(t.membershipTypes).values(c).run())
    chunked(members, (c) => tx.insert(t.members).values(c).run())
    chunked(registrations, (c) => tx.insert(t.registrations).values(c).run())
    chunked(links, (c) => tx.insert(t.registrationMembers).values(c).run())
    chunked(products, (c) => tx.insert(t.products).values(c).run())
    chunked(payments, (c) => tx.insert(t.payments).values(c).run())
    // Receipt numbers in date order, so new payments continue after the old ones.
    numberReceipts(tx)
    // Opening the empty database already marked this upgrade done; run it on the imported data.
    const converted = convertJoiningFeePlans(tx)
    fixes.push(
      `Moved ${converted.registrations} registration(s) off ${converted.plansRemoved} "with Reg." plan(s) onto the plain plan, with the difference as the joining fee.` +
        (converted.plansCreated.length ? ` Created: ${converted.plansCreated.join(', ')}.` : '') +
        (converted.skipped.length ? ` Left as they were: ${converted.skipped.join(', ')}.` : '')
    )
  })
  const fkProblems = sqlite.pragma('foreign_key_check') as unknown[]
  if (fkProblems.length) throw new Error(`Foreign key check failed: ${JSON.stringify(fkProblems.slice(0, 5))}`)

  report(db, source, fixes, asOf)
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  sqlite.close()
  console.log(`\nWrote ${resolve(outPath)}`)
}

// ----------------------------------------------------------------- report

function report(db: Db, source: Map<string, Row[]>, fixes: string[], asOf: string): void {
  const n = (table: string): number => db.get<{ n: number }>(sql.raw(`select count(*) as n from ${table}`))!.n
  const lkr = (v: number): string => `LKR ${Math.round(v).toLocaleString('en-US')}`
  const srcCount = (name: string): number => source.get(name)?.length ?? 0

  console.log('\nRow counts (dump → SQLite)')
  for (const [from, to] of [
    ['members', 'members'],
    ['registration', 'registrations'],
    ['registration_users', 'registration_members'],
    ['payments', 'payments'],
    ['membership_type', 'membership_types'],
    ['duration', 'durations'],
    ['store', 'products']
  ]) {
    console.log(`  ${from.padEnd(20)} ${String(srcCount(from)).padStart(6)} → ${String(n(to)).padStart(6)}  ${to}`)
  }

  const sourceTotal = (source.get('payments') ?? []).reduce((s, r) => s + num(r.amount), 0)
  const total = db.get<{ s: number }>(sql`select coalesce(sum(amount), 0) as s from payments`)!.s
  console.log(`\nPayment total: dump ${lkr(sourceTotal)} → SQLite ${lkr(total)}${Math.abs(sourceTotal - total) < 0.01 ? '  ✓' : '  ✗ MISMATCH'}`)

  console.log('\nPayments by category')
  for (const r of db.all<{ category: string; n: number; s: number }>(
    sql`select category, count(*) as n, sum(amount) as s from payments group by category order by s desc`
  )) {
    console.log(`  ${r.category.padEnd(12)} ${String(r.n).padStart(5)}  ${lkr(r.s)}`)
  }

  console.log('\nPayments by month (local time)')
  for (const r of db.all<{ month: string | null; s: number; n: number }>(
    sql`select substr(paid_at, 1, 7) as month, count(*) as n, sum(amount) as s from payments group by 1 order by 1`
  )) {
    console.log(`  ${(r.month ?? 'undated').padEnd(8)} ${String(r.n).padStart(5)}  ${lkr(r.s)}`)
  }

  const active = db.get<{ n: number }>(sql`select count(*) as n from registrations where end_date >= ${asOf}`)!.n
  console.log(`\nRegistrations active on ${asOf}: ${active}`)

  const unpaid = db.all<{ name: string; startDate: string; amount: number }>(sql`
    select r.name, r.start_date as startDate, r.amount from registrations r
    where not exists (select 1 from payments p where p.registration_id = r.id)
    order by r.start_date`)
  const short = db.all<{ name: string; startDate: string; amount: number; paid: number }>(sql`
    select r.name, r.start_date as startDate, r.amount,
      (select sum(p.amount) from payments p where p.registration_id = r.id) as paid
    from registrations r
    where (select sum(p.amount) from payments p where p.registration_id = r.id) < r.amount
    order by r.start_date`)
  console.log(`\nFor the client to review: ${unpaid.length} registration(s) with no payment`)
  for (const r of unpaid) console.log(`  ${r.startDate}  ${r.name}  ${lkr(r.amount)}`)
  console.log(`\nFor the client to review: ${short.length} registration(s) paid less than the amount`)
  for (const r of short) console.log(`  ${r.startDate}  ${r.name}  ${lkr(r.paid)} of ${lkr(r.amount)}`)

  // A joining fee on someone who had registered before: a re-joining fee, or charged by mistake.
  const rejoined = db.all<{ name: string; startDate: string; fee: number }>(sql`
    select trim(m.first_name || ' ' || m.last_name) as name, r.start_date as startDate, rm.joining_fee as fee
    from registration_members rm
    join registrations r on r.id = rm.registration_id
    join members m on m.id = rm.member_id
    where rm.joining_fee > 0 and exists (
      select 1 from registration_members rm2 join registrations r2 on r2.id = rm2.registration_id
      where rm2.member_id = rm.member_id and r2.start_date < r.start_date)
    order by r.start_date`)
  console.log(`\nFor the client to review: ${rejoined.length} joining fee(s) charged to someone who had registered before`)
  for (const r of rejoined) console.log(`  ${r.startDate}  ${r.name}  ${lkr(r.fee)}`)

  console.log(`\nFixes applied (${fixes.length})`)
  for (const f of fixes) console.log(`  - ${f}`)
}

main()
