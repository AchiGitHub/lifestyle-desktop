// Formatting shared by the main process (receipts, WhatsApp messages) and the UI.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Rs. 8,000" */
export function rupees(value: number): string {
  return `Rs. ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/** "3 Nov 2026", from 'YYYY-MM-DD' or the date part of a longer ISO string. */
export function longDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** "3 Nov", for dates within the last few months. */
export function shortDate(iso: string): string {
  return longDate(iso).replace(/ \d{4}$/, '')
}

/** "28 Oct 2026, 6:15 PM", from a local 'YYYY-MM-DDTHH:mm:ss'. */
export function longDateTime(localIso: string): string {
  const [hours, minutes] = localIso.slice(11, 16).split(':').map(Number)
  const clock = `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
  return `${longDate(localIso)}, ${clock}`
}

/** "R-00124" */
export function receiptNumber(n: number): string {
  return `R-${String(n).padStart(5, '0')}`
}
