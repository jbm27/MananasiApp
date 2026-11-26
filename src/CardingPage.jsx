import { useState } from 'react'
import { compareEmployeesByName } from './employeeFields.js'
import CollapsibleSection from './CollapsibleSection.jsx'
import {
  SHIFT_NUMBERS,
  batchFromTraceableStockCode,
  cardedBaleCode,
  cardedGrade,
  cardedStockRoot,
  formatDisplayDate,
  formatEfficiencyRatio,
  isPurLooseStockCode,
  normalizeBatchNumber,
} from './fibreFinishing.js'

function staffingWarnings(supervisorId, attendantCount) {
  const warnings = []
  if (!supervisorId) {
    warnings.push('No carding supervisor selected.')
  }
  if (attendantCount === 0) {
    warnings.push('No carding attendants selected.')
  }
  return warnings
}

function purOptionsForEntry(looseStockOptions, selectedBatchFilter, currentCode, reserved) {
  const purOptions = (looseStockOptions ?? []).filter((item) => isPurLooseStockCode(item.stockCode))
  const filtered =
    selectedBatchFilter === 'all'
      ? [...purOptions]
      : purOptions.filter((item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter)
  for (const code of [currentCode, reserved?.code].filter(Boolean)) {
    if (filtered.some((item) => item.stockCode === code)) {
      continue
    }
    const existing = purOptions.find((item) => item.stockCode === code)
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

export default function CardingPage({
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  cardingShifts,
  looseStockOptions,
  onSaveCardingShift,
  onDeleteCardingShift,
  onSaveCardingLine,
  onDeleteCardingLine,
  onPrintCardingLabels,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const canManage = currentUserDataEntryPermissions.has('carding-entry')
  const [showShiftEntry, setShowShiftEntry] = useState(false)
  const [showLineEntry, setShowLineEntry] = useState(false)
  const [showRegister, setShowRegister] = useState(true)
  const [showAttendance, setShowAttendance] = useState(false)
  const [editingShiftId, setEditingShiftId] = useState('')
  const [shiftDate, setShiftDate] = useState(dateTo)
  const [shiftNumber, setShiftNumber] = useState('1')
  const [fibreLength, setFibreLength] = useState('')
  const [supervisorId, setSupervisorId] = useState('')
  const [attendantIds, setAttendantIds] = useState([])
  const [lineShiftId, setLineShiftId] = useState('')
  const [editingLineId, setEditingLineId] = useState('')
  const [sourceStockCode, setSourceStockCode] = useState('')
  const [inputKg, setInputKg] = useState('')
  const [baleWeights, setBaleWeights] = useState([''])
  const [printableBales, setPrintableBales] = useState([])
  const [status, setStatus] = useState('')
  const [attendanceViewingEmployeeId, setAttendanceViewingEmployeeId] = useState('')

  const clockedInSupervisors = employees
    .filter(
      (employee) => employee.role === 'carding-supervisor' && clockedInIds.includes(employee.id),
    )
    .sort(compareEmployeesByName)
  const clockedInAttendants = employees
    .filter(
      (employee) => employee.role === 'carding-attendant' && clockedInIds.includes(employee.id),
    )
    .sort(compareEmployeesByName)
  const allSupervisors = employees
    .filter((employee) => employee.role === 'carding-supervisor' || employee.id === supervisorId)
    .sort(compareEmployeesByName)
  const allAttendants = employees
    .filter(
      (employee) => employee.role === 'carding-attendant' || attendantIds.includes(employee.id),
    )
    .sort(compareEmployeesByName)

  const filteredShifts = (
    selectedBatchFilter === 'all'
      ? cardingShifts.filter((shift) => shift.date >= dateFrom && shift.date <= dateTo)
      : cardingShifts.filter((shift) =>
          (shift.lines ?? []).some(
            (line) => normalizeBatchNumber(line.batchNumber) === selectedBatchFilter,
          ),
        )
  )
    .slice()
    .sort((a, b) =>
      a.date === b.date
        ? Number(b.shiftNumber) - Number(a.shiftNumber)
        : b.date.localeCompare(a.date),
    )

  const visibleLines = filteredShifts.flatMap((shift) =>
    (shift.lines ?? [])
      .filter((line) =>
        selectedBatchFilter === 'all'
          ? true
          : normalizeBatchNumber(line.batchNumber) === selectedBatchFilter,
      )
      .map((line) => ({ ...line, shift })),
  )
  const totalInputKg = visibleLines.reduce((sum, line) => sum + (Number(line.inputKg) || 0), 0)
  const totalOutputKg = visibleLines.reduce((sum, line) => sum + (Number(line.outputKg) || 0), 0)
  const overallEfficiency = totalInputKg > 0 ? totalOutputKg / totalInputKg : null
  const warnings = staffingWarnings(supervisorId, attendantIds.length)
  const selectedLineShift =
    cardingShifts.find((shift) => shift.id === lineShiftId) ?? filteredShifts[0] ?? cardingShifts[0]
  const activeLineShiftId = lineShiftId || selectedLineShift?.id || ''
  const activeShift = cardingShifts.find((shift) => shift.id === activeLineShiftId) ?? null
  const previewBatch = sourceStockCode ? batchFromTraceableStockCode(sourceStockCode) : ''
  const previewRoot =
    activeShift && previewBatch ? cardedStockRoot(previewBatch, activeShift.fibreLength) : ''
  const previewBales = previewRoot
    ? baleWeights
        .map((weight) => cardedBaleCode(previewBatch, activeShift.fibreLength, weight))
        .filter(Boolean)
    : []
  const previewOutputKg = baleWeights.reduce((sum, weight) => {
    const value = Number(weight)
    return Number.isFinite(value) && value > 0 ? sum + value : sum
  }, 0)
  const editingLine = activeShift?.lines?.find((line) => line.id === editingLineId)
  const purOptions = purOptionsForEntry(looseStockOptions, selectedBatchFilter, sourceStockCode, {
    code: editingLine?.sourceStockCode ?? '',
    kg: Number(editingLine?.inputKg) || 0,
  })
  const supervisorChoices = editingShiftId ? allSupervisors : clockedInSupervisors
  const attendantChoices = editingShiftId ? allAttendants : clockedInAttendants
  const lengthLocked =
    Boolean(editingShiftId) &&
    (cardingShifts.find((shift) => shift.id === editingShiftId)?.lines ?? []).some(
      (line) => Number(line.outputKg) > 0,
    )

  const attendanceRows = Object.values(
    filteredShifts.reduce((map, shift) => {
      if (shift.supervisorId) {
        if (!map[shift.supervisorId]) {
          map[shift.supervisorId] = {
            id: shift.supervisorId,
            name: shift.supervisorName || shift.supervisorId,
            role: 'Carding Supervisor',
            dates: new Set(),
            shifts: 0,
          }
        }
        map[shift.supervisorId].dates.add(shift.date)
        map[shift.supervisorId].shifts += 1
      }
      ;(shift.attendantIds ?? []).forEach((id, index) => {
        if (!map[id]) {
          map[id] = {
            id,
            name: shift.attendantNames?.[index] ?? id,
            role: 'Carding Attendant',
            dates: new Set(),
            shifts: 0,
          }
        }
        map[id].dates.add(shift.date)
        map[id].shifts += 1
      })
      return map
    }, {}),
  )
    .map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      daysWorked: item.dates.size,
      shifts: item.shifts,
    }))
    .sort((a, b) => b.daysWorked - a.daysWorked || a.name.localeCompare(b.name))

  function toggleAttendant(employeeId) {
    setAttendantIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
    )
  }

  function resetShiftForm() {
    setEditingShiftId('')
    setShiftDate(dateTo)
    setShiftNumber('1')
    setFibreLength('')
    setSupervisorId('')
    setAttendantIds([])
  }

  function resetLineForm() {
    setEditingLineId('')
    setSourceStockCode('')
    setInputKg('')
    setBaleWeights([''])
  }

  function updateBaleWeight(index, value) {
    setBaleWeights((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)))
  }

  function addBaleWeight() {
    setBaleWeights((prev) => [...prev, ''])
  }

  function removeBaleWeight(index) {
    setBaleWeights((prev) => (prev.length === 1 ? [''] : prev.filter((_, itemIndex) => itemIndex !== index)))
  }

  function startEditingShift(shift) {
    setEditingShiftId(shift.id)
    setShiftDate(shift.date)
    setShiftNumber(String(shift.shiftNumber))
    setFibreLength(String(shift.fibreLength ?? ''))
    setSupervisorId(shift.supervisorId ?? '')
    setAttendantIds([...(shift.attendantIds ?? [])])
    setStatus('')
    setShowShiftEntry(true)
  }

  function startEditingLine(shift, line) {
    setLineShiftId(shift.id)
    setEditingLineId(line.id)
    setSourceStockCode(line.sourceStockCode ?? '')
    setInputKg(line.inputKg > 0 ? String(line.inputKg) : '')
    setBaleWeights(
      line.bales?.length
        ? line.bales.map((bale) => String(bale.weightKg))
        : line.outputKg > 0
          ? [String(line.outputKg)]
          : [''],
    )
    setStatus('')
    setShowLineEntry(true)
  }

  function handleSaveShift(event) {
    event.preventDefault()
    if (!canManage) {
      setStatus('You do not have permission to record carding shifts.')
      return
    }
    const result = onSaveCardingShift({
      id: editingShiftId,
      date: shiftDate,
      shiftNumber,
      fibreLength,
      supervisorId,
      attendantIds,
    })
    if (!result.ok) {
      setStatus(result.message)
      return
    }
    const advisory = warnings.length > 0 ? `Warning: ${warnings.join(' ')} ` : ''
    setStatus(`${advisory}${result.message}`)
    if (!editingShiftId && result.shiftId) {
      setLineShiftId(result.shiftId)
      setShowLineEntry(true)
    }
    resetShiftForm()
    setShowRegister(true)
  }

  function handleDeleteShift(shift) {
    if (!canManage) {
      return
    }
    const lineCount = shift.lines?.length ?? 0
    const confirmed = window.confirm(
      lineCount > 0
        ? `Delete shift ${shift.shiftNumber} on ${formatDisplayDate(shift.date)} and its ${lineCount} output record${lineCount === 1 ? '' : 's'}? Stock will be reversed.`
        : `Delete shift ${shift.shiftNumber} on ${formatDisplayDate(shift.date)}?`,
    )
    if (!confirmed) {
      return
    }
    const result = onDeleteCardingShift(shift.id)
    setStatus(result.message)
    if (result.ok && editingShiftId === shift.id) {
      resetShiftForm()
    }
  }

  function handleSaveLine(event) {
    event.preventDefault()
    if (!canManage) {
      setStatus('You do not have permission to record carding output.')
      return
    }
    if (!activeLineShiftId) {
      setStatus('Start a carding shift before recording output.')
      return
    }
    const result = onSaveCardingLine({
      shiftId: activeLineShiftId,
      lineId: editingLineId,
      sourceStockCode,
      inputKg,
      baleWeights,
    })
    if (!result.ok) {
      setStatus(result.message)
      return
    }
    setPrintableBales(result.bales ?? [])
    setStatus(result.message)
    resetLineForm()
    setShowRegister(true)
  }

  function handlePrintBales(bales) {
    const result = onPrintCardingLabels?.(bales)
    if (result?.message) {
      setStatus(result.message)
    }
  }

  function handleDeleteLine(shift, line) {
    if (!canManage) {
      return
    }
    const confirmed = window.confirm(
      `Remove ${line.inputKg} kg from ${line.sourceStockCode} on shift ${shift.shiftNumber}? Stock will be reversed.`,
    )
    if (!confirmed) {
      return
    }
    const result = onDeleteCardingLine(shift.id, line.id)
    setStatus(result.message)
    if (result.ok && editingLineId === line.id) {
      resetLineForm()
    }
  }

  const viewingAttendance = attendanceRows.find((row) => row.id === attendanceViewingEmployeeId)
  const shiftChoices = [...cardingShifts].sort((a, b) =>
    a.date === b.date ? Number(b.shiftNumber) - Number(a.shiftNumber) : b.date.localeCompare(a.date),
  )

  return (
    <section className="panel">
      <h2>Cutting and carding</h2>
      <p>
        Purified fibre is cut and carded on a shift. Set the fibre length when the shift starts.
        Each bound bale is weighed and coded, for example 2026-024-CAR40-86 for an 86 kg bale of
        40 mm fibre from batch 2026-024. Stock lists those bales together as 2026-024-CAR40.
        Efficiency is carded kg / purified kg.
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
          <h3>Shifts</h3>
          <p>{filteredShifts.length}</p>
        </article>
        <article className="card">
          <h3>Carded Fibre</h3>
          <p>{Number(totalOutputKg.toFixed(1)).toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Efficiency</h3>
          <p>{formatEfficiencyRatio(overallEfficiency)}</p>
        </article>
      </div>

      <CollapsibleSection
        title={editingShiftId ? 'Edit Shift' : 'Start Shift'}
        isOpen={showShiftEntry}
        onToggle={() => setShowShiftEntry((prev) => !prev)}
        canExpand={canManage}
        deniedMessage="Only Admin, Production Manager, or Carding Supervisor can record carding shifts."
      >
        <form className="form-grid" onSubmit={handleSaveShift}>
          <label>
            Date
            <input type="date" value={shiftDate} onChange={(event) => setShiftDate(event.target.value)} required />
          </label>
          <label>
            Shift Number
            <select value={shiftNumber} onChange={(event) => setShiftNumber(event.target.value)}>
              {SHIFT_NUMBERS.map((shift) => (
                <option key={shift} value={String(shift)}>
                  Shift {shift}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fibre Length
            <input
              type="number"
              min="1"
              step="1"
              value={fibreLength}
              onChange={(event) => setFibreLength(event.target.value)}
              readOnly={lengthLocked}
              required
            />
          </label>
          <label>
            Carding Supervisor ({editingShiftId ? 'all' : 'clocked in'})
            <select value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)}>
              <option value="">Select supervisor</option>
              {supervisorChoices.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Carding Attendants ({editingShiftId ? 'all' : 'clocked in'})
            <div className="checklist">
              {attendantChoices.length === 0 ? (
                <span>No carding attendants are {editingShiftId ? 'on file' : 'clocked in'}.</span>
              ) : (
                attendantChoices.map((person) => (
                  <label key={person.id} className="check-item">
                    <span>{person.name}</span>
                    <input
                      type="checkbox"
                      checked={attendantIds.includes(person.id)}
                      onChange={() => toggleAttendant(person.id)}
                    />
                  </label>
                ))
              )}
            </div>
          </label>
          <p className="inline-hint">
            {fibreLength
              ? `All fibre on this shift will be stocked as ${cardedGrade(fibreLength) || 'CAR…'}.`
              : 'Enter the length once for the shift. Every output on the shift uses it.'}
            {lengthLocked ? ' Length is fixed because carded output has already been recorded.' : ''}
          </p>
          {warnings.length > 0 ? (
            <div className="staffing-warning" role="alert">
              <strong>Staffing advisory</strong>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <p>You can still save this shift.</p>
            </div>
          ) : null}
          <div className="record-edit-actions">
            <button type="submit">{editingShiftId ? 'Save Shift' : 'Start Shift'}</button>
            {editingShiftId ? (
              <button type="button" className="secondary-button" onClick={resetShiftForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title={editingLineId ? 'Edit Output' : 'Record Output'}
        isOpen={showLineEntry}
        onToggle={() => setShowLineEntry((prev) => !prev)}
        canExpand={canManage}
        deniedMessage="Only Admin, Production Manager, or Carding Supervisor can record carding output."
      >
        <form className="form-grid" onSubmit={handleSaveLine}>
          <label>
            Shift
            <select
              value={activeLineShiftId}
              onChange={(event) => {
                setLineShiftId(event.target.value)
                setEditingLineId('')
              }}
              disabled={Boolean(editingLineId)}
            >
              <option value="">Select shift</option>
              {shiftChoices.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {formatDisplayDate(shift.date)} · shift {shift.shiftNumber} ·{' '}
                  {cardedGrade(shift.fibreLength)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Purified Fibre Stock
            <select value={sourceStockCode} onChange={(event) => setSourceStockCode(event.target.value)}>
              <option value="">Select PUR stock code</option>
              {purOptions.map((option) => (
                <option key={option.stockCode} value={option.stockCode}>
                  {option.stockCode} ({Number(option.totalKg).toLocaleString()} kg)
                </option>
              ))}
            </select>
          </label>
          <label>
            Purified Fibre In (kg)
            <input
              type="number"
              min="0"
              step="0.1"
              value={inputKg}
              onChange={(event) => setInputKg(event.target.value)}
            />
          </label>
          <label className="full-width">
            Bale weights (kg)
            {baleWeights.map((weight, index) => (
              <div key={index} className="record-edit-actions">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={weight}
                  aria-label={`Bale ${index + 1} weight kg`}
                  placeholder={`Bale ${index + 1}`}
                  style={{ maxWidth: '12rem' }}
                  onChange={(event) => updateBaleWeight(index, event.target.value)}
                />
                <button type="button" className="secondary-button" onClick={() => removeBaleWeight(index)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={addBaleWeight}>
              Add bale
            </button>
          </label>
          <p className="inline-hint">
            {previewRoot
              ? `These bales will be listed together as ${previewRoot}${
                  previewOutputKg > 0 ? ` (${previewOutputKg.toLocaleString()} kg)` : ''
                }.`
              : 'Choose a shift and a PUR stock code to see the bale codes.'}
            {previewBales.length > 0 ? ` Labels: ${previewBales.join(', ')}.` : ''}
            {inputKg && previewOutputKg > 0
              ? ` Efficiency ${formatEfficiencyRatio(efficiencyPreview(inputKg, previewOutputKg))}.`
              : ''}
          </p>
          <div className="record-edit-actions">
            <button type="submit">{editingLineId ? 'Save Output' : 'Add Output'}</button>
            {editingLineId ? (
              <button type="button" className="secondary-button" onClick={resetLineForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        {status ? <div className="placeholder">{status}</div> : null}
        {printableBales.length > 0 ? (
          <div className="record-edit-actions">
            <button type="button" onClick={() => handlePrintBales(printableBales)}>
              Print labels
            </button>
          </div>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection
        title="Shifts"
        isOpen={showRegister}
        onToggle={() => setShowRegister((prev) => !prev)}
      >
        {filteredShifts.length === 0 ? <p>No carding shifts in this view.</p> : null}
        {filteredShifts.map((shift) => {
          const lines =
            selectedBatchFilter === 'all'
              ? shift.lines ?? []
              : (shift.lines ?? []).filter(
                  (line) => normalizeBatchNumber(line.batchNumber) === selectedBatchFilter,
                )
          const shiftIn = lines.reduce((sum, line) => sum + (Number(line.inputKg) || 0), 0)
          const shiftOut = lines.reduce((sum, line) => sum + (Number(line.outputKg) || 0), 0)
          return (
            <div key={shift.id}>
              <h3>
                {formatDisplayDate(shift.date)} · shift {shift.shiftNumber} · {cardedGrade(shift.fibreLength)}
              </h3>
              <p className="inline-hint">
                {shift.supervisorName || 'No supervisor'}
                {shift.attendantNames?.length ? ` · ${shift.attendantNames.join(', ')}` : ''}
                {shiftIn > 0
                  ? ` · efficiency ${formatEfficiencyRatio(shiftOut / shiftIn)}`
                  : ''}
              </p>
              {canManage ? (
                <div className="record-edit-actions">
                  <button type="button" onClick={() => startEditingShift(shift)}>
                    Edit shift
                  </button>
                  <button type="button" className="secondary-button" onClick={() => handleDeleteShift(shift)}>
                    Delete shift
                  </button>
                </div>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PUR In</th>
                      <th>In (kg)</th>
                      <th>CAR Out</th>
                      <th>Out (kg)</th>
                      <th>Efficiency</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.sourceStockCode}</td>
                        <td>{line.inputKg}</td>
                        <td>
                          {line.outputStockCode}
                          {line.bales?.length ? (
                            <div className="inline-hint">
                              {line.bales.map((bale) => bale.baleCode).join(', ')}
                            </div>
                          ) : null}
                        </td>
                        <td>{line.outputKg}</td>
                        <td>{formatEfficiencyRatio(line.efficiency)}</td>
                        <td>
                          <div className="record-edit-actions">
                            {line.bales?.length ? (
                              <button type="button" onClick={() => handlePrintBales(line.bales)}>
                                Print labels
                              </button>
                            ) : null}
                            {canManage ? (
                              <>
                                <button type="button" onClick={() => startEditingLine(shift, line)}>
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => handleDeleteLine(shift, line)}
                                >
                                  Delete
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan="6">No output recorded on this shift yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
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
                <th>Shifts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.role}</td>
                  <td>{row.daysWorked}</td>
                  <td>{row.shifts}</td>
                  <td>
                    <button type="button" onClick={() => setAttendanceViewingEmployeeId(row.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {attendanceRows.length === 0 ? (
                <tr>
                  <td colSpan="5">No carding team attendance in this view.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {viewingAttendance ? (
          <div className="placeholder">
            {viewingAttendance.name} worked {viewingAttendance.shifts} shift
            {viewingAttendance.shifts === 1 ? '' : 's'} as {viewingAttendance.role.toLowerCase()} across{' '}
            {viewingAttendance.daysWorked} day{viewingAttendance.daysWorked === 1 ? '' : 's'}.
          </div>
        ) : null}
      </CollapsibleSection>
      {status && !showLineEntry ? <div className="placeholder">{status}</div> : null}
      {printableBales.length > 0 && !showLineEntry ? (
        <div className="record-edit-actions">
          <button type="button" onClick={() => handlePrintBales(printableBales)}>
            Print labels
          </button>
        </div>
      ) : null}
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
