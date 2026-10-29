import { notifications } from '@mantine/notifications'
import type { StoreChange } from '@shared/api'
import { SALE_METHOD_LABELS } from '@shared/enums'
import { lkr } from '../lib/format'

export function storeChangeText(c: StoreChange): string {
  switch (c.kind) {
    case 'SALE':
    case 'UNDO': {
      const to = c.memberName ? ` to ${c.memberName}` : ''
      return c.kind === 'SALE'
        ? `${c.by} sold ${c.quantity} × ${c.productName}${to} · ${lkr(c.amount)} ${SALE_METHOD_LABELS[c.paymentType].toLowerCase()}`
        : `${c.by} undid a sale: ${c.quantity} × ${c.productName}${to} · ${lkr(c.amount)}`
    }
    case 'RECEIVED':
      return `${c.by} added ${c.change} ${c.productName} to stock · ${c.quantityAfter} in stock`
    case 'COUNT': {
      const diff = c.change === 0 ? '' : ` (${Math.abs(c.change)} ${c.change < 0 ? 'fewer' : 'more'} than recorded)`
      return `${c.by} counted ${c.productName}: ${c.quantityAfter} in stock${diff}`
    }
  }
}

/** A short notice at the desk when an instructor sells something or changes stock on their phone. */
export function showStoreNotice(c: StoreChange): void {
  notifications.show({
    color: c.kind === 'COUNT' && c.change < 0 ? 'orange' : c.kind === 'UNDO' ? 'gray' : 'teal',
    autoClose: 6000,
    message: storeChangeText(c)
  })
}
