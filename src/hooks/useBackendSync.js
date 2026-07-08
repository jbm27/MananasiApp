import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAppState, saveAppState } from '../api/client.js'
import { mergeIncomingAppState } from '../stateMerge.js'

function isVersionConflict(error) {
  return Boolean(error?.conflict || String(error?.message ?? '').includes('STATE_VERSION_CONFLICT'))
}

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
  const persistGenerationRef = useRef(0)
  const inFlightRef = useRef(false)
  const pendingSnapshotRef = useRef(null)

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

  const pushSnapshot = useCallback(async (snapshot) => {
    const response = await saveAppState({
      ...snapshot,
      _meta: {
        expectedUpdatedAt: latestServerUpdatedAtRef.current,
      },
    })
    latestServerUpdatedAtRef.current = response?.updatedAt ?? latestServerUpdatedAtRef.current
    return response
  }, [])

  const flushPersist = useCallback(async () => {
    if (inFlightRef.current) {
      return
    }
    const snapshot = pendingSnapshotRef.current
    if (!snapshot) {
      return
    }
    pendingSnapshotRef.current = null
    const generation = persistGenerationRef.current
    inFlightRef.current = true
    setSyncing(true)
    try {
      try {
        await pushSnapshot(snapshot)
        if (generation === persistGenerationRef.current) {
          setLastSavedAt(new Date())
          setSyncError('')
        }
      } catch (error) {
        if (!isVersionConflict(error)) {
          throw error
        }

        // Another session changed app_state. Refetch, union-merge our pending
        // local changes, and retry once so invoices/harvests are not dropped.
        const latest = await fetchAppState()
        latestServerUpdatedAtRef.current = latest?._meta?.updatedAt ?? null
        const { _meta: _ignoredMeta, ...latestBusiness } = latest ?? {}
        const reconciled = mergeIncomingAppState(latestBusiness, snapshot)
        await pushSnapshot(reconciled)
        if (generation === persistGenerationRef.current) {
          setLastSavedAt(new Date())
          setSyncError('')
        }
      }
    } catch (error) {
      if (isVersionConflict(error)) {
        setSyncError(
          'Could not save because another session changed data. Your entries are kept locally — refresh after confirming they appear, or try again.',
        )
      } else {
        setSyncError(error.message)
      }
    } finally {
      inFlightRef.current = false
      setSyncing(false)
      if (pendingSnapshotRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          flushPersist()
        }, 250)
      }
    }
  }, [pushSnapshot])

  const persist = useCallback(
    (snapshot) => {
      persistGenerationRef.current += 1
      pendingSnapshotRef.current = snapshot
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        flushPersist()
      }, 900)
    },
    [flushPersist],
  )

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
