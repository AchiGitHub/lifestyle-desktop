import { Box, Group, Paper, Text, Title } from '@mantine/core'
import dayjs from 'dayjs'
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type XAxisTickContentProps
} from 'recharts'
import type { MonthFigures } from '@shared/api'

/** Series colours: the brand blue, then the logo's orange (the pair stays apart for colour-blind readers). */
export const SERIES_COLORS = ['var(--mantine-color-brand-6)', 'var(--mantine-color-flame-7)'] as const

const MUTED = 'var(--mantine-color-dimmed)'
// From global.css, so the lines don't glare in dark mode.
const GRID = 'var(--app-chart-grid)'
const AXIS = 'var(--app-chart-axis)'
const SURFACE = 'var(--mantine-color-body)'
/** The month in progress is drawn lighter and labelled "so far". */
const PARTIAL_OPACITY = 0.4
const HEIGHT = 210

export const monthName = (m: Pick<MonthFigures, 'month' | 'partial'>): string =>
  dayjs(`${m.month}-01`).format('MMMM YYYY') + (m.partial ? ', so far' : '')

/** A card with a title, then one line under it: a subtitle, or the legend for a chart with two series. */
export function ChartCard({
  title,
  subtitle,
  legend,
  children
}: {
  title: string
  subtitle?: ReactNode
  legend?: { color: string; label: string }[]
  children: ReactNode
}) {
  return (
    <Paper p="md">
      <Title order={4}>{title}</Title>
      {legend ? (
        <Group gap="md">
          {legend.map((item) => (
            <Group key={item.label} gap={6} wrap="nowrap">
              <Box w={10} h={10} style={{ borderRadius: 2, background: item.color }} />
              <Text size="sm" c="dimmed">
                {item.label}
              </Text>
            </Group>
          ))}
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          {subtitle}
        </Text>
      )}
      <Box mt="sm">{children}</Box>
    </Paper>
  )
}

/** Axis steps from 0 to a round number at or above `max`: 0, 50, 100, 150 for 137. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const rough = max / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= rough && Number.isInteger(s)) ?? 1
  const steps = Math.ceil(max / step)
  return Array.from({ length: steps + 1 }, (_, i) => i * step)
}

/** Month under each column; the year under the first month and each January. */
function monthTick(months: MonthFigures[]) {
  return function MonthTick({ x: rawX, y, payload }: XAxisTickContentProps) {
    const x = Number(rawX)
    const month = String(payload.value)
    const m = months.find((item) => item.month === month)
    const d = dayjs(`${month}-01`)
    const second = m?.partial ? 'so far' : d.month() === 0 || month === months[0]?.month ? d.format('YYYY') : null
    return (
      <text x={x} y={Number(y) + 4} textAnchor="middle" fontSize={11} fill={MUTED}>
        <tspan x={x} dy="0.71em">
          {d.format('MMM')}
        </tspan>
        {second && (
          <tspan x={x} dy={13}>
            {second}
          </tspan>
        )}
      </text>
    )
  }
}

function tooltip<T extends MonthFigures>(render: (m: T) => ReactNode) {
  return function MonthTooltip({ active, payload }: TooltipContentProps) {
    const m = payload?.[0]?.payload as T | undefined
    if (!active || !m) return null
    return (
      <Paper px="sm" py={6} shadow="md">
        <Text size="xs" c="dimmed" mb={2}>
          {monthName(m)}
        </Text>
        {render(m)}
      </Paper>
    )
  }
}

/** A value written above the last month's mark only. */
function lastLabel(index: number, text: string) {
  return function LastLabel(p: { index?: number; x?: number | string; y?: number | string; width?: number | string }) {
    if (p.index !== index) return null
    return (
      <text
        x={Number(p.x) + Number(p.width ?? 0) / 2}
        y={Number(p.y) - 8}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill="var(--mantine-color-text)"
      >
        {text}
      </text>
    )
  }
}

const axes = (months: MonthFigures[], axisFormat: (v: number) => string, ticks: number[]) => [
  <CartesianGrid key="grid" vertical={false} stroke={GRID} />,
  <XAxis
    key="x"
    dataKey="month"
    interval={0}
    tickLine={false}
    axisLine={{ stroke: AXIS }}
    height={34}
    tick={monthTick(months)}
    padding={{ left: 0, right: 0 }}
  />,
  <YAxis
    key="y"
    width={44}
    tickLine={false}
    axisLine={false}
    tick={{ fontSize: 11, fill: MUTED }}
    tickFormatter={axisFormat}
    ticks={ticks}
    domain={[0, ticks[ticks.length - 1]]}
    interval={0}
  />
]

/** The value of `key` in a month, treating a gap as nothing. */
const valueOf = <T,>(m: T, key: keyof T) => Number(m[key] ?? 0)

/** Columns per month, stacked when there's more than one series. A null value leaves the month empty. */
export function MonthColumns<T extends MonthFigures>({
  months,
  series,
  label,
  axisFormat,
  ticks,
  details
}: {
  months: T[]
  series: { key: keyof T & string; color: string }[]
  /** Written above the last month's column. */
  label: string
  axisFormat: (v: number) => string
  /** Fixed axis steps, e.g. 0–100 for a percentage. */
  ticks?: number[]
  details: (m: T) => ReactNode
}) {
  const top = series.length - 1
  const stacked = series.length > 1
  const highest = Math.max(...months.map((m) => series.reduce((sum, s) => sum + valueOf(m, s.key), 0)))
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <BarChart data={months} margin={{ top: 22, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
        {axes(months, axisFormat, ticks ?? niceTicks(highest))}
        <Tooltip cursor={{ fill: 'var(--app-chart-cursor)' }} content={tooltip(details)} isAnimationActive={false} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key as string}
            stackId="month"
            fill={s.color}
            maxBarSize={24}
            radius={i === top ? [4, 4, 0, 0] : 0}
            // A thin line in the card's colour keeps stacked parts apart.
            stroke={stacked ? SURFACE : undefined}
            strokeWidth={stacked ? 1 : 0}
            isAnimationActive={false}
          >
            {months.map((m) => (
              <Cell key={m.month} fillOpacity={m.partial ? PARTIAL_OPACITY : 1} />
            ))}
            {i === top && <LabelList dataKey={s.key} content={lastLabel(months.length - 1, label)} />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** A line with a light wash under it, for a count taken at each month's end. */
export function MonthLine<T extends MonthFigures>({
  months,
  dataKey,
  color,
  label,
  axisFormat,
  details
}: {
  months: T[]
  dataKey: keyof T & string
  color: string
  /** Written above the last point. */
  label: string
  axisFormat: (v: number) => string
  details: (m: T) => ReactNode
}) {
  const last = months.length - 1
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <AreaChart data={months} margin={{ top: 22, right: 14, bottom: 0, left: 0 }}>
        {axes(months, axisFormat, niceTicks(Math.max(...months.map((m) => valueOf(m, dataKey)))))}
        <Tooltip cursor={{ stroke: AXIS }} content={tooltip(details)} isAnimationActive={false} />
        <Area
          type="linear"
          dataKey={dataKey as string}
          stroke={color}
          strokeWidth={2}
          fill={color}
          fillOpacity={0.1}
          dot={(p: { index: number; cx?: number; cy?: number }) =>
            p.index === last ? (
              <circle key="end" cx={p.cx} cy={p.cy} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
            ) : (
              <g key={p.index} />
            )
          }
          activeDot={{ r: 5, fill: color, stroke: SURFACE, strokeWidth: 2 }}
          isAnimationActive={false}
        >
          <LabelList dataKey={dataKey} content={lastLabel(last, label)} />
        </Area>
      </AreaChart>
    </ResponsiveContainer>
  )
}
