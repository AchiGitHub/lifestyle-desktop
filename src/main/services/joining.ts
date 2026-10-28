import { sql } from 'drizzle-orm'
import type { JoiningFeeSettings } from '../../shared/api'
import { DEFAULT_BREAK_DAYS } from '../../shared/joining'
import { joiningFeeSettingsInput, type JoiningFeeSettingsInput } from '../../shared/schemas'
import type { Db, Executor } from '../db/client'
import { putSetting, readSettings } from './settings'

const BREAK_DAYS_KEY = 'joiningFee.breakDays'

export function joiningFeeSettings(db: Executor): JoiningFeeSettings {
  const saved = readSettings(db, [BREAK_DAYS_KEY]).get(BREAK_DAYS_KEY)
  return { breakDays: saved === undefined ? DEFAULT_BREAK_DAYS : Number(saved) }
}

export function saveJoiningFeeSettings(db: Db, raw: JoiningFeeSettingsInput): void {
  const { breakDays } = joiningFeeSettingsInput.parse(raw)
  putSetting(db, BREAK_DAYS_KEY, breakDays === DEFAULT_BREAK_DAYS ? null : String(breakDays))
}

/** End date of the member's latest registration, or null if they have never registered. */
export function lastEndDate(db: Executor, memberId: string): string | null {
  return (
    db.get<{ endDate: string | null }>(sql`
      select max(r.end_date) as endDate from registration_members rm
      join registrations r on r.id = rm.registration_id
      where rm.member_id = ${memberId}`)?.endDate ?? null
  )
}
