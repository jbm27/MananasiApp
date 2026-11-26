import { useMemo, useState } from 'react'
import { compareEmployeesByName } from './employeeFields.js'
import CollapsibleSection from './CollapsibleSection.jsx'
import {
  SHIFT_NUMBERS,
  batchFromTraceableStockCode,
  formatDisplayDate,
  formatEfficiencyRatio,
  isPpurLooseStockCode,
  isReceivablePurificationStock,
  nextPurificationRunNumber,
  normalizeBatchNumber,
  ppurStockCode,
  purificationOutputStockCode,
  selectBalesToBreak,
} from './fibreFinishing.js'

const EMPTY_FORM = {
  date: '',
  shiftNumber: '1',
  supervisorId: '',
  operatorIds: [],
  sourceStockCode: '',
  inputKg: '',
  outputKg: '',
  waterLitres: '',
}

function staffingWarnings(supervisorId, operatorCount) {
  const warnings = []
  if (!supervisorId) {
    warnings.push('No reactor supervisor selected.')
  }
  if (operatorCount === 0) {
    warnings.push('No reactor operators selected.')
  }
  return warnings
}

function stockOptionsForEntry(looseStockOptions, selectedBatchFilter, currentCode, reserved) {
  const ubrOptions = (looseStockOptions ?? []).filter((item) => isPpurLooseStockCode(item.stockCode))
  const filtered =
    selectedBatchFilter === 'all'
      ? [...ubrOptions]
      : ubrOptions.filter((item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter)
  for (const code of [currentCode, reserved?.code].filter(Boolean)) {
    if (filtered.some((item) => item.stockCode === code)) {
      continue
    }
    const existing = ubrOptions.find((item) => item.stockCode === code)
    filtered.push(
      existing ?? {
        stockCode: code,
        batchNumber: batchFromTraceableStockCode(code),
        totalKg: 0,
      },
    )
  }
  return filtered
    .map((option) =>
      reserved?.code === option.stockCode && reserved.kg > 0
        ? {
            ...option,
            totalKg: Number((Number(option.totalKg) + Number(reserved.kg)).toFixed(1)),
          }
        : option,
    )
    .sort((a, b) => a.stockCode.localeCompare(b.stockCode))
}

export default function PurificationPage({
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  purificationRuns,
  purificationReceipts = [],
  looseStockOptions,
  receivableStockOptions = [],
  balingRecords = [],
  onSavePurificationRun,
  onDeletePurificationRun,
  onSavePurificationReceipt,
  onDeletePurificationReceipt,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const canManage = currentUserDataEntryPermissions.has('purification-entry')
  const [showReceipts, setShowReceipts] = useState(true)
  const [showEntry, setShowEntry] = useState(false)
  const [showRuns, setShowRuns] = useState(true)
  const [showAttendance, setShowAttendance] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM, date: dateTo })
  const [status, setStatus] = useState('')
  const [receiptStatus, setReceiptStatus] = useState('')
  const [receiptForm, setReceiptForm] = useState({
    date: dateTo,
    stockKey: '',
    quantityKg: '',
    baleCount: '',
  })
  const [attendanceViewingEmployeeId, setAttendanceViewingEmployeeId] = useState('')

  const clockedInSupervisors = employees
    .filter(
      (employee) => employee.role === 'reactor-supervisor' && clockedInIds.includes(employee.id),
    )
    .sort(compareEmployeesByName)
  const clockedInOperators = employees
    .filter(
      (employee) => employee.role === 'reactor-operator' && clockedInIds.includes(employee.id),
    )
    .sort(compareEmployeesByName)
  const allSupervisors = employees
    .filter(
      (employee) =>
        employee.role === 'reactor-supervisor' || employee.id === form.supervisorId,
    )
    .sort(compareEmployeesByName)
  const allOperators = employees
    .filter(
      (employee) =>
        employee.role === 'reactor-operator' || form.operatorIds.includes(employee.id),
    )
    .sort(compareEmployeesByName)

  const filteredRuns = (
    selectedBatchFilter === 'all'
      ? purificationRuns.filter((run) => run.date >= dateFrom && run.date <= dateTo)
      : purificationRuns.filter(
          (run) => normalizeBatchNumber(run.batchNumber) === selectedBatchFilter,
        )
  ).slice().sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date)
    }
    if (Number(a.shiftNumber) !== Number(b.shiftNumber)) {
      return Number(b.shiftNumber) - Number(a.shiftNumber)
    }
    return Number(b.runNumber) - Number(a.runNumber)
  })

  const totalInputKg = filteredRuns.reduce((sum, run) => sum + (Number(run.inputKg) || 0), 0)
  const totalOutputKg = filteredRuns.reduce((sum, run) => sum + (Number(run.outputKg) || 0), 0)
  const totalWater = filteredRuns.reduce((sum, run) => sum + (Number(run.waterLitres) || 0), 0)
  const overallEfficiency = totalInputKg > 0 ? totalOutputKg / totalInputKg : null
  const nextRunNumber = nextPurificationRunNumber(purificationRuns, form.date, form.shiftNumber)
  const runsAlreadyOnShift = purificationRuns.filter(
    (run) => run.date === form.date && Number(run.shiftNumber) === Number(form.shiftNumber) && run.id !== editingId,
  ).length
  const warnings = staffingWarnings(form.supervisorId, form.operatorIds.length)
  const previewOutputCode = purificationOutputStockCode(form.sourceStockCode)
  const editingRun = purificationRuns.find((run) => run.id === editingId)
  const ubrOptions = useMemo(
    () =>
      stockOptionsForEntry(looseStockOptions, selectedBatchFilter, form.sourceStockCode, {
        code: editingRun?.sourceStockCode ?? '',
        kg: Number(editingRun?.inputKg) || 0,
      }),
    [looseStockOptions, selectedBatchFilter, form.sourceStockCode, editingRun],
  )
  const receivableOptions = useMemo(() => {
    const options = (receivableStockOptions ?? []).filter(isReceivablePurificationStock)
    const filtered =
      selectedBatchFilter === 'all'
        ? options
        : options.filter((item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter)
    return filtered.slice().sort((a, b) => a.stockCode.localeCompare(b.stockCode))
  }, [receivableStockOptions, selectedBatchFilter])
  const selectedReceipt = receivableOptions.find(
    (option) => `${option.stockForm}|${option.stockCode}` === receiptForm.stockKey,
  )
  const receivingBales = selectedReceipt?.stockForm === 'Baled'
  const baleBreakPlan =
    receivingBales && Number(receiptForm.baleCount) > 0
      ? selectBalesToBreak(balingRecords, selectedReceipt.stockCode, receiptForm.baleCount)
      : null
  const filteredReceipts = (
    selectedBatchFilter === 'all'
      ? purificationReceipts.filter((receipt) => receipt.date >= dateFrom && receipt.date <= dateTo)
      : purificationReceipts.filter(
          (receipt) => normalizeBatchNumber(receipt.batchNumber) === selectedBatchFilter,
        )
  )
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
  const supervisorChoices = editingId ? allSupervisors : clockedInSupervisors
  const operatorChoices = editingId ? allOperators : clockedInOperators

  const attendanceRows = Object.values(
    filteredRuns.reduce((map, run) => {
      if (run.supervisorId) {
        if (!map[run.supervisorId]) {
          map[run.supervisorId] = {
            id: run.supervisorId,
            name: run.supervisorName || run.supervisorId,
            role: 'Reactor Supervisor',
            dates: new Set(),
            runs: 0,
          }
        }
        map[run.supervisorId].dates.add(run.date)
        map[run.supervisorId].runs += 1
      }
      ;(run.operatorIds ?? []).forEach((id, index) => {
        if (!map[id]) {
          map[id] = {
            id,
            name: run.operatorNames?.[index] ?? id,
            role: 'Reactor Operator',
            dates: new Set(),
            runs: 0,
          }
        }
        map[id].dates.add(run.date)
        map[id].runs += 1
      })
      return map
    }, {}),
  )
    .map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      daysWorked: item.dates.size,
      runs: item.runs,
    }))
    .sort((a, b) => b.daysWorked - a.daysWorked || a.name.localeCompare(b.name))

  function handleReceiveStock(event) {
    event.preventDefault()
    const result = onSavePurificationReceipt?.({
      date: receiptForm.date,
      quantityKg: receiptForm.quantityKg,
      baleCount: receiptForm.baleCount,
      sourceStockCode: selectedReceipt?.stockCode ?? '',
      stockForm: selectedReceipt?.stockForm ?? '',
    })
    setReceiptStatus(result?.message ?? 'Could not receive stock.')
    if (result?.ok) {
      setReceiptForm((prev) => ({ ...prev, stockKey: '', quantityKg: '', baleCount: '' }))
    }
  }

  function handleDeleteReceipt(receipt) {
    const confirmed = window.confirm(
      `Remove the receipt of ${receipt.quantityKg} kg from ${receipt.sourceStockCode}? The fibre will leave ${receipt.outputStockCode}.`,
    )
    if (!confirmed) {
      return
    }
    const result = onDeletePurificationReceipt?.(receipt.id)
    setReceiptStatus(result?.message ?? 'Could not remove the receipt.')
  }

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function toggleOperator(employeeId) {
    setForm((prev) => ({
      ...prev,
      operatorIds: prev.operatorIds.includes(employeeId)
        ? prev.operatorIds.filter((id) => id !== employeeId)
        : [...prev.operatorIds, employeeId],
    }))
  }

  function startEditing(run) {
    setEditingId(run.id)
    setForm({
      date: run.date,
      shiftNumber: String(run.shiftNumber),
      supervisorId: run.supervisorId ?? '',
      operatorIds: [...(run.operatorIds ?? [])],
      sourceStockCode: run.sourceStockCode ?? '',
      inputKg: run.inputKg > 0 ? String(run.inputKg) : '',
      outputKg: run.outputKg > 0 ? String(run.outputKg) : '',
      waterLitres: run.waterLitres > 0 ? String(run.waterLitres) : '',
    })
    setStatus('')
    setShowEntry(true)
  }

  function cancelEditing() {
    setEditingId('')
    setForm({ ...EMPTY_FORM, date: dateTo })
    setStatus('')
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!canManage) {
      setStatus('You do not have permission to record purification runs.')
      return
    }
    const result = onSavePurificationRun({
      id: editingId,
      date: form.date,
      shiftNumber: form.shiftNumber,
      supervisorId: form.supervisorId,
      operatorIds: form.operatorIds,
      sourceStockCode: form.sourceStockCode,
      inputKg: form.inputKg,
      outputKg: form.outputKg,
      waterLitres: form.waterLitres,
    })
    if (!result.ok) {
      setStatus(result.message)
      return
    }
    const advisory = warnings.length > 0 ? `Warning: ${warnings.join(' ')} ` : ''
    setStatus(`${advisory}${result.message}`)
    setEditingId('')
    setForm({ ...EMPTY_FORM, date: form.date, shiftNumber: form.shiftNumber })
    setShowRuns(true)
  }

  function handleDelete(run) {
    if (!canManage) {
      return
    }
    const confirmed = window.confirm(
      `Delete shift ${run.shiftNumber} run ${run.runNumber} on ${formatDisplayDate(run.date)}? Stock from this run will be reversed.`,
    )
    if (!confirmed) {
      return
    }
    const result = onDeletePurificationRun(run.id)
    setStatus(result.message)
    if (result.ok && editingId === run.id) {
      cancelEditing()
    }
  }

  const viewingAttendance = attendanceRows.find((row) => row.id === attendanceViewingEmployeeId)

  return (
    <section className="panel">
      <h2>Purification</h2>
      <p>
        Fibre is received into purification before it goes into the reactor. Loose or baled
        unbrushed (UBR) and brushed (BRS) fibre can be received. Bales are broken, and the fibre
        is held together as PPUR for that batch. Reactor runs then take PPUR fibre. Each run has a
        team, the fibre used, the purified fibre produced, the water used, and an efficiency
        factor (purified kg / PPUR kg). Two runs are expected on each shift.
      </p>

      <div className="form-grid">
        <label>
          Batch Filter
          <select
            value={selectedBatchFilter}
            onChange={(event) => onSelectedBatchFilterChange(event.target.value)}
          >
            <option value="all">Date filtered records</option>
            {availableBatches.map((batch) => (
              <option key={batch} value={batch}>
                {batch}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            disabled={selectedBatchFilter !== 'all'}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            disabled={selectedBatchFilter !== 'all'}
          />
        </label>
      </div>

      <div className="kpi-grid">
        <article className="card">
          <h3>Runs</h3>
          <p>{filteredRuns.length}</p>
        </article>
        <article className="card">
          <h3>Fibre Purified</h3>
          <p>{Number(totalOutputKg.toFixed(1)).toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Efficiency</h3>
          <p>{formatEfficiencyRatio(overallEfficiency)}</p>
        </article>
        <article className="card">
          <h3>Water Consumed</h3>
          <p>{Number(totalWater.toFixed(1)).toLocaleString()} L</p>
        </article>
      </div>

      <CollapsibleSection
        title="Stock received"
        isOpen={showReceipts}
        onToggle={() => setShowReceipts((prev) => !prev)}
      >
        {canManage ? (
        <>
        <form className="form-grid" onSubmit={handleReceiveStock}>
          <label>
            Date
            <input
              type="date"
              value={receiptForm.date}
              onChange={(event) => setReceiptForm((prev) => ({ ...prev, date: event.target.value }))}
              required
            />
          </label>
          <label>
            Stock
            <select
              value={receiptForm.stockKey}
              onChange={(event) =>
                setReceiptForm((prev) => ({
                  ...prev,
                  stockKey: event.target.value,
                  quantityKg: '',
                  baleCount: '',
                }))
              }
              required
            >
              <option value="">Select UBR or BRS stock</option>
              {receivableOptions.map((option) => (
                <option key={`${option.stockForm}|${option.stockCode}`} value={`${option.stockForm}|${option.stockCode}`}>
                  {option.stockForm} · {option.stockCode} ({Number(option.totalKg).toLocaleString()} kg
                  {option.quantityLabel ? `, ${option.quantityLabel} bales` : ''})
                </option>
              ))}
            </select>
          </label>
          <label>
            {receivingBales ? 'Number of bales' : 'Kilograms received'}
            <input
              type="number"
              min={receivingBales ? '1' : '0.1'}
              step={receivingBales ? '1' : '0.1'}
              value={receivingBales ? receiptForm.baleCount : receiptForm.quantityKg}
              onChange={(event) =>
                setReceiptForm((prev) =>
                  receivingBales
                    ? { ...prev, baleCount: event.target.value }
                    : { ...prev, quantityKg: event.target.value },
                )
              }
              required
            />
          </label>
          <p className="inline-hint">
            {selectedReceipt
              ? `This fibre will be stocked as ${ppurStockCode(selectedReceipt.batchNumber)}.`
              : 'Received fibre is stocked as PPUR for the batch, for example 2026-024-PPUR.'}
            {receivingBales && !receiptForm.baleCount
              ? ' Enter how many bales to break. The kilograms are calculated from those bales.'
              : ''}
            {baleBreakPlan?.error
              ? ` ${baleBreakPlan.error}`
              : baleBreakPlan?.quantityKg
                ? ` ${baleBreakPlan.baleCount} bale${baleBreakPlan.baleCount === 1 ? '' : 's'} = ${baleBreakPlan.quantityKg} kg.`
                : ''}
          </p>
          <div className="record-edit-actions">
            <button type="submit">Receive stock</button>
          </div>
        </form>
        {receiptStatus ? <div className="placeholder">{receiptStatus}</div> : null}
        </>
        ) : (
          <p>Only Admin, Production Manager, or Reactor Supervisor can receive stock.</p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>From</th>
                <th>Form</th>
                <th>Bales</th>
                <th>Kg</th>
                <th>PPUR</th>
                <th>Received by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredReceipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td>{formatDisplayDate(receipt.date)}</td>
                  <td>{receipt.sourceStockCode}</td>
                  <td>{receipt.sourceStockForm}</td>
                  <td>{receipt.baleCount > 0 ? receipt.baleCount : '—'}</td>
                  <td>{receipt.quantityKg}</td>
                  <td>{receipt.outputStockCode}</td>
                  <td>{receipt.receivedByName || '—'}</td>
                  <td>
                    {canManage ? (
                      <button type="button" className="secondary-button" onClick={() => handleDeleteReceipt(receipt)}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {filteredReceipts.length === 0 ? (
                <tr>
                  <td colSpan="8">No stock has been received in this view.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={editingId ? 'Edit Run' : 'Create Run'}
        isOpen={showEntry}
        onToggle={() => setShowEntry((prev) => !prev)}
        canExpand={canManage}
        deniedMessage="Only Admin, Production Manager, or Reactor Supervisor can record purification runs."
      >
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Date
            <input
              type="date"
              value={form.date}
              onChange={(event) => updateForm('date', event.target.value)}
              required
            />
          </label>
          <label>
            Shift Number
            <select
              value={form.shiftNumber}
              onChange={(event) => updateForm('shiftNumber', event.target.value)}
            >
              {SHIFT_NUMBERS.map((shift) => (
                <option key={shift} value={String(shift)}>
                  Shift {shift}
                </option>
              ))}
            </select>
          </label>
          <label>
            Run Number
            <input
              value={
                editingId
                  ? String(purificationRuns.find((run) => run.id === editingId)?.runNumber ?? '')
                  : String(nextRunNumber)
              }
              readOnly
            />
          </label>
          <label>
            Reactor Supervisor ({editingId ? 'all' : 'clocked in'})
            <select
              value={form.supervisorId}
              onChange={(event) => updateForm('supervisorId', event.target.value)}
            >
              <option value="">Select supervisor</option>
              {supervisorChoices.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reactor Operators ({editingId ? 'all' : 'clocked in'})
            <div className="checklist">
              {operatorChoices.length === 0 ? (
                <span>No reactor operators are {editingId ? 'on file' : 'clocked in'}.</span>
              ) : (
                operatorChoices.map((person) => (
                  <label key={person.id} className="check-item">
                    <span>{person.name}</span>
                    <input
                      type="checkbox"
                      checked={form.operatorIds.includes(person.id)}
                      onChange={() => toggleOperator(person.id)}
                    />
                  </label>
                ))
              )}
            </div>
          </label>
          <label>
            Pre-purification stock
            <select
              value={form.sourceStockCode}
              onChange={(event) => updateForm('sourceStockCode', event.target.value)}
            >
              <option value="">Select PPUR stock code</option>
              {ubrOptions.map((option) => (
                <option key={option.stockCode} value={option.stockCode}>
                  {option.stockCode} ({Number(option.totalKg).toLocaleString()} kg)
                </option>
              ))}
            </select>
          </label>
          <label>
            Pre-purification fibre (kg)
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.inputKg}
              onChange={(event) => updateForm('inputKg', event.target.value)}
            />
          </label>
          <label>
            Purified Fibre Out (kg)
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.outputKg}
              onChange={(event) => updateForm('outputKg', event.target.value)}
            />
          </label>
          <label>
            Water Used (L)
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.waterLitres}
              onChange={(event) => updateForm('waterLitres', event.target.value)}
            />
          </label>
          <p className="inline-hint">
            {editingId
              ? `Editing shift ${form.shiftNumber} run ${
                  purificationRuns.find((run) => run.id === editingId)?.runNumber ?? ''
                }.`
              : runsAlreadyOnShift === 0
                ? `This will be run ${nextRunNumber} on shift ${form.shiftNumber}.`
                : `This shift already has ${runsAlreadyOnShift} run${
                    runsAlreadyOnShift === 1 ? '' : 's'
                  }. This entry will be run ${nextRunNumber}.`}
            {runsAlreadyOnShift >= 2 && !editingId
              ? ' This shift already has the two runs usually expected. You can still add another.'
              : ''}
            {previewOutputCode
              ? ` Purified fibre will be stocked as ${previewOutputCode}.`
              : ' Purified fibre is stocked as PUR for the batch, for example 2026-024-PUR.'}
            {form.inputKg && form.outputKg
              ? ` Efficiency ${formatEfficiencyRatio(
                  efficiencyPreview(form.inputKg, form.outputKg),
                )}.`
              : ''}
          </p>
          {warnings.length > 0 ? (
            <div className="staffing-warning" role="alert">
              <strong>Staffing advisory</strong>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <p>You can still save this run.</p>
            </div>
          ) : null}
          <div className="record-edit-actions">
            <button type="submit">{editingId ? 'Save Changes' : 'Save Run'}</button>
            {editingId ? (
              <button type="button" className="secondary-button" onClick={cancelEditing}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        {status ? <div className="placeholder">{status}</div> : null}
      </CollapsibleSection>

      <CollapsibleSection title="Runs" isOpen={showRuns} onToggle={() => setShowRuns((prev) => !prev)}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Shift</th>
                <th>Run</th>
                <th>Team</th>
                <th>PPUR In</th>
                <th>In (kg)</th>
                <th>PUR Out</th>
                <th>Out (kg)</th>
                <th>Efficiency</th>
                <th>Water (L)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr key={run.id}>
                  <td>{formatDisplayDate(run.date)}</td>
                  <td>{run.shiftNumber}</td>
                  <td>{run.runNumber}</td>
                  <td>
                    {run.supervisorName || 'No supervisor'}
                    {run.operatorNames?.length ? `, ${run.operatorNames.join(', ')}` : ''}
                  </td>
                  <td>{run.sourceStockCode || '—'}</td>
                  <td>{run.inputKg > 0 ? run.inputKg : '—'}</td>
                  <td>{run.outputStockCode || '—'}</td>
                  <td>{run.outputKg > 0 ? run.outputKg : '—'}</td>
                  <td>{formatEfficiencyRatio(run.efficiency)}</td>
                  <td>{run.waterLitres > 0 ? run.waterLitres : '—'}</td>
                  <td>
                    {canManage ? (
                      <div className="record-edit-actions">
                        <button type="button" onClick={() => startEditing(run)}>
                          Edit
                        </button>
                        <button type="button" className="secondary-button" onClick={() => handleDelete(run)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {filteredRuns.length === 0 ? (
                <tr>
                  <td colSpan="11">No purification runs in this view.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Attendance"
        isOpen={showAttendance}
        onToggle={() => setShowAttendance((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Days</th>
                <th>Runs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.role}</td>
                  <td>{row.daysWorked}</td>
                  <td>{row.runs}</td>
                  <td>
                    <button type="button" onClick={() => setAttendanceViewingEmployeeId(row.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {attendanceRows.length === 0 ? (
                <tr>
                  <td colSpan="5">No reactor team attendance in this view.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {viewingAttendance ? (
          <div className="placeholder">
            {viewingAttendance.name} worked {viewingAttendance.runs} run
            {viewingAttendance.runs === 1 ? '' : 's'} as {viewingAttendance.role.toLowerCase()} across{' '}
            {viewingAttendance.daysWorked} day{viewingAttendance.daysWorked === 1 ? '' : 's'}.
          </div>
        ) : null}
      </CollapsibleSection>
    </section>
  )
}

function efficiencyPreview(inputKg, outputKg) {
  const input = Number(inputKg)
  const output = Number(outputKg)
  if (!(input > 0) || !Number.isFinite(output) || output < 0) {
    return null
  }
  return output / input
}
