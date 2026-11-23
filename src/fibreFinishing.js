/** Purification runs and carding shifts, and the stock they move. */

export const SHIFT_NUMBERS = [1, 2, 3]

export function formatDisplayDate(isoDate) {
  const [year, month, day] = String(isoDate ?? '').split('-')
  if (!year || !month || !day) {
    return String(isoDate ?? '')
  }
  return `${day}/${month}/${year}`
}

export function normalizeBatchNumber(batchNumber) {
  const [yearPart, fieldPart] = String(batchNumber ?? '').split('-')
  const year = Number(yearPart)
  const field = Number(fieldPart)
  if (Number.isNaN(year) || Number.isNaN(field)) {
    return String(batchNumber ?? '')
  }
  return `${year}-${String(field).padStart(3, '0')}`
}

export function parseShiftNumber(value) {
  const shift = Number(value)
  if (!Number.isInteger(shift) || shift < 1 || shift > SHIFT_NUMBERS.length) {
    return null
  }
  return shift
}

/** Whole-number length written after CAR, for example 80 → CAR80. */
export function parseFibreLength(value) {
  const length = Number(value)
  if (!Number.isInteger(length) || length < 1 || length > 999) {
    return null
  }
  return length
}

export function roundKg(value) {
  return Number(Number(value).toFixed(1))
}

export function efficiencyRatio(inputKg, outputKg) {
  const input = Number(inputKg)
  const output = Number(outputKg)
  if (!(input > 0) || !Number.isFinite(output) || output < 0) {
    return null
  }
  return Number((output / input).toFixed(3))
}

export function formatEfficiencyRatio(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—'
  }
  return Number(value).toFixed(3)
}

export function isUbrLooseStockCode(stockCode) {
  return /-UBR$/.test(String(stockCode ?? '').trim())
}

export function isPurLooseStockCode(stockCode) {
  return /-PUR$/.test(String(stockCode ?? '').trim())
}

export function isTraditionalBaleSource(stockCode) {
  return /-(UBR|BRS|TOW)$/.test(String(stockCode ?? '').trim())
}

export function batchFromTraceableStockCode(stockCode) {
  const parts = String(stockCode ?? '').split('-')
  if (parts.length < 3) {
    return ''
  }
  return normalizeBatchNumber(`${parts[0]}-${parts[1]}`)
}

export function machineFromTraceableStockCode(stockCode) {
  const parts = String(stockCode ?? '').split('-')
  if (parts.length < 4) {
    return ''
  }
  const machineNumber = Number(parts[2])
  if (!Number.isInteger(machineNumber) || machineNumber <= 0) {
    return ''
  }
  return `D${machineNumber}`
}

export function purificationOutputStockCode(sourceStockCode) {
  const code = String(sourceStockCode ?? '').trim()
  if (!isUbrLooseStockCode(code)) {
    return ''
  }
  return code.replace(/-UBR$/, '-PUR')
}

export function cardedGrade(fibreLength) {
  const length = parseFibreLength(fibreLength)
  return length == null ? '' : `CAR${length}`
}

export function cardedOutputStockCode(sourceStockCode, fibreLength) {
  const code = String(sourceStockCode ?? '').trim()
  const grade = cardedGrade(fibreLength)
  if (!isPurLooseStockCode(code) || !grade) {
    return ''
  }
  return code.replace(/-PUR$/, `-${grade}`)
}

export function nextPurificationRunNumber(runs, date, shiftNumber) {
  const shift = Number(shiftNumber)
  let max = 0
  for (const run of runs ?? []) {
    if (run.date === date && Number(run.shiftNumber) === shift) {
      max = Math.max(max, Number(run.runNumber) || 0)
    }
  }
  return max + 1
}

export function findPurificationRunConflict(runs, { date, shiftNumber, runNumber }, excludeId = '') {
  return (runs ?? []).find(
    (run) =>
      run.id !== excludeId &&
      run.date === date &&
      Number(run.shiftNumber) === Number(shiftNumber) &&
      Number(run.runNumber) === Number(runNumber),
  )
}

export function findCardingShiftConflict(shifts, { date, shiftNumber }, excludeId = '') {
  return (shifts ?? []).find(
    (shift) =>
      shift.id !== excludeId &&
      shift.date === date &&
      Number(shift.shiftNumber) === Number(shiftNumber),
  )
}

function readOptionalKg(value) {
  if (value === '' || value === null || value === undefined) {
    return 0
  }
  return Number(value)
}

export function normalizePurificationProduction(input) {
  const inputKg = readOptionalKg(input?.inputKg)
  const outputKg = readOptionalKg(input?.outputKg)
  const waterLitres = readOptionalKg(input?.waterLitres)
  const sourceStockCode = String(input?.sourceStockCode ?? '').trim()
  if ([inputKg, outputKg, waterLitres].some((value) => !Number.isFinite(value) || value < 0)) {
    return { error: 'Fibre masses and water must be zero or positive numbers.' }
  }
  if (inputKg === 0 && outputKg > 0) {
    return { error: 'Enter the unbrushed fibre mass that went into the reactor.' }
  }
  if ((inputKg > 0 || outputKg > 0) && !isUbrLooseStockCode(sourceStockCode)) {
    return { error: 'Select the unbrushed (UBR) stock code the fibre was taken from.' }
  }
  const roundedInput = roundKg(inputKg)
  const roundedOutput = roundKg(outputKg)
  const hasFibre = roundedInput > 0
  return {
    error: '',
    value: {
      sourceStockCode: hasFibre ? sourceStockCode : '',
      batchNumber: hasFibre ? batchFromTraceableStockCode(sourceStockCode) : '',
      machine: hasFibre ? machineFromTraceableStockCode(sourceStockCode) : '',
      inputKg: roundedInput,
      outputKg: hasFibre ? roundedOutput : 0,
      outputStockCode: hasFibre ? purificationOutputStockCode(sourceStockCode) : '',
      waterLitres: roundKg(waterLitres),
      efficiency: hasFibre ? efficiencyRatio(roundedInput, roundedOutput) : null,
    },
  }
}

export function normalizeCardingShiftIdentity(input) {
  const shiftNumber = parseShiftNumber(input?.shiftNumber)
  const fibreLength = parseFibreLength(input?.fibreLength)
  if (!input?.date) {
    return { error: 'Choose the shift date.' }
  }
  if (shiftNumber == null) {
    return { error: 'Shift number must be 1, 2, or 3.' }
  }
  if (fibreLength == null) {
    return { error: 'Enter the fibre length as a whole number, for example 80. It becomes the XX in CARXX.' }
  }
  return {
    error: '',
    value: {
      date: input.date,
      shiftNumber,
      fibreLength,
    },
  }
}

export function normalizeCardingLine(input, fibreLength) {
  const inputKg = readOptionalKg(input?.inputKg)
  const outputKg = readOptionalKg(input?.outputKg)
  const sourceStockCode = String(input?.sourceStockCode ?? '').trim()
  if (!Number.isFinite(inputKg) || inputKg <= 0) {
    return { error: 'Enter the purified fibre mass that entered the carding line.' }
  }
  if (!Number.isFinite(outputKg) || outputKg < 0) {
    return { error: 'Carded fibre mass must be zero or a positive number.' }
  }
  if (!isPurLooseStockCode(sourceStockCode)) {
    return { error: 'Select the purified (PUR) stock code the fibre was taken from.' }
  }
  const length = parseFibreLength(fibreLength)
  if (length == null) {
    return { error: 'Set the fibre length on the shift before recording output.' }
  }
  const roundedInput = roundKg(inputKg)
  const roundedOutput = roundKg(outputKg)
  return {
    error: '',
    value: {
      sourceStockCode,
      batchNumber: batchFromTraceableStockCode(sourceStockCode),
      machine: machineFromTraceableStockCode(sourceStockCode),
      inputKg: roundedInput,
      outputKg: roundedOutput,
      outputStockCode: cardedOutputStockCode(sourceStockCode, length),
      efficiency: efficiencyRatio(roundedInput, roundedOutput),
    },
  }
}

export function balancesByStockCode(options) {
  const balances = {}
  for (const option of options ?? []) {
    if (!option?.stockCode) {
      continue
    }
    balances[option.stockCode] = Number(option.totalKg) || 0
  }
  return balances
}

export function describeStockShortfall(balances, deltas) {
  const deltaByCode = {}
  for (const delta of deltas ?? []) {
    if (!delta?.code) {
      continue
    }
    deltaByCode[delta.code] = (deltaByCode[delta.code] ?? 0) + Number(delta.delta || 0)
  }
  for (const [code, delta] of Object.entries(deltaByCode)) {
    if (!delta) {
      continue
    }
    const next = Number((((balances?.[code] ?? 0) + delta)).toFixed(1))
    if (next < 0) {
      return `Not enough ${code} available. This entry would leave ${next} kg.`
    }
  }
  return ''
}

export function purificationStockDeltas(run, direction) {
  if (!run) {
    return []
  }
  const sign = direction
  const deltas = []
  const inputKg = Number(run.inputKg) || 0
  const outputKg = Number(run.outputKg) || 0
  if (run.sourceStockCode && inputKg > 0) {
    deltas.push({ code: run.sourceStockCode, delta: -sign * inputKg })
  }
  const outputCode = run.outputStockCode || purificationOutputStockCode(run.sourceStockCode)
  if (outputCode && outputKg > 0) {
    deltas.push({ code: outputCode, delta: sign * outputKg })
  }
  return deltas
}

export function cardingLineStockDeltas(line, fibreLength, direction) {
  if (!line) {
    return []
  }
  const sign = direction
  const deltas = []
  const inputKg = Number(line.inputKg) || 0
  const outputKg = Number(line.outputKg) || 0
  if (line.sourceStockCode && inputKg > 0) {
    deltas.push({ code: line.sourceStockCode, delta: -sign * inputKg })
  }
  const outputCode = line.outputStockCode || cardedOutputStockCode(line.sourceStockCode, fibreLength)
  if (outputCode && outputKg > 0) {
    deltas.push({ code: outputCode, delta: sign * outputKg })
  }
  return deltas
}

export function finishingRecordsForStockView({
  purificationRuns = [],
  cardingShifts = [],
  showAbsoluteStock = false,
  selectedBatchFilter = 'all',
  dateFrom = '',
  dateTo = '',
} = {}) {
  const inView = (date, batchNumber) => {
    if (showAbsoluteStock) {
      return true
    }
    if (selectedBatchFilter === 'all') {
      return date >= dateFrom && date <= dateTo
    }
    return normalizeBatchNumber(batchNumber) === selectedBatchFilter
  }
  return {
    purificationRuns: (purificationRuns ?? []).filter((run) => inView(run.date, run.batchNumber)),
    cardingShifts: (cardingShifts ?? [])
      .map((shift) => ({
        ...shift,
        lines: (shift.lines ?? []).filter((line) => inView(shift.date, line.batchNumber)),
      }))
      .filter((shift) => shift.lines.length > 0),
  }
}

export function applyFinishingStock(stockMap, purificationRuns = [], cardingShifts = [], options = {}) {
  const countMovements = Boolean(options.countMovements)
  const touch = (code, batchNumber, deltaKg) => {
    if (!code || !deltaKg) {
      return
    }
    if (!stockMap[code]) {
      stockMap[code] = {
        stockCode: code,
        batchNumber: normalizeBatchNumber(batchNumber),
        totalKg: 0,
        movements: 0,
      }
    }
    stockMap[code].totalKg += deltaKg
    if (countMovements) {
      stockMap[code].movements = Number(stockMap[code].movements ?? 0) + 1
    }
  }

  for (const run of purificationRuns ?? []) {
    const inputKg = Number(run.inputKg) || 0
    const outputKg = Number(run.outputKg) || 0
    if (inputKg > 0 && run.sourceStockCode) {
      touch(run.sourceStockCode, run.batchNumber, -inputKg)
    }
    const outputCode = run.outputStockCode || purificationOutputStockCode(run.sourceStockCode)
    if (outputKg > 0 && outputCode) {
      touch(outputCode, run.batchNumber, outputKg)
    }
  }

  for (const shift of cardingShifts ?? []) {
    for (const line of shift.lines ?? []) {
      const inputKg = Number(line.inputKg) || 0
      const outputKg = Number(line.outputKg) || 0
      if (inputKg > 0 && line.sourceStockCode) {
        touch(line.sourceStockCode, line.batchNumber, -inputKg)
      }
      const outputCode =
        line.outputStockCode || cardedOutputStockCode(line.sourceStockCode, shift.fibreLength)
      if (outputKg > 0 && outputCode) {
        touch(outputCode, line.batchNumber, outputKg)
      }
    }
  }
}

export function appendFinishingMovements(movements, purificationRuns = [], cardingShifts = []) {
  for (const run of purificationRuns ?? []) {
    const inputKg = Number(run.inputKg) || 0
    const outputKg = Number(run.outputKg) || 0
    if (run.sourceStockCode && inputKg > 0) {
      movements.push({
        id: `PRUN-OUT-${run.id}`,
        date: run.date,
        stockCode: run.sourceStockCode,
        stockForm: 'Loose',
        direction: 'out',
        quantityKg: inputKg,
        source: 'Purification',
        detail: `Issued to reactor · shift ${run.shiftNumber} run ${run.runNumber}`,
        reference: '',
      })
    }
    const outputCode = run.outputStockCode || purificationOutputStockCode(run.sourceStockCode)
    if (outputCode && outputKg > 0) {
      movements.push({
        id: `PRUN-IN-${run.id}`,
        date: run.date,
        stockCode: outputCode,
        stockForm: 'Loose',
        direction: 'in',
        quantityKg: outputKg,
        source: 'Purification',
        detail: `Purified fibre · shift ${run.shiftNumber} run ${run.runNumber}`,
        reference: '',
      })
    }
  }

  for (const shift of cardingShifts ?? []) {
    for (const line of shift.lines ?? []) {
      const inputKg = Number(line.inputKg) || 0
      const outputKg = Number(line.outputKg) || 0
      if (line.sourceStockCode && inputKg > 0) {
        movements.push({
          id: `CSH-OUT-${line.id}`,
          date: shift.date,
          stockCode: line.sourceStockCode,
          stockForm: 'Loose',
          direction: 'out',
          quantityKg: inputKg,
          source: 'Carding',
          detail: `Issued to carding · shift ${shift.shiftNumber}`,
          reference: '',
        })
      }
      const outputCode =
        line.outputStockCode || cardedOutputStockCode(line.sourceStockCode, shift.fibreLength)
      if (outputCode && outputKg > 0) {
        movements.push({
          id: `CSH-IN-${line.id}`,
          date: shift.date,
          stockCode: outputCode,
          stockForm: 'Loose',
          direction: 'in',
          quantityKg: outputKg,
          source: 'Carding',
          detail: `Carded fibre ${cardedGrade(shift.fibreLength) || outputCode.split('-').slice(-1)[0]} · shift ${shift.shiftNumber}`,
          reference: '',
        })
      }
    }
  }
  return movements
}
