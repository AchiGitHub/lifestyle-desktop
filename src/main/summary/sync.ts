// Keeping the owner's sheet in Drive up to date. The Drive calls come in
// through SheetStore, so this can be tested without Google.

export interface SheetRef {
  id: string
  url: string
}

export interface SheetStore {
  /** The summary sheet this app made earlier (e.g. on the old PC), if it's still there. */
  find(): Promise<SheetRef | null>
  create(csv: string): Promise<SheetRef>
  /** Replaces the sheet's contents; null if it was deleted or is in the bin. */
  update(id: string, csv: string): Promise<SheetRef | null>
  /** Email addresses it's shared with, lower case. */
  sharedWith(id: string): Promise<string[]>
  share(id: string, email: string): Promise<void>
}

/** What this PC remembers between uploads. */
export interface SheetState {
  fileId?: string
  url?: string
  /** The email it was last shared with, so sharing isn't checked every time. */
  sharedWith?: string
}

/**
 * Rewrites the sheet (making it if it's gone) and shares it with the owner
 * once. `ownerEmail` is '' when it shouldn't be shared.
 */
export async function syncSheet(store: SheetStore, state: SheetState, csv: string, ownerEmail: string): Promise<SheetState> {
  let ref = state.fileId ? await store.update(state.fileId, csv) : null
  if (!ref) {
    const found = await store.find()
    ref = (found && (await store.update(found.id, csv))) || (await store.create(csv))
  }
  // A different file (made again after being deleted) needs sharing again.
  let sharedWith = ref.id === state.fileId ? state.sharedWith : undefined
  if (ownerEmail !== '' && sharedWith !== ownerEmail) {
    if (!(await store.sharedWith(ref.id)).includes(ownerEmail)) await store.share(ref.id, ownerEmail)
    sharedWith = ownerEmail
  }
  return { fileId: ref.id, url: ref.url, sharedWith }
}
