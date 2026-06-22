const MERGE_BY_ID_KEYS = [
  'employees',
  'customers',
  'suppliers',
  'invoiceDocuments',
  'purchaseOrders',
  'records',
  'haulageTrips',
  'fuelEntries',
  'maintenanceEntries',
  'decorticationAssignments',
  'decorticationRecords',
  'dryingAssignments',
  'dryingRecords',
  'brushingStockMovements',
  'brushingDailyRecords',
  'balingRecords',
  'silageRecords',
  'invoiceStockIssues',
]

function recordKey(item) {
  const id = item?.id
  return id == null ? null : String(id)
}

export function mergeRecordsById(currentItems, incomingItems, getKey = recordKey) {
  const current = Array.isArray(currentItems) ? currentItems : []
  const incoming = Array.isArray(incomingItems) ? incomingItems : null

  if (incoming === null) {
    return current
  }
  if (incoming.length === 0) {
    return current.length > 0 ? current : incoming
  }

  const merged = new Map()
  for (const item of current) {
    const key = getKey(item)
    if (key != null) {
      merged.set(key, item)
    }
  }
  for (const item of incoming) {
    const key = getKey(item)
    if (key != null) {
      merged.set(key, item)
    }
  }
  return Array.from(merged.values())
}

/** Prevent stale or pre-hydration client saves from wiping stored business data. */
export function mergeIncomingAppState(currentData, incomingData) {
  const current = currentData && typeof currentData === 'object' ? currentData : {}
  const incoming = incomingData && typeof incomingData === 'object' ? incomingData : {}
  const merged = { ...current, ...incoming }

  for (const key of MERGE_BY_ID_KEYS) {
    merged[key] = mergeRecordsById(current[key], incoming[key])
  }

  return merged
}
