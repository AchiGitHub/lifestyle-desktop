import { Center, Image, Paper, Stack } from '@mantine/core'
import type { ReactNode } from 'react'
import logo from '../assets/logo.jpeg'

export function AuthScreen({ children, width = 400 }: { children: ReactNode; width?: number }) {
  return (
    <Center mih="100%" p="xl" bg="brand.9">
      <Stack w={width} gap="lg">
        <Image src={logo} radius="md" alt="Lifestyle Fitness Studio" />
        <Paper p="xl" shadow="xl" withBorder={false}>
          {children}
        </Paper>
      </Stack>
    </Center>
  )
}
