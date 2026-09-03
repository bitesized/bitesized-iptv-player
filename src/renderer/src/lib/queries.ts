import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AddM3uProviderInput, AddXtreamProviderInput } from '@shared/contracts'
import type { SyncProgress } from '@shared/types'
import { api, invoke } from './api'

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => invoke('providers:list', undefined)
  })
}

export function useAddXtreamProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddXtreamProviderInput) => invoke('providers:addXtream', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['providers'] })
  })
}

export function useAddM3uProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddM3uProviderInput) => invoke('providers:addM3u', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['providers'] })
  })
}

export function useDeleteProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (providerId: number) => invoke('providers:delete', { providerId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['providers'] })
  })
}

export function useSyncProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (providerId: number) => invoke('providers:sync', { providerId }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['providers'] })
  })
}

/**
 * Subscribe to sync progress pushes. Also invalidates provider/catalog queries
 * when a sync finishes so lists refresh automatically.
 */
export function useSyncProgress(onProgress: (progress: SyncProgress) => void): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    return api.on('sync:progress', (progress) => {
      onProgress(progress)
      if (progress.stage === 'done' || progress.stage === 'error') {
        void queryClient.invalidateQueries({ queryKey: ['providers'] })
        void queryClient.invalidateQueries({ queryKey: ['catalog'] })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
