import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'

export const api = window.api

export function notifyError(error: unknown, title = 'That didn’t work'): void {
  notifications.show({ color: 'red', title, message: (error as Error).message, autoClose: 7000 })
}

export function notifySuccess(message: string): void {
  notifications.show({ color: 'teal', message, autoClose: 2500 })
}

/**
 * Wraps a write: shows the outcome and refreshes every list (the data set
 * is small, so refetching everything keeps screens consistent for free).
 */
export function useAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: { success?: string | ((result: R) => string); errorTitle?: string } = {}
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: (result) => {
      void queryClient.invalidateQueries()
      const { success } = options
      if (success) notifySuccess(typeof success === 'function' ? success(result) : success)
    },
    onError: (error) => notifyError(error, options.errorTitle)
  })
}
