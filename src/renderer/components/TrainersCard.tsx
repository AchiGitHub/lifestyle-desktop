import { ActionIcon, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { schemaResolver, useForm } from '@mantine/form'
import { modals } from '@mantine/modals'
import { IconArchive, IconArchiveOff, IconEdit, IconPlus, IconTrash, IconUserStar } from '@tabler/icons-react'
import { useState } from 'react'
import type { Trainer } from '@shared/api'
import { trainerInput, type TrainerInput } from '@shared/schemas'
import { api, useAction } from '../lib/api'
import { useTrainers } from '../lib/queries'

function TrainerForm({ trainer, onClose }: { trainer?: Trainer; onClose: () => void }) {
  const form = useForm<TrainerInput>({
    initialValues: trainer
      ? { name: trainer.name, isOwner: trainer.isOwner, commissionPercent: trainer.commissionPercent }
      : { name: '', isOwner: false, commissionPercent: 0 },
    validate: schemaResolver(trainerInput, { sync: true })
  })
  const save = useAction(
    (v: TrainerInput) => (trainer ? api.trainers.update(trainer.id, v) : api.trainers.create(v)),
    { success: trainer ? 'Trainer updated' : 'Trainer added' }
  )
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate([v], { onSuccess: onClose }))}>
      <Stack>
        <TextInput label="Name" withAsterisk data-autofocus {...form.getInputProps('name')} />
        <Checkbox
          label="This is the owner"
          description="The owner gets no commission."
          {...form.getInputProps('isOwner', { type: 'checkbox' })}
        />
        {!form.values.isOwner && (
          <NumberInput
            label="Commission"
            description="Their share of each package they sell. It fills in the commission on a new package, and can be changed there."
            suffix="%"
            min={0}
            max={100}
            {...form.getInputProps('commissionPercent')}
          />
        )}
        {trainer && trainer.packageCount > 0 && (
          <Text size="xs" c="dimmed">
            A new % only applies to packages sold from now on.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {trainer ? 'Save changes' : 'Add trainer'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

/** Settings → Personal trainers: who gives personal training, and their commission. */
export function TrainersCard() {
  const { data: trainers = [] } = useTrainers()
  const [editing, setEditing] = useState<{ trainer?: Trainer } | null>(null)
  const archive = useAction((id: string, archived: boolean) => api.trainers.setArchived(id, archived))
  const remove = useAction((id: string) => api.trainers.delete(id), { success: 'Trainer deleted' })
  return (
    <Paper p="lg">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconUserStar />
          <Title order={4}>Personal trainers</Title>
        </Group>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing({})}>
          Add trainer
        </Button>
      </Group>
      <Text size="sm" mb="md">
        Who gives personal training. A trainer’s commission is worked out from their % when a package is sold, and can be
        changed for that package. Packages and session types are on the <b>Personal training</b> page.
      </Text>
      {trainers.length === 0 ? (
        <Text size="sm" c="dimmed">
          No trainers yet. Add the owner and each trainer.
        </Text>
      ) : (
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Commission</Table.Th>
              <Table.Th ta="right">Packages</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {trainers.map((t) => (
              <Table.Tr key={t.id} c={t.archived ? 'dimmed' : undefined}>
                <Table.Td>
                  {t.name}{' '}
                  {t.archived && (
                    <Badge size="xs" variant="light" color="gray">
                      Archived
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{t.isOwner ? <Badge variant="light">Owner · none</Badge> : `${t.commissionPercent}%`}</Table.Td>
                <Table.Td ta="right">{t.packageCount}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon variant="subtle" color="gray" aria-label="Edit" onClick={() => setEditing({ trainer: t })}>
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={t.archived ? 'Restore' : 'Archive'}
                      title={t.archived ? 'Restore' : 'Archive: hide from new packages'}
                      onClick={() => archive.mutate([t.id, !t.archived])}
                    >
                      {t.archived ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Delete"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: `Delete ${t.name}?`,
                          children: <Text size="sm">Only a trainer with no packages can be deleted; otherwise archive them.</Text>,
                          labels: { confirm: 'Delete', cancel: 'Cancel' },
                          confirmProps: { color: 'red' },
                          onConfirm: () => remove.mutate([t.id])
                        })
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.trainer ? 'Edit trainer' : 'Add trainer'}>
        {editing && <TrainerForm trainer={editing.trainer} onClose={() => setEditing(null)} />}
      </Modal>
    </Paper>
  )
}
