import { normalizeItemStockAllocations } from './invoiceStock.js'
import { getSilageBagSeriesCode } from './silageCodes.js'

export const PACKAGING_KG_PER_UNIT = 0.25

export const PRODUCT_DENSITY_KG_PER_M3 = {
  BRS: 350,
  UBR: 275,
  TOW: 275,
  SLG25: 490,
  SLG35: 410,
  SLG: 410,
}

export function getPackingListProductCode(invoiceProduct) {
  const code = String(invoiceProduct ?? '').trim().toUpperCase()
  if (code === 'UBR' || code === 'BRS' || code === 'TOW') {
    return 'PALF'
  }
  if (code === 'SLG' || code === 'SLG25' || code === 'SLG35') {
    return code === 'SLG' ? 'SLG35' : code
  }
  return code || 'CUS'
}

export function isCustomPackingListProduct(invoiceProduct) {
  return String(invoiceProduct ?? '').trim().toUpperCase() === 'CUS'
}

export function getDensityForInvoiceProduct(invoiceProduct) {
  const code = String(invoiceProduct ?? '').trim().toUpperCase()
  return PRODUCT_DENSITY_KG_PER_M3[code] ?? null
}

export function formatPackingListDescription(description) {
  const text = String(description ?? '').trim()
  if (!text) {
    return ''
  }
  return text
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function getPackingListOriginFromInvoice(invoiceOrigin) {
  const origin = String(invoiceOrigin ?? '').trim()
  if (!origin) {
    return 'Made in Kenya'
  }
  if (/kenya/i.test(origin)) {
    return 'Made in Kenya'
  }
  return origin
}

function getBaleWeightKgFromSeriesCode(seriesCode, balingRecords) {
  const parts = String(seriesCode ?? '').split('-')
  const trailing = Number(parts[parts.length - 1])
  if (Number.isFinite(trailing) && trailing > 0 && trailing <= 500) {
    return trailing
  }
  const matchingBales = (balingRecords ?? []).filter((record) => record.baleSeriesCode === seriesCode)
  if (matchingBales.length === 0) {
    return 0
  }
  return (
    matchingBales.reduce((sum, record) => sum + (record.baleWeightKg ?? 0), 0) / matchingBales.length
  )
}

function getSilageBagMassKgFromSeriesCode(seriesCode, silageRecords) {
  const parts = String(seriesCode ?? '').split('-')
  const trailing = parts[parts.length - 1]
  if (/^\d{3}$/.test(trailing)) {
    const parsed = Number(trailing)
    if (parsed > 0) {
      return parsed
    }
  }
  const matchingBags = (silageRecords ?? []).filter(
    (record) => getSilageBagSeriesCode(record) === seriesCode,
  )
  if (matchingBags.length === 0) {
    return 0
  }
  return matchingBags.reduce((sum, record) => sum + (record.massKg ?? 0), 0) / matchingBags.length
}

function getAverageBaleWeightForProduct(product, balingRecords) {
  const suffix = String(product ?? '').trim().toUpperCase()
  const matching = (balingRecords ?? []).filter(
    (record) =>
      String(record.sourceStockCode ?? '').includes(`-${suffix}`) ||
      String(record.baleSeriesCode ?? '').includes(`-${suffix}-`),
  )
  if (matching.length === 0) {
    return 0
  }
  return matching.reduce((sum, record) => sum + (record.baleWeightKg ?? 0), 0) / matching.length
}

export function countPackingUnitsFromAllocations(allocations, balingRecords, silageRecords, invoiceProduct) {
  const normalized = normalizeItemStockAllocations({ stockAllocations: allocations })
  let unitCount = 0

  for (const allocation of normalized) {
    const quantityKg = Number(allocation.quantityKg) || 0
    if (quantityKg <= 0) {
      continue
    }

    if (allocation.stockForm === 'Silage') {
      const bagMassKg = getSilageBagMassKgFromSeriesCode(allocation.stockCode, silageRecords)
      if (bagMassKg > 0) {
        unitCount += Math.round(quantityKg / bagMassKg)
        continue
      }
    }

    if (allocation.stockForm === 'Baled') {
      const baleWeightKg = getBaleWeightKgFromSeriesCode(allocation.stockCode, balingRecords)
      if (baleWeightKg > 0) {
        unitCount += Math.round(quantityKg / baleWeightKg)
        continue
      }
    }

    if (allocation.stockForm === 'Loose') {
      const averageBaleWeight = getAverageBaleWeightForProduct(invoiceProduct, balingRecords)
      if (averageBaleWeight > 0) {
        unitCount += Math.round(quantityKg / averageBaleWeight)
      }
    }
  }

  return unitCount > 0 ? unitCount : 0
}

export function calculatePackingListMeasurements({
  invoiceProduct,
  netKg,
  unitCount,
  isCustom = false,
}) {
  const net = Number(netKg) || 0
  const count = Number(unitCount) || 0

  if (isCustom) {
    return {
      baleCount: count > 0 ? count : '',
      totalCbm: '',
      grossKg: '',
      netKg: net > 0 ? net : '',
      autoCalculated: false,
    }
  }

  const density = getDensityForInvoiceProduct(invoiceProduct)
  if (!density || net <= 0 || count <= 0) {
    return {
      baleCount: count > 0 ? count : '',
      totalCbm: '',
      grossKg: '',
      netKg: net > 0 ? Number(net.toFixed(0)) : '',
      autoCalculated: false,
    }
  }

  const totalCbm = net / density
  const grossKg = net + count * PACKAGING_KG_PER_UNIT

  return {
    baleCount: count,
    totalCbm: Number(totalCbm.toFixed(2)),
    grossKg: Number(grossKg.toFixed(0)),
    netKg: Number(net.toFixed(0)),
    autoCalculated: true,
  }
}

export function buildPackingListItemFromInvoiceLine(line, balingRecords = [], silageRecords = []) {
  const invoiceProduct = String(line.product ?? '').trim().toUpperCase()
  const isCustom = isCustomPackingListProduct(invoiceProduct)
  const product = getPackingListProductCode(line.product)
  const description = formatPackingListDescription(line.description)
  const netKg = Number(line.quantityKg) || 0
  const unitCount = isCustom
    ? 0
    : countPackingUnitsFromAllocations(
        line.stockAllocations,
        balingRecords,
        silageRecords,
        invoiceProduct,
      )
  const measurements = calculatePackingListMeasurements({
    invoiceProduct,
    netKg,
    unitCount,
    isCustom,
  })

  return {
    product,
    invoiceProduct,
    isCustom,
    description,
    ...measurements,
  }
}

export function buildPackingListFromInvoice(invoice, balingRecords = [], silageRecords = []) {
  return {
    documentType: 'packing-list',
    documentNumber: invoice.documentNumber,
    invoiceDate: invoice.invoiceDate,
    origin: getPackingListOriginFromInvoice(invoice.origin),
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerAddress: invoice.customerAddress,
    customerRegistration: invoice.customerRegistration,
    hsCode: invoice.hsCode,
    sourceInvoiceId: invoice.id,
    items: (invoice.items ?? []).map((line) =>
      buildPackingListItemFromInvoiceLine(line, balingRecords, silageRecords),
    ),
  }
}

export function computePackingListTotals(items) {
  const totals = {
    baleCount: 0,
    totalCbm: 0,
    grossKg: 0,
    netKg: 0,
  }
  for (const item of items ?? []) {
    totals.baleCount += Number(item.baleCount) || 0
    totals.totalCbm += Number(item.totalCbm) || 0
    totals.grossKg += Number(item.grossKg) || 0
    totals.netKg += Number(item.netKg) || 0
  }
  return {
    baleCount: Number(totals.baleCount.toFixed(0)),
    totalCbm: Number(totals.totalCbm.toFixed(2)),
    grossKg: Number(totals.grossKg.toFixed(0)),
    netKg: Number(totals.netKg.toFixed(0)),
  }
}

export function findPackingListForInvoice(invoice, documents) {
  if (!invoice || invoice.documentType !== 'invoice') {
    return null
  }
  const allDocuments = Array.isArray(documents) ? documents : []
  if (invoice.convertedPackingListId) {
    const linked = allDocuments.find(
      (document) =>
        document.id === invoice.convertedPackingListId && document.documentType === 'packing-list',
    )
    if (linked) {
      return linked
    }
  }
  return (
    allDocuments.find(
      (document) =>
        document.documentType === 'packing-list' && document.sourceInvoiceId === invoice.id,
    ) ?? null
  )
}

/** Backfill convertedPackingListId when a packing list exists but the invoice link is missing. */
export function withRepairedInvoicePackingListLinks(documents) {
  const allDocuments = Array.isArray(documents) ? documents : []
  const packingLists = allDocuments.filter((document) => document.documentType === 'packing-list')
  let changed = false
  const repaired = allDocuments.map((document) => {
    if (document.documentType !== 'invoice' || document.convertedPackingListId) {
      return document
    }
    const linkedPackingList = packingLists.find(
      (packingList) => packingList.sourceInvoiceId === document.id,
    )
    if (!linkedPackingList) {
      return document
    }
    changed = true
    return {
      ...document,
      convertedPackingListId: linkedPackingList.id,
      convertedAt: document.convertedAt ?? linkedPackingList.createdAt ?? null,
    }
  })
  return changed ? repaired : allDocuments
}

export function canConvertInvoiceToPackingList(invoice, documents) {
  if (invoice?.documentType !== 'invoice') {
    return false
  }
  if (invoice?.status !== 'finalized' && invoice?.status !== 'confirmed') {
    return false
  }
  return !findPackingListForInvoice(invoice, documents)
}

export function canFinalizePackingList(document) {
  return document?.documentType === 'packing-list' && document?.status === 'draft'
}

export function canEditPackingList(document) {
  return document?.documentType === 'packing-list' && document?.status === 'draft'
}

export function packingListLineIsCustom(item) {
  if (item?.isCustom === true) {
    return true
  }
  if (item?.isCustom === false) {
    return false
  }
  return isCustomPackingListProduct(item?.invoiceProduct ?? item?.product)
}

export function validatePackingListItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return ['Add at least one packing list line.']
  }
  const errors = []
  items.forEach((item, index) => {
    const line = index + 1
    const isCustom = packingListLineIsCustom(item)
    if (!String(item.product ?? '').trim()) {
      errors.push(`Line ${line}: product is required.`)
    }
    if (!String(item.description ?? '').trim()) {
      errors.push(`Line ${line}: description is required.`)
    }
    const baleCount = Number(item.baleCount)
    const totalCbm = Number(item.totalCbm)
    const grossKg = Number(item.grossKg)
    const netKg = Number(item.netKg)
    if (Number.isNaN(baleCount) || baleCount < 0) {
      errors.push(`Line ${line}: enter a valid bale or bag count.`)
    }
    if (Number.isNaN(totalCbm) || totalCbm < 0) {
      errors.push(`Line ${line}: enter a valid total CBM.`)
    }
    if (Number.isNaN(grossKg) || grossKg <= 0) {
      errors.push(`Line ${line}: enter a valid gross weight.`)
    }
    if (Number.isNaN(netKg) || netKg <= 0) {
      errors.push(`Line ${line}: enter a valid net weight.`)
    }
    if (!isCustom && (baleCount <= 0 || totalCbm <= 0 || grossKg <= 0)) {
      errors.push(
        `Line ${line}: could not calculate packing weights from the invoice. Check stock allocations on the invoice.`,
      )
    }
    if (isCustom && (baleCount <= 0 || totalCbm <= 0 || grossKg <= 0 || netKg <= 0)) {
      errors.push(`Line ${line}: enter bale/bag count, CBM, gross, and net for custom products.`)
    }
  })
  return errors
}

export function mapPackingListItemsToFormLines(items) {
  return (items ?? []).map((item, index) => {
    const isCustom = packingListLineIsCustom(item)
    return {
      id: `PL-LINE-${Date.now()}-${index + 1}`,
      product: item.product ?? '',
      invoiceProduct: item.invoiceProduct ?? item.product ?? '',
      isCustom,
      description: item.description ?? '',
      baleCount: item.baleCount === '' || item.baleCount == null ? '' : String(item.baleCount),
      totalCbm: item.totalCbm === '' || item.totalCbm == null ? '' : String(item.totalCbm),
      grossKg: item.grossKg === '' || item.grossKg == null ? '' : String(item.grossKg),
      netKg: item.netKg === '' || item.netKg == null ? '' : String(item.netKg),
    }
  })
}

export function normalizePackingListItemForSave(item) {
  const isCustom = packingListLineIsCustom(item)
  const invoiceProduct = String(item.invoiceProduct ?? item.product ?? '').trim().toUpperCase()
  const netKg = Number(item.netKg)
  const unitCount = Number(item.baleCount)

  if (!isCustom) {
    const measurements = calculatePackingListMeasurements({
      invoiceProduct,
      netKg,
      unitCount,
      isCustom: false,
    })
    return {
      product: String(item.product ?? '').trim(),
      invoiceProduct,
      isCustom: false,
      description: String(item.description ?? '').trim(),
      baleCount: Number(measurements.baleCount),
      totalCbm: Number(Number(measurements.totalCbm).toFixed(2)),
      grossKg: Number(Number(measurements.grossKg).toFixed(0)),
      netKg: Number(Number(measurements.netKg).toFixed(0)),
      autoCalculated: true,
    }
  }

  return {
    product: String(item.product ?? '').trim(),
    invoiceProduct,
    isCustom: true,
    description: String(item.description ?? '').trim(),
    baleCount: Number(item.baleCount),
    totalCbm: Number(Number(item.totalCbm).toFixed(2)),
    grossKg: Number(Number(item.grossKg).toFixed(0)),
    netKg: Number(Number(item.netKg).toFixed(0)),
    autoCalculated: false,
  }
}

export function buildPackingListInput(formState) {
  const items = (formState.lineItems ?? []).map((item) => normalizePackingListItemForSave(item))
  return {
    invoiceDate: formState.invoiceDate,
    origin: String(formState.origin ?? '').trim(),
    hsCode: String(formState.hsCode ?? '').trim(),
    items,
    totals: computePackingListTotals(items),
  }
}

export function getCommercialDocumentTypeLabel(document) {
  if (document?.documentType === 'proforma') {
    return 'Proforma'
  }
  if (document?.documentType === 'packing-list') {
    return 'Packing List'
  }
  return 'Invoice'
}

export function getCommercialDocumentStatusLabel(document, documents) {
  if (document?.documentType === 'proforma' && document?.status === 'converted') {
    return 'Converted to invoice'
  }
  if (document?.documentType === 'invoice' && findPackingListForInvoice(document, documents)) {
    if (document?.status === 'draft') {
      return 'Draft — re-finalize required'
    }
    return 'Packing list created'
  }
  if (document?.documentType === 'proforma') {
    return 'Draft'
  }
  if (document?.status === 'draft') {
    return 'Draft'
  }
  if (document?.status === 'finalized' || document?.status === 'confirmed') {
    return 'Finalized'
  }
  return document?.status ?? 'Unknown'
}
