import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import logoStandard from '../LogoStandard.png'
import { formatKenyaDateTime } from './kenyaTime.js'
import {
  drawMananasiCompanyHeader,
  drawPdfField,
  formatDisplayDate,
} from './documentPdfHeader.js'
import {
  allItemsReceived,
  canEmployeeAuthorizePo,
  computePoLineAmount,
  computePoTotal,
  getEmployeeApprovalLimitDisplay,
  getPoStatusLabel,
  isPurchaseOrderEditable,
} from './procurement.js'

function CollapsibleSection({ title, isOpen, onToggle, children }) {
  return (
    <section className="collapsible-section">
      <button type="button" className="section-toggle" onClick={onToggle}>
        <span>{title}</span>
        <span>{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen ? <div className="section-content">{children}</div> : null}
    </section>
  )
}

function emptyLineItem(signInEmployees) {
  return {
    id: `PO-LINE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: '',
    quantity: '',
    unit: 'each',
    unitPrice: '',
    receiverEmployeeId: signInEmployees[0]?.id ?? '',
    received: false,
    receivedAt: null,
    receivedById: '',
    receivedByName: '',
  }
}

function mapPoItemsToLineItems(items) {
  return (items ?? []).map((item) => ({
    id: item.id,
    description: item.description ?? '',
    quantity: String(item.quantity ?? ''),
    unit: item.unit ?? 'each',
    unitPrice: String(item.unitPrice ?? ''),
    receiverEmployeeId: item.receiverEmployeeId ?? '',
    received: Boolean(item.received),
    receivedAt: item.receivedAt ?? null,
    receivedById: item.receivedById ?? '',
    receivedByName: item.receivedByName ?? '',
  }))
}

async function printPurchaseOrderPdf(purchaseOrder, supplier) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const { left, top, right, contentWidth } = await drawMananasiCompanyHeader(pdf, logoStandard)
  const metaLabelX = left + 92
  const metaValueX = left + 122
  const labelX = left
  const valueX = left + 36
  const valueWidth = contentWidth - 36
  const lineHeight = 5

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('Purchase order to:', left, top + 55)
  pdf.setFontSize(9)
  pdf.text('LPO number:', metaLabelX, top + 55)
  pdf.setFont('helvetica', 'normal')
  pdf.text(String(purchaseOrder.poNumber), metaValueX, top + 55)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Date:', metaLabelX, top + 62)
  pdf.setFont('helvetica', 'normal')
  pdf.text(formatDisplayDate(purchaseOrder.orderDate), metaValueX, top + 62)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Status:', metaLabelX, top + 69)
  pdf.setFont('helvetica', 'normal')
  pdf.text(getPoStatusLabel(purchaseOrder.status), metaValueX, top + 69)

  pdf.setFont('helvetica', 'bold')
  pdf.text(purchaseOrder.supplierName ?? supplier?.name ?? '—', left, top + 62)
  pdf.setFont('helvetica', 'normal')
  const supplierAddress = [
    supplier?.addressLine1,
    supplier?.addressLine2,
    supplier?.city,
    supplier?.postCode,
    supplier?.country,
  ]
    .filter(Boolean)
    .join(', ')
  const supplierLines = pdf.splitTextToSize(supplierAddress || '—', 78)
  pdf.text(supplierLines, left, top + 68)
  const supplierBlockHeight = Math.max(supplierLines.length, 1) * lineHeight
  let supplierDetailY = top + 68 + supplierBlockHeight + 2
  if (supplier?.companyRegistration) {
    pdf.text(`Company registration: ${supplier.companyRegistration}`, left, supplierDetailY)
    supplierDetailY += lineHeight
  }
  if (supplier?.phone || supplier?.email) {
    pdf.text([supplier?.phone, supplier?.email].filter(Boolean).join(' · '), left, supplierDetailY)
  }

  const tableTop = top + 88
  const rowH = 7
  const itemCount = purchaseOrder.items.length
  const tableRowCount = itemCount + 2
  const colX = {
    description: left,
    qty: left + 52,
    unit: left + 68,
    rate: left + 82,
    amount: left + 104,
    receiver: left + 128,
    end: right,
  }

  pdf.setDrawColor(0)
  pdf.setLineWidth(0.5)
  pdf.rect(left, tableTop, contentWidth, rowH * tableRowCount)
  ;[colX.qty, colX.unit, colX.rate, colX.amount, colX.receiver].forEach((x) => {
    pdf.line(x, tableTop, x, tableTop + rowH * tableRowCount)
  })
  for (let rowIndex = 1; rowIndex < tableRowCount; rowIndex += 1) {
    pdf.line(left, tableTop + rowH * rowIndex, right, tableTop + rowH * rowIndex)
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('Description', colX.description + 1, tableTop + 4.8)
  pdf.text('Qty', colX.qty + 1, tableTop + 4.8)
  pdf.text('Unit', colX.unit + 1, tableTop + 4.8)
  pdf.text('Unit price', colX.rate + 1, tableTop + 4.8)
  pdf.text('Amount', colX.amount + 1, tableTop + 4.8)
  pdf.text('Receiver', colX.receiver + 1, tableTop + 4.8)

  pdf.setFont('helvetica', 'normal')
  purchaseOrder.items.forEach((item, index) => {
    const y = tableTop + rowH * (index + 1) + 4.8
    pdf.text(pdf.splitTextToSize(String(item.description), 50)[0] ?? '', colX.description + 1, y)
    pdf.text(String(item.quantity), colX.qty + 1, y)
    pdf.text(String(item.unit), colX.unit + 1, y)
    pdf.text(String(item.unitPrice.toFixed(2)), colX.rate + 1, y)
    pdf.text(
      `KES ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      colX.amount + 1,
      y,
    )
    pdf.text(pdf.splitTextToSize(String(item.receiverEmployeeName ?? ''), 24)[0] ?? '', colX.receiver + 1, y)
  })

  const totalRowY = tableTop + rowH * (itemCount + 1)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Total', colX.rate + 1, totalRowY + 4.8)
  pdf.text(
    `KES ${purchaseOrder.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    colX.amount + 1,
    totalRowY + 4.8,
  )

  let footerY = tableTop + rowH * tableRowCount + 10
  if (purchaseOrder.generalNotes?.trim()) {
    footerY = drawPdfField(pdf, {
      labelX,
      valueX,
      valueWidth,
      y: footerY,
      lineHeight,
      label: 'Notes:',
      value: purchaseOrder.generalNotes.trim(),
    })
    footerY += 3
  }
  footerY = drawPdfField(pdf, {
    labelX,
    valueX,
    valueWidth,
    y: footerY,
    lineHeight,
    label: 'Authorised by:',
    value: purchaseOrder.authorizedByName ?? '—',
  })
  if (purchaseOrder.authorizedAt) {
    footerY += 3
    footerY = drawPdfField(pdf, {
      labelX,
      valueX,
      valueWidth,
      y: footerY,
      lineHeight,
      label: 'Authorised on:',
      value: formatKenyaDateTime(purchaseOrder.authorizedAt),
    })
  }

  pdf.save(`${purchaseOrder.poNumber}.pdf`)
}

export default function ProcurementPage({
  suppliers,
  purchaseOrders,
  lpoApprovalLimits,
  signInEmployees,
  currentUser,
  canManageProcurement,
  canSetApprovalLimits,
  readOnly = false,
  onAddSupplier,
  onUpdateSupplier,
  onCreatePurchaseOrder,
  onUpdatePurchaseOrder,
  onAuthorizePurchaseOrder,
  onMarkPoItemReceived,
  onSetLpoApprovalLimit,
}) {
  const [supplierFormOpen, setSupplierFormOpen] = useState(true)
  const [poFormOpen, setPoFormOpen] = useState(true)
  const [limitsFormOpen, setLimitsFormOpen] = useState(false)

  const [supplierName, setSupplierName] = useState('')
  const [supplierAddressLine1, setSupplierAddressLine1] = useState('')
  const [supplierAddressLine2, setSupplierAddressLine2] = useState('')
  const [supplierCity, setSupplierCity] = useState('')
  const [supplierPostCode, setSupplierPostCode] = useState('')
  const [supplierCountry, setSupplierCountry] = useState('Kenya')
  const [supplierEmail, setSupplierEmail] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [supplierCompanyRegistration, setSupplierCompanyRegistration] = useState('')
  const [editingSupplierId, setEditingSupplierId] = useState('')
  const [supplierStatus, setSupplierStatus] = useState('')

  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [generalNotes, setGeneralNotes] = useState('')
  const [selectedSupplierId, setSelectedSupplierId] = useState(suppliers[0]?.id ?? '')
  const [lineItems, setLineItems] = useState([])
  const [editingPoId, setEditingPoId] = useState('')
  const [selectedPoId, setSelectedPoId] = useState('')
  const [formStatus, setFormStatus] = useState('')

  const [limitDrafts, setLimitDrafts] = useState({})
  const [limitsStatus, setLimitsStatus] = useState('')

  const sortedPurchaseOrders = useMemo(
    () =>
      [...purchaseOrders].sort((a, b) =>
        a.createdAt === b.createdAt
          ? String(b.poNumber).localeCompare(String(a.poNumber))
          : b.createdAt.localeCompare(a.createdAt),
      ),
    [purchaseOrders],
  )

  const selectedPo =
    sortedPurchaseOrders.find((item) => item.id === selectedPoId) ??
    sortedPurchaseOrders[0] ??
    null

  const selectedSupplier = suppliers.find((item) => item.id === selectedSupplierId) ?? null

  const computedLineItems = lineItems.map((item) => {
    const amount = computePoLineAmount(item.quantity, item.unitPrice)
    return { ...item, amount }
  })
  const poTotal = computePoTotal(computedLineItems)

  const canAuthorizeSelected =
    selectedPo &&
    selectedPo.status === 'draft' &&
    canEmployeeAuthorizePo(currentUser, selectedPo.totalAmount, lpoApprovalLimits)

  useEffect(() => {
    if (lineItems.length === 0 && signInEmployees.length > 0) {
      setLineItems([emptyLineItem(signInEmployees)])
    }
  }, [lineItems.length, signInEmployees])

  useEffect(() => {
    if (!selectedSupplierId && suppliers[0]?.id) {
      setSelectedSupplierId(suppliers[0].id)
    }
  }, [suppliers, selectedSupplierId])

  useEffect(() => {
    if (selectedPo && !selectedPoId) {
      setSelectedPoId(selectedPo.id)
    }
  }, [selectedPo, selectedPoId])

  function resetSupplierForm() {
    setEditingSupplierId('')
    setSupplierName('')
    setSupplierAddressLine1('')
    setSupplierAddressLine2('')
    setSupplierCity('')
    setSupplierPostCode('')
    setSupplierCountry('Kenya')
    setSupplierEmail('')
    setSupplierPhone('')
    setSupplierCompanyRegistration('')
  }

  function startEditingSupplier(supplier) {
    if (readOnly || !canManageProcurement) {
      return
    }
    setEditingSupplierId(supplier.id)
    setSupplierName(supplier.name ?? '')
    setSupplierAddressLine1(supplier.addressLine1 ?? '')
    setSupplierAddressLine2(supplier.addressLine2 ?? '')
    setSupplierCity(supplier.city ?? '')
    setSupplierPostCode(supplier.postCode ?? '')
    setSupplierCountry(supplier.country ?? 'Kenya')
    setSupplierEmail(supplier.email ?? '')
    setSupplierPhone(supplier.phone ?? '')
    setSupplierCompanyRegistration(supplier.companyRegistration ?? '')
    setSupplierStatus(`Editing ${supplier.name} (${supplier.id}).`)
    setSupplierFormOpen(true)
  }

  function buildSupplierInput() {
    return {
      name: supplierName.trim(),
      addressLine1: supplierAddressLine1.trim(),
      addressLine2: supplierAddressLine2.trim(),
      city: supplierCity.trim(),
      postCode: supplierPostCode.trim(),
      country: supplierCountry.trim(),
      email: supplierEmail.trim(),
      phone: supplierPhone.trim(),
      companyRegistration: supplierCompanyRegistration.trim(),
    }
  }

  function handleSaveSupplierSubmit(event) {
    event.preventDefault()
    if (readOnly || !canManageProcurement) {
      return
    }
    const missingFields = []
    if (!supplierName.trim()) {
      missingFields.push('Supplier name')
    }
    if (!supplierAddressLine1.trim()) {
      missingFields.push('Address line 1')
    }
    if (!supplierCity.trim()) {
      missingFields.push('City')
    }
    if (!supplierCountry.trim()) {
      missingFields.push('Country')
    }
    if (missingFields.length > 0) {
      setSupplierStatus(`Please fill in: ${missingFields.join(', ')}.`)
      return
    }
    const input = buildSupplierInput()
    if (editingSupplierId) {
      const updated = onUpdateSupplier(editingSupplierId, input)
      if (!updated) {
        setSupplierStatus('This supplier could not be updated.')
        return
      }
      resetSupplierForm()
      setSupplierStatus(`Supplier "${updated.name}" updated.`)
      return
    }
    onAddSupplier(input)
    resetSupplierForm()
    setSupplierStatus(`Supplier "${input.name}" added.`)
  }

  function handleAddLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem(signInEmployees)])
  }

  function handleRemoveLineItem(lineId) {
    setLineItems((prev) => prev.filter((item) => item.id !== lineId))
  }

  function handleLineItemChange(lineId, field, value) {
    setLineItems((prev) =>
      prev.map((item) => (item.id === lineId ? { ...item, [field]: value } : item)),
    )
  }

  function resetPoForm() {
    setEditingPoId('')
    setOrderDate(new Date().toISOString().slice(0, 10))
    setGeneralNotes('')
    setSelectedSupplierId(suppliers[0]?.id ?? '')
    setLineItems(signInEmployees.length > 0 ? [emptyLineItem(signInEmployees)] : [])
    setFormStatus('')
  }

  function startEditingPo(po) {
    if (readOnly || !canManageProcurement) {
      return
    }
    if (!isPurchaseOrderEditable(po)) {
      setFormStatus('Only draft purchase orders can be edited.')
      return
    }
    setEditingPoId(po.id)
    setOrderDate(po.orderDate)
    setGeneralNotes(po.generalNotes ?? '')
    setSelectedSupplierId(po.supplierId)
    setLineItems(mapPoItemsToLineItems(po.items))
    setFormStatus(`Editing ${po.poNumber}.`)
    setSelectedPoId(po.id)
    setPoFormOpen(true)
  }

  function buildPoInput() {
    return {
      orderDate,
      supplierId: selectedSupplier?.id ?? '',
      supplierName: selectedSupplier?.name ?? '',
      generalNotes: generalNotes.trim(),
      items: computedLineItems.map((item) => ({
        id: item.id,
        description: item.description.trim(),
        quantity: Number(Number(item.quantity).toFixed(2)),
        unit: item.unit.trim(),
        unitPrice: Number(Number(item.unitPrice).toFixed(2)),
        amount: item.amount,
        receiverEmployeeId: item.receiverEmployeeId,
        received: item.received,
        receivedAt: item.receivedAt,
        receivedById: item.receivedById,
        receivedByName: item.receivedByName,
      })),
      totalAmount: poTotal,
    }
  }

  function handleSavePurchaseOrder(event) {
    event.preventDefault()
    if (readOnly || !canManageProcurement) {
      return
    }
    if (!selectedSupplier) {
      setFormStatus('Select a supplier before saving.')
      return
    }
    const hasInvalidLine = computedLineItems.some((item) => {
      const quantityValue = Number(item.quantity)
      const unitPriceValue = Number(item.unitPrice)
      return (
        !item.description.trim() ||
        !item.receiverEmployeeId ||
        Number.isNaN(quantityValue) ||
        Number.isNaN(unitPriceValue) ||
        quantityValue <= 0 ||
        unitPriceValue < 0 ||
        !item.unit.trim()
      )
    })
    if (!orderDate || computedLineItems.length === 0 || hasInvalidLine) {
      setFormStatus('Complete all lines with description, quantity, unit price, unit, and receiver.')
      return
    }
    if (editingPoId) {
      const updated = onUpdatePurchaseOrder(editingPoId, buildPoInput())
      if (!updated) {
        setFormStatus('This purchase order could not be updated. Only drafts can be edited.')
        return
      }
      setSelectedPoId(updated.id)
      setEditingPoId('')
      setFormStatus(`${updated.poNumber} updated.`)
      return
    }
    const created = onCreatePurchaseOrder(buildPoInput())
    setSelectedPoId(created.id)
    setFormStatus(`${created.poNumber} created as draft.`)
  }

  function handleAuthorize() {
    if (!selectedPo || readOnly) {
      return
    }
    const result = onAuthorizePurchaseOrder(selectedPo.id, currentUser.id)
    if (!result.ok) {
      setFormStatus(result.message)
      return
    }
    if (editingPoId === selectedPo.id) {
      resetPoForm()
    }
    setFormStatus(result.message)
  }

  function handleMarkReceived(itemId) {
    if (!selectedPo || readOnly || !canManageProcurement) {
      return
    }
    const result = onMarkPoItemReceived(selectedPo.id, itemId, currentUser.id)
    if (!result.ok) {
      setFormStatus(result.message)
      return
    }
    setFormStatus(result.message)
  }

  async function handlePrintPdf() {
    if (!selectedPo || selectedPo.status === 'draft') {
      setFormStatus('PDF is available after the purchase order is authorised.')
      return
    }
    const supplier = suppliers.find((item) => item.id === selectedPo.supplierId)
    await printPurchaseOrderPdf(selectedPo, supplier)
  }

  function handleSaveApprovalLimits(event) {
    event.preventDefault()
    if (!canSetApprovalLimits || readOnly) {
      return
    }
    signInEmployees.forEach((employee) => {
      if (employee.role === 'admin') {
        return
      }
      const raw = limitDrafts[employee.id]
      if (raw === undefined) {
        return
      }
      const trimmed = String(raw).trim()
      if (trimmed === '') {
        onSetLpoApprovalLimit(employee.id, null)
        return
      }
      const value = Number(trimmed)
      if (Number.isNaN(value) || value < 0) {
        return
      }
      onSetLpoApprovalLimit(employee.id, value)
    })
    setLimitsStatus('Approval limits saved.')
  }

  return (
    <section className="panel">
      <h2>Procurement</h2>
      <p>Create local purchase orders (LPOs), register suppliers, assign receivers, and track receipt.</p>

      {readOnly ? (
        <p className="inline-hint">Director view: procurement records are read-only. You can view and print authorised LPOs.</p>
      ) : null}

      <CollapsibleSection
        title={editingSupplierId ? 'Edit supplier' : 'Add supplier'}
        isOpen={supplierFormOpen}
        onToggle={() => setSupplierFormOpen((open) => !open)}
      >
        {readOnly || !canManageProcurement ? (
          <p className="inline-hint">You do not have permission to manage suppliers.</p>
        ) : (
          <form className="stacked-form" onSubmit={handleSaveSupplierSubmit}>
            <label>
              Supplier name (required)
              <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required />
            </label>
            <label>
              Address line 1 (required)
              <input
                value={supplierAddressLine1}
                onChange={(event) => setSupplierAddressLine1(event.target.value)}
                required
              />
            </label>
            <label>
              Address line 2
              <input
                value={supplierAddressLine2}
                onChange={(event) => setSupplierAddressLine2(event.target.value)}
              />
            </label>
            <label>
              City (required)
              <input value={supplierCity} onChange={(event) => setSupplierCity(event.target.value)} required />
            </label>
            <label>
              Post code
              <input value={supplierPostCode} onChange={(event) => setSupplierPostCode(event.target.value)} />
            </label>
            <label>
              Country (required)
              <input value={supplierCountry} onChange={(event) => setSupplierCountry(event.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={supplierEmail} onChange={(event) => setSupplierEmail(event.target.value)} />
            </label>
            <label>
              Phone
              <input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} />
            </label>
            <label>
              Company registration
              <input
                value={supplierCompanyRegistration}
                onChange={(event) => setSupplierCompanyRegistration(event.target.value)}
              />
            </label>
            <div className="form-actions">
              <button type="submit">{editingSupplierId ? 'Update supplier' : 'Add supplier'}</button>
              {editingSupplierId ? (
                <button type="button" onClick={() => {
                  resetSupplierForm()
                  setSupplierStatus('')
                }}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        )}
        {supplierStatus ? <div className="placeholder">{supplierStatus}</div> : null}

        <h3>Supplier register</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Address</th>
                <th>Registration</th>
                <th>Contact</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>{supplier.id}</td>
                  <td>{supplier.name}</td>
                  <td>
                    {[supplier.addressLine1, supplier.addressLine2, supplier.city, supplier.postCode, supplier.country]
                      .filter(Boolean)
                      .join(', ')}
                  </td>
                  <td>{supplier.companyRegistration || 'N/A'}</td>
                  <td>
                    {[supplier.phone, supplier.email].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>
                    {canManageProcurement && !readOnly ? (
                      <button type="button" onClick={() => startEditingSupplier(supplier)}>
                        Edit
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan="6">No suppliers yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {canSetApprovalLimits ? (
        <CollapsibleSection
          title="LPO approval limits"
          isOpen={limitsFormOpen}
          onToggle={() => setLimitsFormOpen((open) => !open)}
        >
          <p>Set the maximum KES amount each sign-in employee may authorise on a purchase order.</p>
          <form className="stacked-form" onSubmit={handleSaveApprovalLimits}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Current limit</th>
                    <th>Max amount (KES)</th>
                  </tr>
                </thead>
                <tbody>
                  {signInEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        {employee.name} ({employee.id})
                      </td>
                      <td>{getEmployeeApprovalLimitDisplay(employee, lpoApprovalLimits)}</td>
                      <td>
                        {employee.role === 'admin' ? (
                          'Unlimited'
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Not set"
                            value={
                              limitDrafts[employee.id] ??
                              (lpoApprovalLimits[employee.id] !== undefined &&
                              lpoApprovalLimits[employee.id] !== null
                                ? String(lpoApprovalLimits[employee.id])
                                : '')
                            }
                            onChange={(event) =>
                              setLimitDrafts((prev) => ({
                                ...prev,
                                [employee.id]: event.target.value,
                              }))
                            }
                            disabled={readOnly}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!readOnly ? <button type="submit">Save approval limits</button> : null}
          </form>
          {limitsStatus ? <div className="placeholder">{limitsStatus}</div> : null}
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection
        title={editingPoId ? 'Edit purchase order' : 'Create purchase order'}
        isOpen={poFormOpen}
        onToggle={() => setPoFormOpen((open) => !open)}
      >
        {readOnly || !canManageProcurement ? (
          <p className="inline-hint">You do not have permission to create or edit purchase orders.</p>
        ) : (
          <form className="stacked-form" onSubmit={handleSavePurchaseOrder}>
            <label>
              Order date
              <input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} required />
            </label>
            <label>
              Supplier
              <select
                value={selectedSupplierId}
                onChange={(event) => setSelectedSupplierId(event.target.value)}
                required
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} ({supplier.id})
                  </option>
                ))}
              </select>
            </label>
            {suppliers.length === 0 ? (
              <p className="inline-hint">Add a supplier before creating a purchase order.</p>
            ) : null}

            <label>
              General notes
              <textarea
                value={generalNotes}
                onChange={(event) => setGeneralNotes(event.target.value)}
                rows={4}
                placeholder="Delivery instructions, payment terms, or other notes for this LPO"
              />
            </label>

            <h4>Line items</h4>
            {computedLineItems.map((item, index) => (
              <div key={item.id} className="form-grid" style={{ marginBottom: '1rem' }}>
                <label>
                  Description
                  <input
                    value={item.description}
                    onChange={(event) => handleLineItemChange(item.id, 'description', event.target.value)}
                    required
                  />
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={item.quantity}
                    onChange={(event) => handleLineItemChange(item.id, 'quantity', event.target.value)}
                    required
                  />
                </label>
                <label>
                  Unit
                  <input
                    value={item.unit}
                    onChange={(event) => handleLineItemChange(item.id, 'unit', event.target.value)}
                    placeholder="each, kg, litres…"
                    required
                  />
                </label>
                <label>
                  Unit price (KES)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(event) => handleLineItemChange(item.id, 'unitPrice', event.target.value)}
                    required
                  />
                </label>
                <label>
                  Receiver (sign-in account)
                  <select
                    value={item.receiverEmployeeId}
                    onChange={(event) =>
                      handleLineItemChange(item.id, 'receiverEmployeeId', event.target.value)
                    }
                    required
                  >
                    <option value="">Select receiver</option>
                    {signInEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Line total (KES)
                  <input value={item.amount.toFixed(2)} readOnly />
                </label>
                {computedLineItems.length > 1 ? (
                  <button type="button" onClick={() => handleRemoveLineItem(item.id)}>
                    Remove line {index + 1}
                  </button>
                ) : null}
              </div>
            ))}
            <button type="button" onClick={handleAddLineItem}>
              Add line item
            </button>
            <p>
              <strong>Order total:</strong> KES {poTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <div className="form-actions">
              <button type="submit" disabled={suppliers.length === 0 || signInEmployees.length === 0}>
                {editingPoId ? 'Update draft LPO' : 'Save draft LPO'}
              </button>
              {editingPoId ? (
                <button type="button" onClick={resetPoForm}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        )}
        {signInEmployees.length === 0 ? (
          <p className="inline-hint">No sign-in employees available for receiver assignment.</p>
        ) : null}
      </CollapsibleSection>

      <h3>Purchase order register</h3>
      {formStatus ? <div className="placeholder">{formStatus}</div> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>LPO #</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Total (KES)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedPurchaseOrders.map((po) => (
              <tr key={po.id} className={po.id === selectedPo?.id ? 'selected-row' : undefined}>
                <td>
                  <button type="button" className="link-button" onClick={() => setSelectedPoId(po.id)}>
                    {po.poNumber}
                  </button>
                </td>
                <td>{formatDisplayDate(po.orderDate)}</td>
                <td>{po.supplierName}</td>
                <td>{po.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>{getPoStatusLabel(po.status)}</td>
                <td>
                  {isPurchaseOrderEditable(po) && canManageProcurement && !readOnly ? (
                    <button type="button" onClick={() => startEditingPo(po)}>
                      Edit
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {sortedPurchaseOrders.length === 0 ? (
              <tr>
                <td colSpan="6">No purchase orders yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedPo ? (
        <section className="panel nested-panel">
          <h3>{selectedPo.poNumber}</h3>
          <p>
            Supplier: {selectedPo.supplierName} · Status: {getPoStatusLabel(selectedPo.status)} · Total: KES{' '}
            {selectedPo.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          {selectedPo.authorizedByName ? (
            <p>
              Authorised by {selectedPo.authorizedByName}
              {selectedPo.authorizedAt ? ` on ${formatKenyaDateTime(selectedPo.authorizedAt)}` : ''}
            </p>
          ) : null}
          {selectedPo.finalizedAt ? (
            <p>Finalised (all items received) on {formatKenyaDateTime(selectedPo.finalizedAt)}</p>
          ) : null}
          {selectedPo.generalNotes?.trim() ? (
            <p>
              <strong>Notes:</strong> {selectedPo.generalNotes.trim()}
            </p>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Unit price</th>
                  <th>Amount</th>
                  <th>Receiver</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {selectedPo.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>{item.quantity}</td>
                    <td>{item.unit}</td>
                    <td>{item.unitPrice.toFixed(2)}</td>
                    <td>{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td>{item.receiverEmployeeName || '—'}</td>
                    <td>
                      {item.received ? (
                        <>
                          Yes
                          {item.receivedAt ? ` (${formatKenyaDateTime(item.receivedAt)})` : ''}
                        </>
                      ) : selectedPo.status !== 'draft' && canManageProcurement && !readOnly ? (
                        <button type="button" onClick={() => handleMarkReceived(item.id)}>
                          Mark received
                        </button>
                      ) : (
                        'No'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            {selectedPo.status === 'draft' && canAuthorizeSelected && !readOnly ? (
              <button type="button" onClick={handleAuthorize}>
                Authorise LPO
              </button>
            ) : null}
            {selectedPo.status !== 'draft' ? (
              <button type="button" onClick={handlePrintPdf}>
                Download PDF
              </button>
            ) : null}
            {selectedPo.status === 'draft' && !canAuthorizeSelected && !readOnly ? (
              <p className="inline-hint">
                Your approval limit: {getEmployeeApprovalLimitDisplay(currentUser, lpoApprovalLimits)}. Total KES{' '}
                {selectedPo.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} exceeds your limit or
                no limit is set.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  )
}
