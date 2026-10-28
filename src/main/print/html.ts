// Printable receipt slip. A 72 mm column fits an 80 mm receipt printer and
// prints at the top of an A4 page just as well.
import type { Receipt, ReceiptSettings } from '../../shared/api'
import { PAYMENT_TYPE_LABELS } from '../../shared/enums'
import { longDateTime, rupees } from '../../shared/format'

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c])

const STYLE = `
  @page { margin: 6mm; }
  body { margin: 0; color: #000; font: 10.5pt 'Segoe UI', Arial, sans-serif; }
  .slip { width: 72mm; }
  h1 { margin: 0; font-size: 13pt; text-align: center; }
  .center { text-align: center; }
  .small { font-size: 9pt; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.5mm 0; vertical-align: top; }
  td.amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.strong td { font-weight: 700; font-size: 11.5pt; }
`

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><div class="slip">${body}</div></body></html>`
}

function header(gym: ReceiptSettings): string {
  const contact = [gym.address, gym.phone].filter(Boolean).map((line) => `<div class="small">${escapeHtml(line)}</div>`)
  return `<h1>${escapeHtml(gym.gymName)}</h1><div class="center">${contact.join('')}</div>`
}

function rows(items: Array<[string, string, boolean?]>): string {
  const tr = ([label, amount, strong]: [string, string, boolean?]) =>
    `<tr${strong ? ' class="strong"' : ''}><td>${escapeHtml(label)}</td><td class="amount">${escapeHtml(amount)}</td></tr>`
  return `<table>${items.map(tr).join('')}</table>`
}

export function receiptHtml(r: Receipt): string {
  const who = r.members.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ')
  const money: Array<[string, string, boolean?]> = [[`Paid (${PAYMENT_TYPE_LABELS[r.method]})`, rupees(r.amount), true]]
  if (r.registration) {
    const { total, joiningFee } = r.registration
    if (joiningFee > 0) money.push(['Plan', rupees(total - joiningFee)], ['Joining fee', rupees(joiningFee)])
    money.push(
      [joiningFee > 0 ? 'Total' : 'Plan total', rupees(total)],
      ['Paid to date', rupees(r.registration.paid)],
      ['Balance to pay', rupees(r.registration.balance)]
    )
  }
  const body = [
    header(r.gym),
    '<hr>',
    `<div class="center"><b>RECEIPT ${escapeHtml(r.number ?? '')}</b><div class="small">${escapeHtml(r.paidAt ? longDateTime(r.paidAt) : '')}</div></div>`,
    '<hr>',
    who ? `<div>${escapeHtml(who)}</div>` : '',
    `<div><b>${escapeHtml(r.item)}</b></div>`,
    r.detail ? `<div class="small">${escapeHtml(r.detail)}</div>` : '',
    '<hr>',
    rows(money),
    r.gym.footer ? `<hr><div class="center">${escapeHtml(r.gym.footer)}</div>` : ''
  ]
  return page(`Receipt ${r.number ?? ''}`, body.join(''))
}
