import { Button, Group } from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import type { Registration } from '@shared/api'
import { WhatsAppButton } from '../components/WhatsAppButton'
import { api, useAction } from '../lib/api'

export function useDismiss() {
  const dismiss = useAction((ids: string[]) => api.registrations.dismiss(ids), {
    success: 'Dismissed. Turn on “Show dismissed” to see it again.'
  })
  const undismiss = useAction((ids: string[]) => api.registrations.undismiss(ids), { success: 'Restored to the list' })
  return { dismiss, undismiss }
}

/** Message, renew, or hide from the follow-up lists without deleting anything. */
export function FollowUpActions({ registration: r }: { registration: Registration }) {
  const navigate = useNavigate()
  const { dismiss, undismiss } = useDismiss()
  return (
    <Group gap="xs" justify="flex-end" wrap="nowrap">
      {!r.renewed && !r.dismissedAt && <WhatsAppButton registration={r} />}
      {!r.renewed && (
        <Button size="xs" variant="light" onClick={() => navigate(`/registrations/new?renew=${r.id}`)}>
          Renew
        </Button>
      )}
      {r.dismissedAt ? (
        <Button size="xs" variant="subtle" color="gray" onClick={() => undismiss.mutate([[r.id]])}>
          Undo dismiss
        </Button>
      ) : (
        !r.renewed && (
          <Button size="xs" variant="subtle" color="gray" onClick={() => dismiss.mutate([[r.id]])}>
            Dismiss
          </Button>
        )
      )}
    </Group>
  )
}
