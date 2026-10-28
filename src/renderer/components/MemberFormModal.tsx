import { Button, Group, Modal, Stack } from '@mantine/core'
import { schemaResolver, useForm } from '@mantine/form'
import type { Member } from '@shared/api'
import { memberInput, type MemberInput } from '@shared/schemas'
import { api, useAction } from '../lib/api'
import { emptyMember, MemberFields, memberToInput, MobileMatches } from './MemberFields'

interface Props {
  opened: boolean
  onClose: () => void
  /** Edit this member; add a new one when omitted. */
  member?: Member
  onOpenExisting?: (member: Member) => void
}

function MemberForm({ member, onClose, onOpenExisting }: Omit<Props, 'opened'>) {
  const form = useForm<MemberInput>({
    initialValues: member ? memberToInput(member) : emptyMember(),
    validate: schemaResolver(memberInput, { sync: true })
  })
  const save = useAction(
    (values: MemberInput) => (member ? api.members.update(member.id, values) : api.members.create(values)),
    { success: member ? 'Member updated' : 'Member added' }
  )

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate([values], { onSuccess: onClose }))}>
      <Stack>
        <MemberFields
          form={form}
          afterMobile={
            <MobileMatches
              mobile={String(form.values.mobileNumber ?? '')}
              excludeId={member?.id}
              actionLabel="Open"
              onAction={(m) => {
                onClose()
                onOpenExisting?.(m)
              }}
            />
          }
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {member ? 'Save changes' : 'Add member'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function MemberFormModal({ opened, onClose, member, onOpenExisting }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title={member ? 'Edit member' : 'Add member'} size="lg">
      <MemberForm member={member} onClose={onClose} onOpenExisting={onOpenExisting} />
    </Modal>
  )
}
