import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { parseIsoDate, todayIso } from '@shared/dates'

dayjs.extend(relativeTime)

export function lkr(value: number | null | undefined): string {
  return `Rs. ${(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/** Heights and weights: some old records carry float noise (509.99999999999994). */
export function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

/** Short form for chart axes: 1.2M, 750K. */
export function compactNumber(value: number): string {
  return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dayjs(iso.slice(0, 10)).format('D MMM YYYY') : '—'
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dayjs(iso).format('D MMM YYYY, h:mm A') : 'No date'
}

export function fromNow(isoInstant: string): string {
  return dayjs(isoInstant).fromNow()
}

export function fullName(m: { firstName: string; lastName: string }): string {
  return `${m.firstName} ${m.lastName}`.trim()
}

export function daysFromToday(iso: string): number {
  return Math.round((parseIsoDate(iso).getTime() - parseIsoDate(todayIso()).getTime()) / 86_400_000)
}

/** "in 3 days", "today", "5 days ago". */
export function relativeDays(iso: string): string {
  const d = daysFromToday(iso)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  return d > 0 ? `in ${d} days` : `${-d} days ago`
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
