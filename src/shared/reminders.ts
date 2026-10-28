import type { ReminderKind } from './enums'
import { longDate, rupees } from './format'

export const DEFAULT_TEMPLATES: Record<ReminderKind, string> = {
  EXPIRING:
    'Hi {name}, this is Lifestyle Fitness Studio. Your {plan} membership ends on {endDate}. Renew at the front desk to keep training without a break.\n\nOur popular packages:\n{packages}\n\nThank you!',
  EXPIRED:
    'Hi {name}, this is Lifestyle Fitness Studio. Your {plan} membership ended on {endDate}. We miss you! Renew at the front desk any time and get back to training.\n\nOur popular packages:\n{packages}',
  BALANCE:
    'Hi {name}, this is Lifestyle Fitness Studio. {balance} is still due on your {plan} membership. Please settle it at the front desk on your next visit. Thank you!'
}

export const PLACEHOLDERS = ['name', 'plan', 'endDate', 'balance', 'packages'] as const
export type ReminderValues = Record<(typeof PLACEHOLDERS)[number], string>

export interface PackagePrice {
  name: string
  price: number
}

/** One line per plan, cheapest first: "• One Month – Rs. 6,000". */
export function packageLines(plans: PackagePrice[]): string {
  return [...plans]
    .sort((a, b) => a.price - b.price)
    .map((p) => `• ${p.name} – ${rupees(p.price)}`)
    .join('\n')
}

/** The words a template's placeholders become, formatted the way the app shows them. */
export function reminderValues(v: {
  firstName: string
  plan: string
  endDate: string
  balance: number
  packages: PackagePrice[]
}): ReminderValues {
  const name = v.firstName.trim()
  return {
    // Some old records are in capitals; "Hi NIMAL" reads like shouting.
    name: name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name,
    plan: v.plan,
    endDate: longDate(v.endDate),
    balance: rupees(v.balance),
    packages: packageLines(v.packages)
  }
}

/** Replaces the placeholders above; anything else in braces stays as typed. */
export function fillTemplate(template: string, values: ReminderValues): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    (PLACEHOLDERS as readonly string[]).includes(key) ? values[key as keyof ReminderValues] : match
  )
}

/**
 * The international number WhatsApp needs, from however it was typed:
 * 077 123 4567, 0771234567, 771234567 and +94 77 123 4567 all give 94771234567.
 * Other numbers typed with + or 00 are taken as already international.
 */
export function whatsappNumber(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  const digits = text.replace(/\D/g, '')
  const number = digits.startsWith('00') ? digits.slice(2) : digits
  // No country code starts with 0, so "+077…" is a local number with a stray +.
  const international = (text.startsWith('+') || digits.startsWith('00')) && !number.startsWith('0')
  if (!international) {
    if (number.length === 10 && number.startsWith('0')) return `94${number.slice(1)}`
    if (number.length === 9 && !number.startsWith('0')) return `94${number}`
  }
  // Sri Lankan: 94 and nine digits, sometimes typed with the local 0 kept ("+94 077…").
  if (number.length === 12 && number.startsWith('940')) return `94${number.slice(3)}`
  if (number.startsWith('94')) return number.length === 11 ? number : null
  return international && number.length >= 8 ? number : null
}
