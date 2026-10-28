import { Button, PasswordInput, Stack, Title } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { AuthScreen } from './AuthScreen'

export function Login() {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (await api.auth.login(password)) {
        await queryClient.invalidateQueries()
      } else {
        setError('That password is wrong.')
        setPassword('')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthScreen>
      <form onSubmit={submit}>
        <Stack>
          <Title order={3}>Sign in</Title>
          <PasswordInput
            label="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value)
              setError(null)
            }}
            error={error}
            autoFocus
          />
          <Button type="submit" loading={busy} disabled={!password}>
            Sign in
          </Button>
        </Stack>
      </form>
    </AuthScreen>
  )
}
