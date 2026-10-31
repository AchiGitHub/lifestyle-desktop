import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// Query functions are wrapped so React Query's context object never gets
// sent over IPC as an argument.
export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: () => api.members.list() })

export const useMembershipTypes = () =>
  useQuery({ queryKey: ['membershipTypes'], queryFn: () => api.membershipTypes.list() })

export const useDurations = () => useQuery({ queryKey: ['durations'], queryFn: () => api.durations.list() })

export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => api.products.list() })

export const useTrainers = () => useQuery({ queryKey: ['trainers'], queryFn: () => api.trainers.list() })

export const usePtPackages = () => useQuery({ queryKey: ['ptPackages'], queryFn: () => api.ptPackages.list() })

export const useClassTypes = () => useQuery({ queryKey: ['classTypes'], queryFn: () => api.classTypes.list() })

export const useClassSeries = () => useQuery({ queryKey: ['classSeries'], queryFn: () => api.classSeries.list() })

export const useBackupStatus = () =>
  useQuery({ queryKey: ['backupStatus'], queryFn: () => api.backup.status(), refetchInterval: 60_000 })
