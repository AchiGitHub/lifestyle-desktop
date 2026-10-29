import { Group, Paper, SegmentedControl, Text, Title, useMantineColorScheme } from '@mantine/core'
import { IconSunMoon } from '@tabler/icons-react'
import { useEffect } from 'react'
import type { ColorScheme } from '@shared/api'
import { api } from '../lib/api'

/** Light or dark; the app doesn't follow Windows. */
function useScheme(): [ColorScheme, (scheme: ColorScheme) => void] {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  return [colorScheme === 'dark' ? 'dark' : 'light', setColorScheme]
}

/** Keeps the window's title bar and scrollbars in step with the app's light or dark choice. */
export function useWindowAppearance(): void {
  const [scheme] = useScheme()
  useEffect(() => {
    api.appearance.set(scheme).catch(() => undefined)
  }, [scheme])
}

/** Settings → Appearance: light or dark. Remembered on this computer. */
export function AppearanceCard() {
  const [scheme, setScheme] = useScheme()
  return (
    <Paper p="lg">
      <Group gap="xs" mb="md">
        <IconSunMoon />
        <Title order={4}>Appearance</Title>
      </Group>
      <Text size="sm" mb="md">
        Dark is easier on the eyes in the evening. The choice is kept on this computer.
      </Text>
      <SegmentedControl
        value={scheme}
        onChange={(v) => setScheme(v as ColorScheme)}
        data={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' }
        ]}
      />
    </Paper>
  )
}
