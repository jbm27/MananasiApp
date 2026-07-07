import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAppState, saveAppState } from '../api/client.js'

export function useBackendSync() {
  const [ready, setReady] = useState(false)
  const [initialData, setInitialData] = useState(null)
  /** 'loaded' | 'empty' when ready; 'error' when the initial fetch failed */
  const [loadStatus, setLoadStatus] = useState('loading')
  const [syncError, setSyncError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)
  const latestServerUpdatedAtRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    fetchAppState()
      .then((data) => {
        if (cancelled) {
          return
        }
        latestServerUpdatedAtRef.current = data?._meta?.updatedAt ?? null
        setInitialData(data)
        setLoadStatus(data == null ? 'empty' : 'loaded')
        setReady(true)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setSyncError(error.message)
        setLoadStatus('error')
        setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback((snapshot) => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSyncing(true)
      try {
        const response = await saveAppState({
          ...snapshot,
          _meta: {
            expectedUpdatedAt: latestServerUpdatedAtRef.current,
          },
        })
        latestServerUpdatedAtRef.current = response?.updatedAt ?? latestServerUpdatedAtRef.current
        setLastSavedAt(new Date())
        setSyncError('')
      } catch (error) {
        if (String(error?.message ?? '').includes('STATE_VERSION_CONFLICT')) {
          setSyncError('Another session changed data. Please refresh this page before saving again.')
        } else {
        setSyncError(error.message)
        }
      } finally {
        setSyncing(false)
      }
    }, 900)
  }, [])

  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current)
  }, [])

  return {
    ready,
    initialData,
    loadStatus,
    persist,
    syncError,
    syncing,
    lastSavedAt,
  }
}
