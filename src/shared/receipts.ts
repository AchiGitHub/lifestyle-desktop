import type { DaySummary, Receipt } from './api'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS } from './enums'
import { longDate, longDateTime, rupees } from './format'

const fullName = (m: { firstName: string; lastName: string }): string => `${m.firstName} ${m.lastName}`.trim()

/** The receipt as a WhatsApp message (*bold* is WhatsApp formatting). */
export function receiptText(r: Receipt): string {
  const lines = [`*${r.gym.gymName}*`, [r.number ? `Receipt ${r.number}` : 'Receipt', r.paidAt && longDateTime(r.paidAt)].filter(Boolean).join(' · '), '']
  if (r.members.length > 0) lines.push(r.members.map(fullName).join(', '))
  lines.push(r.item)
  if (r.detail) lines.push(r.detail)
  if (r.registration && r.registration.joiningFee > 0) {
    const { total, joiningFee } = r.registration
    lines.push(`Plan ${rupees(total - joiningFee)} + joining fee ${rupees(joiningFee)}`)
  }
  lines.push('', `*Paid: ${rupees(r.amount)}* (${PAYMENT_TYPE_LABELS[r.method]})`)
  if (r.registration) {
    lines.push(r.registration.balance > 0 ? `Balance to pay: ${rupees(r.registration.balance)}` : 'Fully paid')
  }
  if (r.gym.footer) lines.push('', r.gym.footer)
  return lines.join('\n')
}

/** A day's summary as a WhatsApp message for the owner. */
export function daySummaryText(day: DaySummary, gymName: string): string {
  const lines = [`*${gymName}: daily summary*`, longDate(day.date), '']
  for (const t of PAYMENT_TYPES) {
    lines.push(`${PAYMENT_TYPE_LABELS[t]}: ${rupees(day.byMethod[t].total)} (${day.byMethod[t].count})`)
  }
  lines.push(`*Total: ${rupees(day.total)}*`)
  if (day.store > 0 || day.personalTraining > 0) {
    const parts = [`Memberships ${rupees(day.memberships)}`]
    if (day.personalTraining > 0) parts.push(`personal training ${rupees(day.personalTraining)}`)
    if (day.store > 0) parts.push(`store ${rupees(day.store)}`)
    lines.push(parts.join(' · '))
  }
  lines.push('', `New sign-ups: ${day.newSignUps} · renewals: ${day.renewals}`, `Check-ins: ${day.checkIns}`)
  return lines.join('\n')
}
