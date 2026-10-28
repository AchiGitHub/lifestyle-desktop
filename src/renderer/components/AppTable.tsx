import { Paper } from '@mantine/core'
import { DataTable, type DataTableColumn, type DataTableSortStatus } from 'mantine-datatable'
import { useEffect, useMemo, useState } from 'react'

type Sortable = string | number | boolean | null | undefined

export interface AppTableProps<T> {
  records: T[]
  columns: DataTableColumn<T>[]
  fetching?: boolean
  /** Default sort; columns marked `sortable` can be re-sorted by clicking. */
  sort?: DataTableSortStatus<T>
  /** How to sort columns whose display isn't a plain field. */
  sortValues?: Record<string, (record: T) => Sortable>
  selected?: T[]
  onSelectedChange?: (records: T[]) => void
  pageSize?: number
  emptyText?: string
}

function compare(a: Sortable, b: Sortable): number {
  if (a == null || a === '') return b == null || b === '' ? 0 : 1
  if (b == null || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Client-side sorted, paginated table: the data sets here are a few thousand rows at most. */
export function AppTable<T extends { id: string }>({
  records,
  columns,
  fetching,
  sort,
  sortValues,
  selected,
  onSelectedChange,
  pageSize = 25,
  emptyText = 'Nothing to show'
}: AppTableProps<T>) {
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<T>>(
    sort ?? { columnAccessor: '', direction: 'asc' }
  )
  const [page, setPage] = useState(1)

  const sorted = useMemo(() => {
    const key = String(sortStatus.columnAccessor)
    if (!key) return records
    const value = sortValues?.[key] ?? ((r: T) => (r as Record<string, Sortable>)[key])
    const dir = sortStatus.direction === 'asc' ? 1 : -1
    return [...records].sort((a, b) => dir * compare(value(a), value(b)))
  }, [records, sortStatus, sortValues])

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(records.length / pageSize))
    if (page > lastPage) setPage(lastPage)
  }, [records.length, pageSize, page])

  const onePage = records.length <= pageSize

  return (
    <Paper p={0} style={{ overflow: 'hidden' }}>
      <DataTable<T>
        records={sorted.slice((page - 1) * pageSize, page * pageSize)}
        columns={columns}
        fetching={fetching}
        minHeight={records.length === 0 ? 180 : undefined}
        noRecordsText={emptyText}
        highlightOnHover
        verticalSpacing="sm"
        sortStatus={sortStatus}
        onSortStatusChange={setSortStatus}
        selectedRecords={onSelectedChange ? selected : undefined}
        onSelectedRecordsChange={onSelectedChange}
        totalRecords={records.length}
        recordsPerPage={pageSize}
        page={page}
        onPageChange={setPage}
        paginationText={({ from, to, totalRecords }) => `${from}–${to} of ${totalRecords.toLocaleString()}`}
        styles={onePage ? { pagination: { display: 'none' } } : undefined}
      />
    </Paper>
  )
}
