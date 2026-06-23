import { getSilageBagSeriesCode, getSilageRecordSerial } from './silageCodes.js'

function normalizeBatchNumber(batchNumber) {
  const [yearPart, fieldPart] = String(batchNumber ?? '').split('-')
  const year = Number(yearPart)
  const field = Number(fieldPart)
  if (Number.isNaN(year) || Number.isNaN(field)) {
    return String(batchNumber ?? '')
  }
  return `${year}-${String(field).padStart(3, '0')}`
}

export function getBaleSerialFromCode(baleCode) {
  const serial = Number(String(baleCode ?? '').split('-').slice(-1)[0])
  return Number.isNaN(serial) ? 0 : serial
}

export function productRequiresStock(product) {
  return String(product ?? '').trim().toUpperCase() !== 'CUS'
}

export function getProductSuffixFromStockCode(stockCode, stockForm) {
  const code = String(stockCode ?? '')
  if (stockForm === 'Silage') {
    if (code.includes('SLG25')) {
      return 'SLG25'
    }
    if (code.includes('SLG35') || code.includes('-SLG-')) {
      return 'SLG35'
    }
    return 'SLG35'
  }
  if (stockForm === 'Baled') {
    const gradeMatch = code.match(/-(UBR|BRS|TOW)-\d+$/)
    if (gradeMatch) {
      return gradeMatch[1]
    }
  }
  const looseMatch = code.match(/-(UBR|BRS|TOW)$/)
  return looseMatch ? looseMatch[1] : ''
}

export function stockOptionMatchesProduct(option, product) {
  const normalizedProduct = String(product ?? '').trim().toUpperCase()
  if (!productRequiresStock(normalizedProduct)) {
    return false
  }
  const suffix = getProductSuffixFromStockCode(option.stockCode, option.stockForm)
  if (normalizedProduct === 'SLG') {
    return suffix === 'SLG35'
  }
  return suffix === normalizedProduct
}

export function computeAbsoluteStockCatalog({
  dryingRecords,
  brushingStockMovements,
  brushingDailyRecords,
  balingRecords,
  silageRecords,
  invoiceStockIssues = [],
}) {
  const stockMap = {}

  dryingRecords.forEach((record) => {
    const batch = normalizeBatchNumber(record.batchNumber)
    const machinePart = String(record.machine ?? '').replace(/[^\d]/g, '')
    const code = `${batch}-${String(machinePart).padStart(2, '0')}-UBR`
    if (!stockMap[code]) {
      stockMap[code] = {
        stockCode: code,
        batchNumber: batch,
        totalKg: 0,
      }
    }
    stockMap[code].totalKg += record.totalDriedKg
  })

  brushingStockMovements.forEach((item) => {
    const code = item.sourceStockCode
    if (!stockMap[code]) {
      stockMap[code] = {
        stockCode: code,
        batchNumber: normalizeBatchNumber(item.batchNumber),
        totalKg: 0,
      }
    }
    stockMap[code].totalKg += item.type === 'issue' ? -item.quantityKg : item.quantityKg
  })

  brushingDailyRecords.forEach((item) => {
    const traceabilityRoot = String(item.sourceStockCode ?? '').replace(/-UBR$/, '')
    const brsCode = `${traceabilityRoot}-BRS`
    const towCode = `${traceabilityRoot}-TOW`
    const batch = normalizeBatchNumber(item.batchNumber)
    if (!stockMap[brsCode]) {
      stockMap[brsCode] = { stockCode: brsCode, batchNumber: batch, totalKg: 0 }
    }
    if (!stockMap[towCode]) {
      stockMap[towCode] = { stockCode: towCode, batchNumber: batch, totalKg: 0 }
    }
    stockMap[brsCode].totalKg += item.brsKg
    stockMap[towCode].totalKg += item.towKg
  })

  balingRecords.forEach((item) => {
    const sourceCode = item.sourceStockCode
    if (!stockMap[sourceCode]) {
      stockMap[sourceCode] = {
        stockCode: sourceCode,
        batchNumber: normalizeBatchNumber(item.batchNumber),
        totalKg: 0,
      }
    }
    stockMap[sourceCode].totalKg -= item.baleWeightKg
  })

  invoiceStockIssues.forEach((issue) => {
    const code = issue.stockCode
    if (!stockMap[code]) {
      stockMap[code] = {
        stockCode: code,
        batchNumber: normalizeBatchNumber(issue.batchNumber ?? code.split('-').slice(0, 2).join('-')),
        totalKg: 0,
      }
    }
    stockMap[code].totalKg -= issue.quantityKg
  })

  const looseStockRows = Object.values(stockMap)
    .map((item) => ({
      ...item,
      totalKg: Number(item.totalKg.toFixed(1)),
      stockForm: 'Loose',
      quantityLabel: null,
      productSuffix: getProductSuffixFromStockCode(item.stockCode, 'Loose'),
    }))
    .filter((item) => item.totalKg > 0)

  const baledStockRows = Object.values(
    balingRecords.reduce((map, item) => {
      if (!map[item.baleSeriesCode]) {
        map[item.baleSeriesCode] = {
          stockCode: item.baleSeriesCode,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          totalKg: 0,
          stockForm: 'Baled',
          quantityLabel: 0,
        }
      }
      map[item.baleSeriesCode].totalKg += item.baleWeightKg
      map[item.baleSeriesCode].quantityLabel += 1
      return map
    }, {}),
  ).map((item) => ({
    ...item,
    totalKg: Number(item.totalKg.toFixed(1)),
    productSuffix: getProductSuffixFromStockCode(item.stockCode, 'Baled'),
  }))

  const silageStockRows = Object.values(
    silageRecords.reduce((map, item) => {
      const seriesCode = getSilageBagSeriesCode(item)
      if (!map[seriesCode]) {
        map[seriesCode] = {
          stockCode: seriesCode,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          totalKg: 0,
          stockForm: 'Silage',
          quantityLabel: 0,
        }
      }
      map[seriesCode].totalKg += item.massKg
      map[seriesCode].quantityLabel += 1
      return map
    }, {}),
  ).map((item) => ({
    ...item,
    totalKg: Number(item.totalKg.toFixed(1)),
    productSuffix: getProductSuffixFromStockCode(item.stockCode, 'Silage'),
  }))

  return [...looseStockRows, ...baledStockRows, ...silageStockRows].sort((a, b) => {
    const formOrder = { Loose: 0, Baled: 1, Silage: 2 }
    const formDiff = formOrder[a.stockForm] - formOrder[b.stockForm]
    if (formDiff !== 0) {
      return formDiff
    }
    return a.stockCode.localeCompare(b.stockCode)
  })
}

export function filterStockOptionsForProduct(product, catalog) {
  return catalog.filter((option) => stockOptionMatchesProduct(option, product))
}

export function findStockOption(catalog, stockCode) {
  return catalog.find((option) => option.stockCode === stockCode) ?? null
}

export function createEmptyStockAllocation() {
  return {
    id: `ALLOC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    stockCode: '',
    stockForm: '',
    quantityKg: '',
  }
}

export function sumStockAllocationKg(allocations) {
  return Number(
    (allocations ?? []).reduce((sum, allocation) => sum + (Number(allocation.quantityKg) || 0), 0).toFixed(2),
  )
}

export function normalizeItemStockAllocations(item) {
  if (Array.isArray(item.stockAllocations) && item.stockAllocations.length > 0) {
    return item.stockAllocations
      .map((allocation) => ({
        stockCode: String(allocation.stockCode ?? '').trim(),
        stockForm: allocation.stockForm ?? '',
        quantityKg: Number(allocation.quantityKg),
      }))
      .filter((allocation) => allocation.stockCode && allocation.quantityKg > 0)
  }
  const stockCode = String(item.stockCode ?? '').trim()
  if (!stockCode) {
    return []
  }
  return [
    {
      stockCode,
      stockForm: item.stockForm ?? '',
      quantityKg: Number(item.quantityKg),
    },
  ]
}

export function validateInvoiceStockLines(items, catalog) {
  const errors = []
  const usageByStockCode = {}

  for (const item of items) {
    if (!productRequiresStock(item.product)) {
      continue
    }
    const allocations = Array.isArray(item.stockAllocations)
      ? item.stockAllocations
          .map((allocation) => ({
            stockCode: String(allocation.stockCode ?? '').trim(),
            stockForm: allocation.stockForm ?? '',
            quantityKg: Number(allocation.quantityKg),
          }))
          .filter((allocation) => allocation.stockCode || allocation.quantityKg > 0)
      : normalizeItemStockAllocations(item)

    if (allocations.length === 0) {
      errors.push(
        `${item.product}: add one or more stock sources for this line (custom items do not need stock).`,
      )
      continue
    }

    const lineQuantityKg = Number(item.quantityKg)
    const allocatedKg = sumStockAllocationKg(allocations)
    if (!Number.isNaN(lineQuantityKg) && lineQuantityKg > 0 && Math.abs(allocatedKg - lineQuantityKg) > 0.05) {
      errors.push(
        `${item.product}: stock sources total ${allocatedKg} kg but the line quantity is ${lineQuantityKg} kg.`,
      )
    }

    for (const allocation of allocations) {
      const stockCode = String(allocation.stockCode ?? '').trim()
      const quantityKg = Number(allocation.quantityKg)
      if (!stockCode) {
        errors.push(`${item.product}: each stock source needs a stock code selected.`)
        continue
      }
      if (Number.isNaN(quantityKg) || quantityKg <= 0) {
        errors.push(`${item.product} (${stockCode}): enter a quantity greater than zero for each stock source.`)
        continue
      }
      const option = findStockOption(catalog, stockCode)
      if (!option) {
        errors.push(`${item.product}: stock code ${stockCode} is no longer available.`)
        continue
      }
      if (!stockOptionMatchesProduct(option, item.product)) {
        errors.push(`${item.product}: stock code ${stockCode} does not match this product.`)
        continue
      }
      usageByStockCode[stockCode] = Number(((usageByStockCode[stockCode] ?? 0) + quantityKg).toFixed(2))
    }
  }

  for (const [stockCode, usedKg] of Object.entries(usageByStockCode)) {
    const option = findStockOption(catalog, stockCode)
    if (!option) {
      errors.push(`Stock code ${stockCode} is no longer available.`)
      continue
    }
    if (usedKg > option.totalKg + 0.05) {
      errors.push(
        `${stockCode}: total allocated ${usedKg} kg exceeds ${option.totalKg} kg available.`,
      )
    }
  }

  return errors
}

function consumeBaledStock(balingRecords, baleSeriesCode, quantityKg) {
  const matching = balingRecords
    .filter((record) => record.baleSeriesCode === baleSeriesCode)
    .sort((a, b) => getBaleSerialFromCode(a.baleCode) - getBaleSerialFromCode(b.baleCode))
  let remaining = quantityKg
  const idsToRemove = new Set()
  const removedRecords = []
  for (const record of matching) {
    if (remaining <= 0) {
      break
    }
    idsToRemove.add(record.id)
    removedRecords.push(record)
    remaining = Number((remaining - record.baleWeightKg).toFixed(2))
  }
  if (remaining > 0.05) {
    const available = matching.reduce((sum, record) => sum + record.baleWeightKg, 0)
    return {
      ok: false,
      message: `Not enough baled stock in ${baleSeriesCode}. Need ${quantityKg} kg but only ${Number(available.toFixed(1))} kg is available.`,
      balingRecords,
      removedRecords: [],
    }
  }
  return {
    ok: true,
    balingRecords: balingRecords.filter((record) => !idsToRemove.has(record.id)),
    removedRecords,
  }
}

function consumeSilageStock(silageRecords, seriesCode, quantityKg) {
  const matching = silageRecords
    .filter((record) => getSilageBagSeriesCode(record) === seriesCode)
    .sort((a, b) => getSilageRecordSerial(a) - getSilageRecordSerial(b))
  let remaining = quantityKg
  const idsToRemove = new Set()
  const removedRecords = []
  for (const record of matching) {
    if (remaining <= 0) {
      break
    }
    idsToRemove.add(record.id)
    removedRecords.push(record)
    remaining = Number((remaining - record.massKg).toFixed(2))
  }
  if (remaining > 0.05) {
    const available = matching.reduce((sum, record) => sum + record.massKg, 0)
    return {
      ok: false,
      message: `Not enough silage stock in ${seriesCode}. Need ${quantityKg} kg but only ${Number(available.toFixed(1))} kg is available.`,
      silageRecords,
      removedRecords: [],
    }
  }
  return {
    ok: true,
    silageRecords: silageRecords.filter((record) => !idsToRemove.has(record.id)),
    removedRecords,
  }
}

export function applyInvoiceFinalizeStockReduction({
  document,
  balingRecords,
  silageRecords,
  invoiceStockIssues,
}) {
  let nextBalingRecords = balingRecords
  let nextSilageRecords = silageRecords
  const nextInvoiceStockIssues = [...invoiceStockIssues]
  const stockSnapshot = {
    looseIssues: [],
    balingRecords: [],
    silageRecords: [],
  }

  for (const item of document.items) {
    if (!productRequiresStock(item.product)) {
      continue
    }
    const allocations = normalizeItemStockAllocations(item)
    if (allocations.length === 0) {
      return {
        ok: false,
        message: `Line ${item.product} is missing stock allocation.`,
      }
    }

    for (const allocation of allocations) {
      const stockCode = allocation.stockCode
      const stockForm = allocation.stockForm
      const quantityKg = Number(allocation.quantityKg)
      if (!stockCode || !stockForm || Number.isNaN(quantityKg) || quantityKg <= 0) {
        return {
          ok: false,
          message: `Line ${item.product} has an invalid stock allocation.`,
        }
      }

      if (stockForm === 'Loose') {
        const issue = {
          id: `INV-STK-${document.id}-${Date.now()}-${nextInvoiceStockIssues.length + 1}`,
          invoiceId: document.id,
          invoiceDocumentNumber: document.documentNumber,
          stockCode,
          stockForm: 'Loose',
          quantityKg,
          batchNumber: stockCode.split('-').slice(0, 2).join('-'),
          date: document.invoiceDate,
        }
        nextInvoiceStockIssues.push(issue)
        stockSnapshot.looseIssues.push(issue)
        continue
      }

      if (stockForm === 'Baled') {
        const result = consumeBaledStock(nextBalingRecords, stockCode, quantityKg)
        if (!result.ok) {
          return { ok: false, message: result.message }
        }
        nextBalingRecords = result.balingRecords
        stockSnapshot.balingRecords.push(...result.removedRecords)
        continue
      }

      if (stockForm === 'Silage') {
        const result = consumeSilageStock(nextSilageRecords, stockCode, quantityKg)
        if (!result.ok) {
          return { ok: false, message: result.message }
        }
        nextSilageRecords = result.silageRecords
        stockSnapshot.silageRecords.push(...result.removedRecords)
        continue
      }

      return {
        ok: false,
        message: `Unsupported stock form "${stockForm}" on line ${item.product}.`,
      }
    }
  }

  return {
    ok: true,
    balingRecords: nextBalingRecords,
    silageRecords: nextSilageRecords,
    invoiceStockIssues: nextInvoiceStockIssues,
    stockSnapshot,
  }
}

export function restoreInvoiceFinalizeStock({
  document,
  balingRecords,
  silageRecords,
  invoiceStockIssues,
}) {
  const snapshot = document?.finalizedStockSnapshot
  let nextBalingRecords = [...balingRecords]
  let nextSilageRecords = [...silageRecords]
  let nextInvoiceStockIssues = [...invoiceStockIssues]

  if (snapshot) {
    const removedBaleIds = new Set((snapshot.balingRecords ?? []).map((record) => record.id))
    const removedSilageIds = new Set((snapshot.silageRecords ?? []).map((record) => record.id))
    nextBalingRecords = nextBalingRecords.filter((record) => !removedBaleIds.has(record.id))
    nextSilageRecords = nextSilageRecords.filter((record) => !removedSilageIds.has(record.id))
    nextBalingRecords = [...nextBalingRecords, ...(snapshot.balingRecords ?? [])].sort((a, b) =>
      a.baleCode.localeCompare(b.baleCode),
    )
    nextSilageRecords = [...nextSilageRecords, ...(snapshot.silageRecords ?? [])].sort(
      (a, b) => getSilageRecordSerial(a) - getSilageRecordSerial(b),
    )
    const snapshotIssueIds = new Set((snapshot.looseIssues ?? []).map((issue) => issue.id))
    nextInvoiceStockIssues = nextInvoiceStockIssues.filter((issue) => !snapshotIssueIds.has(issue.id))
  } else {
    nextInvoiceStockIssues = nextInvoiceStockIssues.filter((issue) => issue.invoiceId !== document.id)
  }

  return {
    ok: true,
    balingRecords: nextBalingRecords,
    silageRecords: nextSilageRecords,
    invoiceStockIssues: nextInvoiceStockIssues,
  }
}
