export const FIRST_PO_NUMBER = 1001

export const PO_COST_CATEGORY_IDS = [
  'harvesting',
  'haulage',
  'decortication',
  'drying',
  'brushing',
  'baling',
  'silage',
  'staff-transport',
  'overheads',
  'assets',
]

export const PO_DEPARTMENT_COST_CATEGORY_IDS = [
  'harvesting',
  'haulage',
  'decortication',
  'drying',
  'brushing',
  'baling',
  'silage',
  'staff-transport',
]

export const PO_COST_SUMMARY_CATEGORY_IDS = [
  ...PO_DEPARTMENT_COST_CATEGORY_IDS,
  'overheads',
  'assets',
]

export const PO_COST_CATEGORY_LABELS = {
  harvesting: 'Harvesting',
  haulage: 'Haulage',
  decortication: 'Decortication',
  drying: 'Drying',
  brushing: 'Brushing',
  baling: 'Baling',
  silage: 'Silage',
  'staff-transport': 'Staff transport',
  overheads: 'Overheads',
  assets: 'Assets',
}

export const DEFAULT_PO_COST_CATEGORY = 'overheads'

export function normalizePoCostCategory(category) {
  const normalized = String(category ?? '').trim()
  return PO_COST_CATEGORY_IDS.includes(normalized) ? normalized : DEFAULT_PO_COST_CATEGORY
}

export function getPoCostCategoryLabel(category) {
  return PO_COST_CATEGORY_LABELS[normalizePoCostCategory(category)] ?? String(category ?? '—')
}

export function migratePurchaseOrderItem(item) {
  if (!item || typeof item !== 'object') {
    return item
  }
  return {
    ...item,
    costCategory: normalizePoCostCategory(item.costCategory),
  }
}

const PO_COST_SUMMARY_STATUSES = new Set(['authorized', 'received'])

export function summarizePoCostsByCategory(purchaseOrders, options = {}) {
  const { startDate, endDate, periodId, payPeriods } = options
  const totals = Object.fromEntries(PO_COST_SUMMARY_CATEGORY_IDS.map((id) => [id, 0]))
  let period = null
  if (periodId && Array.isArray(payPeriods)) {
    period = payPeriods.find((entry) => entry.id === periodId) ?? null
  }

  for (const po of purchaseOrders ?? []) {
    if (!po?.orderDate || !PO_COST_SUMMARY_STATUSES.has(po.status)) {
      continue
    }
    if (period && (po.orderDate < period.startDate || po.orderDate > period.endDate)) {
      continue
    }
    if (!period) {
      if (startDate && po.orderDate < startDate) {
        continue
      }
      if (endDate && po.orderDate > endDate) {
        continue
      }
    }
    for (const item of po.items ?? []) {
      const category = normalizePoCostCategory(item.costCategory)
      totals[category] = Number((totals[category] + Number(item.amount ?? 0)).toFixed(2))
    }
  }

  const grandTotal = Number(
    PO_COST_SUMMARY_CATEGORY_IDS.reduce((sum, categoryId) => sum + totals[categoryId], 0).toFixed(2),
  )
  return { totals, grandTotal, categories: PO_COST_SUMMARY_CATEGORY_IDS }
}

export function nextSupplierId(suppliers) {
  const maxNumber = (suppliers ?? []).reduce((max, supplier) => {
    const match = String(supplier.id ?? '').match(/^SUP-(\d+)$/)
    if (!match) {
      return max
    }
    return Math.max(max, Number(match[1]))
  }, 0)
  return `SUP-${String(maxNumber + 1).padStart(3, '0')}`
}

export function nextPurchaseOrderNumber(purchaseOrders) {
  const maxNumber = (purchaseOrders ?? []).reduce((max, po) => {
    const match = String(po.poNumber ?? '').match(/^(?:LPO|PO)-(\d+)$/)
    if (!match) {
      return max
    }
    return Math.max(max, Number(match[1]))
  }, FIRST_PO_NUMBER - 1)
  return `PO-${String(maxNumber + 1).padStart(4, '0')}`
}

export function normalizePurchaseOrderNumber(poNumber) {
  return String(poNumber ?? '').replace(/^LPO-/, 'PO-')
}

export function migratePurchaseOrder(po) {
  if (!po || typeof po !== 'object') {
    return po
  }
  return {
    ...po,
    poNumber: normalizePurchaseOrderNumber(po.poNumber),
    items: Array.isArray(po.items) ? po.items.map(migratePurchaseOrderItem) : [],
  }
}

export function computePoLineAmount(quantity, unitPrice) {
  const qty = Number(quantity)
  const price = Number(unitPrice)
  if (Number.isNaN(qty) || Number.isNaN(price)) {
    return 0
  }
  return Number((qty * price).toFixed(2))
}

export function computePoTotal(items) {
  return Number(
    (items ?? [])
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
      .toFixed(2),
  )
}

export function allItemsReceived(po) {
  return Array.isArray(po?.items) && po.items.length > 0 && po.items.every((item) => item.received)
}

export function getPoStatusLabel(status) {
  if (status === 'received') {
    return 'Finalized (received)'
  }
  if (status === 'authorized') {
    return 'Authorized'
  }
  return 'Draft'
}

export function canEmployeeAuthorizePo(employee, totalAmount, approvalLimits) {
  if (!employee || employee.role === 'inactive') {
    return false
  }
  if (employee.role === 'admin') {
    return true
  }
  const limit = approvalLimits?.[employee.id]
  if (limit === undefined || limit === null || limit === '') {
    return false
  }
  const limitValue = Number(limit)
  if (Number.isNaN(limitValue) || limitValue < 0) {
    return false
  }
  return totalAmount <= limitValue
}

export function getEmployeeApprovalLimitDisplay(employee, approvalLimits) {
  if (!employee) {
    return '—'
  }
  if (employee.role === 'admin') {
    return 'Unlimited (admin)'
  }
  const limit = approvalLimits?.[employee.id]
  if (limit === undefined || limit === null || limit === '') {
    return 'Not set'
  }
  return `KES ${Number(limit).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
}

export function buildPoItemsFromInput(lineItems, signInEmployeesById) {
  return lineItems.map((item) => {
    const receiver = signInEmployeesById.get(item.receiverEmployeeId)
    const quantity = Number(Number(item.quantity).toFixed(2))
    const unitPrice = Number(Number(item.unitPrice).toFixed(2))
    const amount = computePoLineAmount(quantity, unitPrice)
    return {
      id: item.id,
      description: String(item.description ?? '').trim(),
      quantity,
      unit: String(item.unit ?? '').trim(),
      unitPrice,
      amount,
      costCategory: normalizePoCostCategory(item.costCategory),
      receiverEmployeeId: receiver?.id ?? '',
      receiverEmployeeName: receiver?.name ?? '',
      received: Boolean(item.received),
      receivedAt: item.receivedAt ?? null,
      receivedById: item.receivedById ?? '',
      receivedByName: item.receivedByName ?? '',
    }
  })
}

export function isPurchaseOrderEditable(po) {
  return po?.status === 'draft' || po?.status === 'authorized'
}

export function isPurchaseOrderFinalized(po) {
  return po?.status === 'received'
}

export function canDeletePurchaseOrder(po) {
  return isPurchaseOrderEditable(po)
}

export function canEmployeeReceivePoItem(item, employeeId) {
  return Boolean(
    item &&
      employeeId &&
      !item.received &&
      String(item.receiverEmployeeId) === String(employeeId),
  )
}

export function buildPurchaseOrderDeletionAudit(po, deletedBy) {
  return {
    id: `PO-AUDIT-${Date.now()}`,
    action: 'deleted',
    poId: po.id,
    poNumber: po.poNumber,
    deletedAt: new Date().toISOString(),
    deletedById: deletedBy.id,
    deletedByName: deletedBy.name,
    snapshot: migratePurchaseOrder({ ...po }),
  }
}
