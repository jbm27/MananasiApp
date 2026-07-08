/** Collections stored as arrays of objects with stable `id` fields. */
export const MERGE_BY_ID_KEYS = [
  'employees',
  'customers',
  'suppliers',
  'invoiceDocuments',
  'purchaseOrders',
  'purchaseOrderAuditLog',
  'records',
  'haulageTrips',
  'fuelEntries',
  'maintenanceEntries',
  'decorticationAssignments',
  'decorticationRecords',
  'dryingAssignments',
  'dryingRecords',
  'balingAssignments',
  'brushingStockMovements',
  'brushingDailyRecords',
  'balingRecords',
  'silageRecords',
  'invoiceStockIssues',
  'leaveRecords',
  'publicHolidays',
]

/** Object maps merged by shallow key-union (incoming overwrites). */
export const MERGE_OBJECT_KEYS = [
  'mileageByDate',
  'pagePermissionOverrides',
  'dataEntryPermissionOverrides',
  'poApprovalLimits',
  'payrollAdjustments',
  'salaryPayrollAdjustments',
  'payrollApprovals',
  'compensationRules',
  'deletedEntityIds',
]

function recordKey(item) {
  const id = item?.id
  return id == null ? null : String(id)
}

/**
 * Union merge by id: keep every record present on either side.
 * Incoming wins when the same id exists on both (updates).
 * Missing incoming array keeps current. Empty incoming keeps current if current has data
 * (guards against blank client snapshots wiping the DB).
 */
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

function mergeObjects(currentValue, incomingValue) {
  const current =
    currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
      ? currentValue
      : {}
  if (!incomingValue || typeof incomingValue !== 'object' || Array.isArray(incomingValue)) {
    return currentValue === undefined ? current : currentValue
  }
  return { ...current, ...incomingValue }
}

function collectDeletedEntityIds(merged) {
  const deleted =
    merged.deletedEntityIds && typeof merged.deletedEntityIds === 'object'
      ? { ...merged.deletedEntityIds }
      : {}

  const audit = Array.isArray(merged.purchaseOrderAuditLog) ? merged.purchaseOrderAuditLog : []
  const deletedPoIds = new Set(Array.isArray(deleted.purchaseOrders) ? deleted.purchaseOrders : [])
  for (const entry of audit) {
    if (entry?.action === 'deleted' && entry.poId != null) {
      deletedPoIds.add(String(entry.poId))
    }
  }
  if (deletedPoIds.size > 0) {
    deleted.purchaseOrders = Array.from(deletedPoIds)
  }
  return deleted
}

function applyDeletedEntityIds(merged, deletedEntityIds) {
  const next = { ...merged, deletedEntityIds }
  for (const [collectionKey, ids] of Object.entries(deletedEntityIds ?? {})) {
    if (!Array.isArray(next[collectionKey]) || !Array.isArray(ids) || ids.length === 0) {
      continue
    }
    const remove = new Set(ids.map(String))
    next[collectionKey] = next[collectionKey].filter((item) => !remove.has(String(item?.id)))
  }
  return next
}

/** Prevent stale or partial client saves from wiping stored business data. */
export function mergeIncomingAppState(currentData, incomingData) {
  const current = currentData && typeof currentData === 'object' ? currentData : {}
  const incoming = incomingData && typeof incomingData === 'object' ? incomingData : {}
  const merged = { ...current, ...incoming }

  for (const key of MERGE_BY_ID_KEYS) {
    merged[key] = mergeRecordsById(current[key], incoming[key])
  }

  for (const key of MERGE_OBJECT_KEYS) {
    if (key in incoming || key in current) {
      merged[key] = mergeObjects(current[key], incoming[key])
    }
  }

  if (typeof merged.activeBatchNumber !== 'string' && typeof current.activeBatchNumber === 'string') {
    merged.activeBatchNumber = current.activeBatchNumber
  }

  const deletedEntityIds = collectDeletedEntityIds(merged)
  return applyDeletedEntityIds(merged, deletedEntityIds)
}
