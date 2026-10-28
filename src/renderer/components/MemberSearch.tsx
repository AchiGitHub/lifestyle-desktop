import { Select, type ComboboxItem, type OptionsFilter } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { fullName } from '../lib/format'
import { useMembers } from '../lib/queries'
import { useMemberDrawer } from './MemberDrawer'

const digits = (s: string): string => s.replace(/\D/g, '')

/** Find a member by name, phone or NIC; opens their details unless `onPick` says otherwise. */
export function MemberSearch({
  placeholder = 'Find a member by name, phone or NIC',
  width = 420,
  onPick
}: {
  placeholder?: string
  width?: number
  onPick?: (memberId: string) => void
}) {
  const { data: members = [] } = useMembers()
  const { openMember } = useMemberDrawer()
  const [value, setValue] = useState<string | null>(null)

  const { options, haystack } = useMemo(() => {
    const haystack = new Map<string, { text: string; phone: string }>()
    const options: ComboboxItem[] = members.map((m) => {
      haystack.set(m.id, {
        text: `${fullName(m)} ${m.nic ?? ''}`.toLowerCase(),
        phone: digits(`${m.mobileNumber ?? ''} ${m.secondaryNumber ?? ''}`)
      })
      return { value: m.id, label: `${fullName(m)}${m.mobileNumber ? ` · ${m.mobileNumber}` : ''}` }
    })
    return { options, haystack }
  }, [members])

  const filter: OptionsFilter = ({ options: all, search, limit }) => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const words = q.split(/\s+/)
    const qDigits = digits(q)
    const out: ComboboxItem[] = []
    for (const option of all as ComboboxItem[]) {
      const h = haystack.get(option.value)
      if (!h) continue
      const byText = words.every((w) => h.text.includes(w))
      const byPhone = qDigits.length >= 3 && h.phone.includes(qDigits.replace(/^0/, ''))
      if (byText || byPhone) out.push(option)
      if (out.length >= limit) break
    }
    return out
  }

  return (
    <Select
      w={width}
      placeholder={placeholder}
      leftSection={<IconSearch size={16} />}
      data={options}
      value={value}
      searchable
      clearable={false}
      filter={filter}
      limit={12}
      nothingFoundMessage="No member found"
      onChange={(id) => {
        if (id) (onPick ?? openMember)(id)
        setValue(null)
      }}
      comboboxProps={{ shadow: 'md' }}
      rightSection={<span />}
    />
  )
}
