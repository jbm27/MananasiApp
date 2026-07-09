const API_BASE = 'https://mananasiappproduction.up.railway.app'

function keyFor(record) {
  return `${record.harvestedOn}|${record.harvesterId}`
}

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

async function main() {
  let state = await fetchState()
  const records = Array.isArray(state.records) ? state.records : []
  const nonRecoveryKeys = new Set(
    records.filter((record) => !String(record.id ?? '').startsWith('RECOVERY-')).map(keyFor),
  )
  const duplicateRecoveryIds = records
    .filter(
      (record) =>
        String(record.id ?? '').startsWith('RECOVERY-') && nonRecoveryKeys.has(keyFor(record)),
    )
    .map((record) => String(record.id))

  if (duplicateRecoveryIds.length === 0) {
    console.log('No duplicate RECOVERY rows found.')
    return
  }

  const deletedEntityIds =
    state.deletedEntityIds && typeof state.deletedEntityIds === 'object' ? { ...state.deletedEntityIds } : {}
  const deletedRecordIds = new Set(
    Array.isArray(deletedEntityIds.records) ? deletedEntityIds.records.map(String) : [],
  )
  duplicateRecoveryIds.forEach((id) => deletedRecordIds.add(id))
  deletedEntityIds.records = Array.from(deletedRecordIds)

  const nextRecords = records.filter((record) => !deletedRecordIds.has(String(record.id ?? '')))
  let payload = {
    ...state,
    records: nextRecords,
    deletedEntityIds,
    _meta: {
      ...(state._meta ?? {}),
      expectedUpdatedAt: state?._meta?.updatedAt ?? null,
      changeSource: 'cleanup-recovery-duplicates',
    },
  }

  try {
    await putState(payload)
  } catch (error) {
    if (!String(error.message).includes('(409)')) throw error
    state = await fetchState()
    payload = {
      ...state,
      records: (state.records ?? []).filter((record) => !deletedRecordIds.has(String(record.id ?? ''))),
      deletedEntityIds: {
        ...(state.deletedEntityIds ?? {}),
        records: Array.from(
          new Set([...(state.deletedEntityIds?.records ?? []).map(String), ...duplicateRecoveryIds]),
        ),
      },
      _meta: {
        ...(state._meta ?? {}),
        expectedUpdatedAt: state?._meta?.updatedAt ?? null,
        changeSource: 'cleanup-recovery-duplicates',
      },
    }
    await putState(payload)
  }

  const verify = await fetchState()
  const remainingDuplicates = (verify.records ?? []).filter(
    (record) =>
      String(record.id ?? '').startsWith('RECOVERY-') &&
      (verify.records ?? []).some(
        (other) => !String(other.id ?? '').startsWith('RECOVERY-') && keyFor(other) === keyFor(record),
      ),
  )
  console.log(
    JSON.stringify(
      {
        removedCount: duplicateRecoveryIds.length,
        remainingDuplicateCount: remainingDuplicates.length,
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
