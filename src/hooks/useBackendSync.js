import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAppState, saveAppState } from '../api/client.js'

export function useBackendSync() {
  const [ready, setReady] = useState(false)
  const [initialData, setInitialData] = useState(null)
  const [syncError, setSyncError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    fetchAppState()
      .then((data) => {
        if (cancelled) {
          return
        }
        setInitialData(data)
        setReady(true)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setSyncError(error.message)
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
        await saveAppState(snapshot)
        setLastSavedAt(new Date())
        setSyncError('')
      } catch (error) {
        setSyncError(error.message)
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
    persist,
    syncError,
    syncing,
    lastSavedAt,
  }
}
