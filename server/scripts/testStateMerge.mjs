import assert from 'node:assert/strict'
import { mergeIncomingAppState, mergeRecordsById } from '../stateMerge.js'

const current = {
  invoiceDocuments: [{ id: 'INV-1', documentNumber: '1001' }],
  records: [{ id: 'H-1', kg: 10 }],
  mileageByDate: { '2026-07-01': 12 },
  purchaseOrders: [{ id: 'PO-1', poNumber: 'PO-1001' }],
  purchaseOrderAuditLog: [],
  deletedEntityIds: {},
}

const incoming = {
  invoiceDocuments: [{ id: 'INV-2', documentNumber: '1002' }],
  records: [{ id: 'H-1', kg: 15 }, { id: 'H-2', kg: 8 }],
  mileageByDate: { '2026-07-02': 5 },
  purchaseOrders: [],
  purchaseOrderAuditLog: [
    { id: 'AUD-1', action: 'deleted', poId: 'PO-1', poNumber: 'PO-1001' },
  ],
}

const merged = mergeIncomingAppState(current, incoming)

assert.equal(merged.invoiceDocuments.length, 2, 'invoices must union-merge')
assert.ok(merged.invoiceDocuments.some((item) => item.id === 'INV-1'))
assert.ok(merged.invoiceDocuments.some((item) => item.id === 'INV-2'))
assert.equal(merged.records.find((item) => item.id === 'H-1').kg, 15)
assert.ok(merged.records.some((item) => item.id === 'H-2'))
assert.equal(merged.mileageByDate['2026-07-01'], 12)
assert.equal(merged.mileageByDate['2026-07-02'], 5)
assert.equal(merged.purchaseOrders.length, 0, 'deleted POs must stay deleted')
assert.deepEqual(merged.deletedEntityIds.purchaseOrders, ['PO-1'])

assert.deepEqual(
  mergeRecordsById([{ id: 'A' }], null).map((item) => item.id),
  ['A'],
)
assert.deepEqual(
  mergeRecordsById([{ id: 'A' }], []).map((item) => item.id),
  ['A'],
)

console.log('stateMerge safeguards ok')
