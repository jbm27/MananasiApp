export const FIRST_PO_NUMBER = 1001

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
    const match = String(po.poNumber ?? '').match(/^LPO-(\d+)$/)
    if (!match) {
      return max
    }
    return Math.max(max, Number(match[1]))
  }, FIRST_PO_NUMBER - 1)
  return `LPO-${String(maxNumber + 1).padStart(4, '0')}`
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
  return po?.status === 'draft'
}
