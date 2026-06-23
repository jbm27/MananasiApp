import { normalizeItemStockAllocations } from './invoiceStock.js'

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

export function estimateBaleCountFromAllocations(allocations, balingRecords) {
  const normalized = normalizeItemStockAllocations({ stockAllocations: allocations })
  let baleCount = 0
  for (const allocation of normalized) {
    if (allocation.stockForm !== 'Baled' || !allocation.stockCode) {
      continue
    }
    const seriesCode = allocation.stockCode
    const matchingBales = (balingRecords ?? []).filter((record) => record.baleSeriesCode === seriesCode)
    if (matchingBales.length > 0) {
      const avgBaleKg =
        matchingBales.reduce((sum, record) => sum + (record.baleWeightKg ?? 0), 0) /
        matchingBales.length
      if (avgBaleKg > 0) {
        baleCount += Math.round(Number(allocation.quantityKg) / avgBaleKg)
        continue
      }
    }
    baleCount += 1
  }
  return baleCount > 0 ? baleCount : ''
}

export function buildPackingListItemFromInvoiceLine(line, balingRecords) {
  const product = getPackingListProductCode(line.product)
  const description = formatPackingListDescription(line.description)
  const netKg = Number(line.quantityKg) || 0
  const baleCount = estimateBaleCountFromAllocations(line.stockAllocations, balingRecords)
  return {
    product,
    description,
    baleCount: baleCount === '' ? '' : baleCount,
    totalCbm: '',
    grossKg: '',
    netKg,
  }
}

export function buildPackingListFromInvoice(invoice, balingRecords = []) {
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
    items: (invoice.items ?? []).map((line) => buildPackingListItemFromInvoiceLine(line, balingRecords)),
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

export function canConvertInvoiceToPackingList(invoice) {
  if (invoice?.documentType !== 'invoice') {
    return false
  }
  if (invoice?.status !== 'finalized' && invoice?.status !== 'confirmed') {
    return false
  }
  return !invoice?.convertedPackingListId
}

export function canFinalizePackingList(document) {
  return document?.documentType === 'packing-list' && document?.status === 'draft'
}

export function canEditPackingList(document) {
  return document?.documentType === 'packing-list' && document?.status === 'draft'
}

export function validatePackingListItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return ['Add at least one packing list line.']
  }
  const errors = []
  items.forEach((item, index) => {
    const line = index + 1
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
      errors.push(`Line ${line}: enter a valid bale count.`)
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
  })
  return errors
}

export function mapPackingListItemsToFormLines(items) {
  return (items ?? []).map((item, index) => ({
    id: `PL-LINE-${Date.now()}-${index + 1}`,
    product: item.product ?? '',
    description: item.description ?? '',
    baleCount: item.baleCount === '' || item.baleCount == null ? '' : String(item.baleCount),
    totalCbm: item.totalCbm === '' || item.totalCbm == null ? '' : String(item.totalCbm),
    grossKg: item.grossKg === '' || item.grossKg == null ? '' : String(item.grossKg),
    netKg: item.netKg === '' || item.netKg == null ? '' : String(item.netKg),
  }))
}

export function buildPackingListInput(formState) {
  const items = (formState.lineItems ?? []).map((item) => ({
    product: String(item.product ?? '').trim(),
    description: String(item.description ?? '').trim(),
    baleCount: Number(item.baleCount),
    totalCbm: Number(Number(item.totalCbm).toFixed(2)),
    grossKg: Number(Number(item.grossKg).toFixed(0)),
    netKg: Number(Number(item.netKg).toFixed(0)),
  }))
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

export function getCommercialDocumentStatusLabel(document) {
  if (document?.documentType === 'proforma' && document?.status === 'converted') {
    return 'Converted to invoice'
  }
  if (document?.documentType === 'invoice' && document?.convertedPackingListId) {
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
