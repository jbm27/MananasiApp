/**
 * Remove all RECOVERY rows from batch 1783589369514 and tombstone them permanently.
 * Use when duplicate recovery rows cause doubled kg / NaN wages on harvesting tab.
 */
const API_BASE = 'https://mananasiappproduction.up.railway.app'
const BATCH_MARKER = '1783589369514'

async function fetchState() {
  const response = await fetch(`${API_BASE}/api/state`)
  if (!response.ok) {
    throw new Error(`Failed to fetch state (${response.status})`)
  }
  return response.json()
}

async function putState(state) {
  const response = await fetch(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to save state (${response.status}): ${text}`)
  }
}

async function saveWithRetry(buildPayload) {
  let state = await fetchState()
  let payload = buildPayload(state)
  try {
    await putState(payload)
    return
  } catch (error) {
    if (!String(error.message).includes('(409)')) {
      throw error
    }
  }
  state = await fetchState()
  payload = buildPayload(state)
  await putState(payload)
}

async function main() {
  const initial = await fetchState()
  const records = Array.isArray(initial.records) ? initial.records : []
  const batchIds = records
    .filter((record) => String(record.id ?? '').includes(BATCH_MARKER))
    .map((record) => String(record.id))

  if (batchIds.length === 0) {
    console.log('No recovery batch rows found in live records.')
    return
  }

  await saveWithRetry((state) => {
    const currentRecords = Array.isArray(state.records) ? state.records : []
    const deletedEntityIds =
      state.deletedEntityIds && typeof state.deletedEntityIds === 'object'
        ? { ...state.deletedEntityIds }
        : {}
    const deletedRecordIds = new Set(
      Array.isArray(deletedEntityIds.records) ? deletedEntityIds.records.map(String) : [],
    )
    batchIds.forEach((id) => deletedRecordIds.add(id))
    deletedEntityIds.records = Array.from(deletedRecordIds)

    return {
      records: currentRecords.filter((record) => !batchIds.includes(String(record.id ?? ''))),
      deletedEntityIds,
      _meta: {
        ...(state._meta ?? {}),
        expectedUpdatedAt: state?._meta?.updatedAt ?? null,
        changeSource: 'purge-recovery-batch',
      },
    }
  })

  const verify = await fetchState()
  const remaining = (verify.records ?? []).filter((record) =>
    String(record.id ?? '').includes(BATCH_MARKER),
  )
  const tombstoned = (verify.deletedEntityIds?.records ?? []).filter((id) =>
    String(id).includes(BATCH_MARKER),
  )
  const july8 = (verify.records ?? []).filter((record) => record.harvestedOn === '2026-07-08')
  const july8Kg = july8.reduce((sum, record) => sum + Number(record.leafMassKg ?? record.kg ?? 0), 0)

  console.log(
    JSON.stringify(
      {
        removedBatchIds: batchIds.length,
        remainingBatchRows: remaining.length,
        tombstonedBatchIds: tombstoned.length,
        july8: { records: july8.length, kg: july8Kg },
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
