import { migrateSilageRecord } from './silageCodes.js'

const DEMO_CUSTOMER_ID = 'CUST-SEED-001'
const DEMO_INVOICE_ID = 'INV-SEED-1087'

/** Real harvest entries in production began on this date (inclusive). */
export const REAL_HARVEST_DATA_START_DATE = '2026-06-12'

function isSeedHarvestRecord(record) {
  return /^\d{4}-\d{4}-\d{2}-\d{2}$/.test(String(record?.id ?? ''))
}

function shouldRemoveHarvestRecord(record) {
  const harvestedOn = String(record?.harvestedOn ?? '')
  if (isSeedHarvestRecord(record)) {
    return true
  }
  if (harvestedOn && harvestedOn < REAL_HARVEST_DATA_START_DATE) {
    return true
  }
  return false
}

function isSeedHaulageTrip(trip) {
  return /^TRIP-\d{4}-\d{2}-\d{2}-/.test(String(trip?.id ?? ''))
}

function isSeedDecorticationRecord(record) {
  return /^DEC-\d{4}-\d{2}-\d{2}-/.test(String(record?.id ?? ''))
}

function isSeedDryingRecord(record) {
  return String(record?.id ?? '').startsWith('DRY-DEC-')
}

function isSeedDecorticationAssignment(assignment) {
  return /^ASG-\d{4}-\d{2}-\d{2}-/.test(String(assignment?.id ?? ''))
}

function hasSeedMarker(id) {
  return String(id ?? '').includes('-SEED-')
}

function isSeedFuelEntry(entry) {
  return /^FUEL-\d{4}-\d{2}-\d{2}$/.test(String(entry?.id ?? ''))
}

function isSeedMaintenanceEntry(entry) {
  return /^MTN-(SVC|REP)-\d{4}-\d{2}-\d{2}$/.test(String(entry?.id ?? ''))
}

function migrateInvoiceDocument(document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.items)) {
    return document
  }
  return {
    ...document,
    items: document.items.map((item) =>
      item?.product === 'SLG' ? { ...item, product: 'SLG35' } : item,
    ),
  }
}

/** Keep one drying record per decorticator shift (earliest id wins). */
export function dedupeDryingRecords(records) {
  if (!Array.isArray(records)) {
    return records
  }
  const bestByDecorticationId = new Map()
  const withoutKey = []
  for (const record of records) {
    const key = record.decorticationRecordId
    if (!key) {
      withoutKey.push(record)
      continue
    }
    const existing = bestByDecorticationId.get(key)
    if (!existing || String(record.id) < String(existing.id)) {
      bestByDecorticationId.set(key, record)
    }
  }
  return [...withoutKey, ...bestByDecorticationId.values()]
}

export function sanitizePersistedAppState(data, { forPersist = false } = {}) {
  if (!data || typeof data !== 'object') {
    return data
  }

  const records = Array.isArray(data.records)
    ? data.records.filter((record) => !shouldRemoveHarvestRecord(record))
    : data.records
  const haulageTrips = Array.isArray(data.haulageTrips)
    ? data.haulageTrips.filter((trip) => !isSeedHaulageTrip(trip))
    : data.haulageTrips
  const decorticationRecords = Array.isArray(data.decorticationRecords)
    ? data.decorticationRecords.filter((record) => !isSeedDecorticationRecord(record))
    : data.decorticationRecords
  const decorticationAssignments = Array.isArray(data.decorticationAssignments)
    ? data.decorticationAssignments.filter((assignment) => !isSeedDecorticationAssignment(assignment))
    : data.decorticationAssignments
  const dryingRecords = dedupeDryingRecords(
    Array.isArray(data.dryingRecords)
      ? data.dryingRecords.filter((record) => !isSeedDryingRecord(record))
      : data.dryingRecords,
  )
  const brushingStockMovements = Array.isArray(data.brushingStockMovements)
    ? data.brushingStockMovements.filter((record) => !hasSeedMarker(record.id))
    : data.brushingStockMovements
  const brushingDailyRecords = Array.isArray(data.brushingDailyRecords)
    ? data.brushingDailyRecords.filter((record) => !hasSeedMarker(record.id))
    : data.brushingDailyRecords
  const balingRecords = Array.isArray(data.balingRecords)
    ? data.balingRecords.filter((record) => !hasSeedMarker(record.id))
    : data.balingRecords
  const silageRecords = Array.isArray(data.silageRecords)
    ? data.silageRecords
        .filter((record) => !hasSeedMarker(record.id))
        .map(migrateSilageRecord)
    : data.silageRecords
  const invoiceDocuments = Array.isArray(data.invoiceDocuments)
    ? data.invoiceDocuments
        .filter((document) => document.id !== DEMO_INVOICE_ID)
        .map(migrateInvoiceDocument)
    : data.invoiceDocuments
  const customers = Array.isArray(data.customers)
    ? forPersist
      ? data.customers
      : data.customers.filter((customer) => customer.id !== DEMO_CUSTOMER_ID)
    : data.customers
  const fuelEntries = Array.isArray(data.fuelEntries)
    ? data.fuelEntries.filter((entry) => !isSeedFuelEntry(entry))
    : data.fuelEntries
  const maintenanceEntries = Array.isArray(data.maintenanceEntries)
    ? data.maintenanceEntries.filter((entry) => !isSeedMaintenanceEntry(entry))
    : data.maintenanceEntries
  const purchaseOrders = Array.isArray(data.purchaseOrders)
    ? data.purchaseOrders.map((po) => ({
        ...po,
        poNumber: String(po?.poNumber ?? '').replace(/^LPO-/, 'PO-'),
      }))
    : data.purchaseOrders
  const poApprovalLimits =
    data.poApprovalLimits && typeof data.poApprovalLimits === 'object'
      ? data.poApprovalLimits
      : data.lpoApprovalLimits && typeof data.lpoApprovalLimits === 'object'
        ? data.lpoApprovalLimits
        : data.poApprovalLimits

  return {
    ...data,
    records,
    haulageTrips,
    fuelEntries,
    maintenanceEntries,
    purchaseOrders,
    poApprovalLimits,
    decorticationRecords,
    decorticationAssignments,
    dryingRecords,
    brushingStockMovements,
    brushingDailyRecords,
    balingRecords,
    silageRecords,
    invoiceDocuments,
    customers,
  }
}
