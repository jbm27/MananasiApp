/** Fibre stock codes are batch + grade. The decorticator is not part of the code. */

const FIBRE_GRADE = /^(UBR|BRS|TOW|PUR|CAR\d+)$/

export function normalizeBatchNumber(batchNumber) {
  const [yearPart, fieldPart] = String(batchNumber ?? '').split('-')
  const year = Number(yearPart)
  const field = Number(fieldPart)
  if (Number.isNaN(year) || Number.isNaN(field)) {
    return String(batchNumber ?? '')
  }
  return `${year}-${String(field).padStart(3, '0')}`
}

/**
 * Loose fibre, for example 2026-024-UBR.
 * The middle argument is ignored when it is a machine code, so older call sites keep working.
 */
export function buildStockCode(batchNumber, machineOrGrade, grade = 'UBR') {
  const resolvedGrade = FIBRE_GRADE.test(String(machineOrGrade ?? ''))
    ? String(machineOrGrade)
    : grade
  return `${normalizeBatchNumber(batchNumber)}-${resolvedGrade}`
}

export function canonicalizeFibreStockCode(stockCode) {
  const raw = String(stockCode ?? '').trim()
  if (!raw) {
    return ''
  }
  const parts = raw.split('-').filter(Boolean)
  if (parts.length >= 4 && /^\d{2}$/.test(parts[2]) && FIBRE_GRADE.test(parts[3] ?? '')) {
    return [parts[0], parts[1], ...parts.slice(3)].join('-')
  }
  return parts.join('-')
}

export function brushingOutputCodes(ubrStockCode) {
  const ubr = canonicalizeFibreStockCode(ubrStockCode)
  return {
    brs: ubr.replace(/-UBR$/, '-BRS'),
    tow: ubr.replace(/-UBR$/, '-TOW'),
  }
}

export function buildBaleSeriesCode(sourceStockCode, baleWeightKg) {
  const source = canonicalizeFibreStockCode(sourceStockCode)
  return `${source}-${Math.round(Number(baleWeightKg))}`
}

export function buildBaleCode(sourceStockCode, baleWeightKg, serialNumber) {
  return `${buildBaleSeriesCode(sourceStockCode, baleWeightKg)}-${String(serialNumber).padStart(2, '0')}`
}

/** Machine segment from a legacy code. New codes do not carry a decorticator. */
export function getMachineFromStockCode(stockCode) {
  const parts = String(stockCode ?? '').split('-')
  if (parts.length >= 4 && /^\d{2}$/.test(parts[2]) && FIBRE_GRADE.test(parts[3] ?? '')) {
    const machineNumber = Number(parts[2])
    if (machineNumber > 0) {
      return `D${machineNumber}`
    }
  }
  return ''
}

function baleSerial(baleCode) {
  const serial = Number(String(baleCode ?? '').split('-').slice(-1)[0])
  return Number.isFinite(serial) ? serial : 0
}

function migrateBaleRecord(record) {
  const sourceStockCode = canonicalizeFibreStockCode(record.sourceStockCode)
  const baleSeriesCode = record.baleSeriesCode
    ? canonicalizeFibreStockCode(record.baleSeriesCode)
    : sourceStockCode && record.baleWeightKg
      ? buildBaleSeriesCode(sourceStockCode, record.baleWeightKg)
      : ''
  const baleCode = record.baleCode ? canonicalizeFibreStockCode(record.baleCode) : ''
  return {
    ...record,
    sourceStockCode,
    baleSeriesCode,
    baleCode,
  }
}

/** Give every bale a code without a decorticator, and a unique serial inside its series. */
export function migrateBalingRecords(records) {
  if (!Array.isArray(records)) {
    return records
  }
  const prepared = records.map(migrateBaleRecord)
  const ordered = prepared
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      const idCompare = String(left.record.id ?? '').localeCompare(String(right.record.id ?? ''))
      return idCompare !== 0 ? idCompare : left.index - right.index
    })
  const used = new Set()
  const maxSerial = new Map()
  const byIndex = new Map()
  for (const entry of ordered) {
    const record = entry.record
    const series = record.baleSeriesCode
    let code = record.baleCode
    if (series && (!code || !code.startsWith(`${series}-`))) {
      const serial = baleSerial(code) || 1
      code = `${series}-${String(serial).padStart(2, '0')}`
    }
    if (code && used.has(code) && series) {
      let next = (maxSerial.get(series) ?? 0) + 1
      let candidate = `${series}-${String(next).padStart(2, '0')}`
      while (used.has(candidate)) {
        next += 1
        candidate = `${series}-${String(next).padStart(2, '0')}`
      }
      code = candidate
    }
    if (code) {
      used.add(code)
      const serial = baleSerial(code)
      if (series) {
        maxSerial.set(series, Math.max(maxSerial.get(series) ?? 0, serial))
      }
    }
    byIndex.set(entry.index, { ...record, baleCode: code })
  }
  return prepared.map((_, index) => byIndex.get(index))
}

function migrateLooseStockRecord(record, fields) {
  if (!record || typeof record !== 'object') {
    return record
  }
  const next = { ...record }
  for (const field of fields) {
    if (next[field]) {
      next[field] = canonicalizeFibreStockCode(next[field])
    }
  }
  return next
}

function migrateInvoiceDocumentCodes(document, balingById) {
  if (!document || typeof document !== 'object') {
    return document
  }
  const items = Array.isArray(document.items)
    ? document.items.map((item) => {
        if (!item || typeof item !== 'object') {
          return item
        }
        const stockAllocations = Array.isArray(item.stockAllocations)
          ? item.stockAllocations.map((allocation) =>
              allocation?.stockCode
                ? { ...allocation, stockCode: canonicalizeFibreStockCode(allocation.stockCode) }
                : allocation,
            )
          : item.stockAllocations
        return {
          ...item,
          ...(item.stockCode ? { stockCode: canonicalizeFibreStockCode(item.stockCode) } : {}),
          stockAllocations,
        }
      })
    : document.items
  const snapshot = document.finalizedStockSnapshot
  const finalizedStockSnapshot = snapshot
    ? {
        ...snapshot,
        looseIssues: Array.isArray(snapshot.looseIssues)
          ? snapshot.looseIssues.map((issue) => migrateLooseStockRecord(issue, ['stockCode']))
          : snapshot.looseIssues,
        balingRecords: Array.isArray(snapshot.balingRecords)
          ? snapshot.balingRecords.map((record) => balingById.get(record.id) ?? migrateBaleRecord(record))
          : snapshot.balingRecords,
      }
    : snapshot
  return {
    ...document,
    items,
    ...(snapshot ? { finalizedStockSnapshot } : {}),
  }
}

export function migrateFibreStockCodes(data) {
  if (!data || typeof data !== 'object') {
    return data
  }
  const invoiceDocuments = Array.isArray(data.invoiceDocuments) ? data.invoiceDocuments : []
  const liveBales = Array.isArray(data.balingRecords) ? data.balingRecords : []
  const snapshotBales = invoiceDocuments.flatMap((document) =>
    Array.isArray(document?.finalizedStockSnapshot?.balingRecords)
      ? document.finalizedStockSnapshot.balingRecords
      : [],
  )
  const migratedBales = migrateBalingRecords([...liveBales, ...snapshotBales])
  const balingById = new Map()
  for (const record of migratedBales) {
    if (record?.id) {
      balingById.set(record.id, record)
    }
  }
  return {
    ...data,
    brushingStockMovements: Array.isArray(data.brushingStockMovements)
      ? data.brushingStockMovements.map((record) =>
          migrateLooseStockRecord(record, ['sourceStockCode']),
        )
      : data.brushingStockMovements,
    brushingDailyRecords: Array.isArray(data.brushingDailyRecords)
      ? data.brushingDailyRecords.map((record) =>
          migrateLooseStockRecord(record, ['sourceStockCode']),
        )
      : data.brushingDailyRecords,
    balingRecords: liveBales.map((record) => balingById.get(record.id) ?? migrateBaleRecord(record)),
    invoiceStockIssues: Array.isArray(data.invoiceStockIssues)
      ? data.invoiceStockIssues.map((issue) => migrateLooseStockRecord(issue, ['stockCode']))
      : data.invoiceStockIssues,
    invoiceDocuments: invoiceDocuments.map((document) =>
      migrateInvoiceDocumentCodes(document, balingById),
    ),
    purificationRuns: Array.isArray(data.purificationRuns)
      ? data.purificationRuns.map((run) =>
          migrateLooseStockRecord(run, ['sourceStockCode', 'outputStockCode']),
        )
      : data.purificationRuns,
    cardingShifts: Array.isArray(data.cardingShifts)
      ? data.cardingShifts.map((shift) => ({
          ...shift,
          lines: Array.isArray(shift.lines)
            ? shift.lines.map((line) =>
                migrateLooseStockRecord(line, ['sourceStockCode', 'outputStockCode']),
              )
            : shift.lines,
        }))
      : data.cardingShifts,
  }
}
