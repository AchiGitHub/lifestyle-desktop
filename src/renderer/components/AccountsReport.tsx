import { Button, Group, List, Modal, Radio, Stack, Text } from '@mantine/core'
import { DatePickerInput, type DatesRangeValue } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { addDays, monthRange, shiftMonth, taxYear, todayIso } from '@shared/dates'
import { api, notifyError } from '../lib/api'
import { formatDate } from '../lib/format'

type Preset = 'thisMonth' | 'lastMonth' | 'thisTaxYear' | 'lastTaxYear' | 'other'
type Range = { from: string; to: string }

function presets(): Record<Exclude<Preset, 'other'>, { label: string; range: Range }> {
  const today = todayIso()
  const thisYear = taxYear(today)
  return {
    thisMonth: { label: 'This month', range: monthRange(today) },
    lastMonth: { label: 'Last month', range: monthRange(`${shiftMonth(today.slice(0, 7), -1)}-01`) },
    thisTaxYear: { label: 'This tax year', range: thisYear },
    lastTaxYear: { label: 'Last tax year', range: taxYear(addDays(thisYear.from, -1)) }
  }
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

function ReportForm({ onClose }: { onClose: () => void }) {
  const choices = presets()
  const [preset, setPreset] = useState<Preset>('lastTaxYear')
  const [other, setOther] = useState<DatesRangeValue<string>>([null, null])
  const range: Range | null =
    preset === 'other' ? (other[0] && other[1] ? { from: other[0], to: other[1] } : null) : choices[preset].range
  const save = useMutation({
    mutationFn: (r: Range) => api.reports.accounts(r),
    onSuccess: (path) => {
      if (!path) return // they cancelled the save dialog
      onClose()
      notifications.show({
        color: 'teal',
        autoClose: 12_000,
        title: 'Report saved',
        message: (
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm">{fileName(path)}</Text>
            <Button size="compact-xs" variant="light" onClick={() => void api.reports.showSaved()}>
              Show in folder
            </Button>
          </Group>
        )
      })
    },
    onError: (e) => notifyError(e, 'The report wasn’t saved')
  })

  return (
    <Stack>
      <Text size="sm">
        An Excel file of the gym’s accounts for a period. Income is the money received in the period; what was sold and what
        was still owed are listed separately.
      </Text>
      <Radio.Group value={preset} onChange={(v) => setPreset(v as Preset)} label="Period">
        <Stack gap="xs" mt="xs">
          {Object.entries(choices).map(([key, c]) => (
            <Radio
              key={key}
              value={key}
              label={c.label}
              description={`${formatDate(c.range.from)} to ${formatDate(c.range.to)}`}
            />
          ))}
          <Radio value="other" label="Other dates" />
        </Stack>
      </Radio.Group>
      {preset === 'other' && (
        <DatePickerInput
          type="range"
          label="From and to"
          placeholder="Pick the first and last day"
          valueFormat="D MMM YYYY"
          value={other}
          onChange={setOther}
        />
      )}
      <div>
        <Text size="sm" fw={600}>
          It has
        </Text>
        <List size="sm" spacing={2} c="dimmed">
          <List.Item>A summary: income by type and payment method, receipts, what was owed at the end</List.Item>
          <List.Item>Takings per month and per day, and every payment with its receipt number</List.Item>
          <List.Item>Store sales with cost of goods, and stock at the end of the period</List.Item>
          <List.Item>Memberships and personal training sold, and trainer commission</List.Item>
        </List>
        <Text size="xs" c="dimmed" mt={4}>
          Members are listed by name only: no phone numbers or NICs.
        </Text>
      </div>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button
          leftSection={<IconFileSpreadsheet size={16} />}
          disabled={!range}
          loading={save.isPending}
          onClick={() => range && save.mutate(range)}
        >
          Save Excel file
        </Button>
      </Group>
    </Stack>
  )
}

/** Payments → Accounts report: an Excel workbook for a period. */
export function AccountsReportButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} onClick={() => setOpen(true)}>
        Accounts report
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Accounts report">
        {open && <ReportForm onClose={() => setOpen(false)} />}
      </Modal>
    </>
  )
}
