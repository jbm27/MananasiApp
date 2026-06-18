/** Legacy on-hand stock with unknown field origin — assigned to this batch. */
export const OPENING_STOCK_BATCH = '2026-000'

const OPENING_STOCK_DATE = '2026-06-16'
const MACHINE = 'D1'
const TRACE_ROOT = `${OPENING_STOCK_BATCH}-01`

const SOURCE_STOCK = {
  ubr: `${TRACE_ROOT}-UBR`,
  brs: `${TRACE_ROOT}-BRS`,
  tow: `${TRACE_ROOT}-TOW`,
}

function buildBaleSeriesCode(sourceStockCode, baleWeightKg) {
  return `${sourceStockCode}-${Math.round(baleWeightKg)}`
}

function buildBaleCode(sourceStockCode, baleWeightKg, serialNumber) {
  return `${buildBaleSeriesCode(sourceStockCode, baleWeightKg)}-${String(serialNumber).padStart(2, '0')}`
}

function buildSilageBagCode(batchNumber, baggingDate, massKg, bagNumber) {
  const [year, month, day] = baggingDate.split('-')
  const datePart = `${month}${day}${year.slice(-2)}`
  const serialPart = String(bagNumber).padStart(3, '0')
  return `${batchNumber}-${datePart}-SLG-${Math.round(massKg)}-${serialPart}`
}

function buildBalingRecords(sourceStockCode, baleWeightKg, count, gradeCode) {
  const seriesCode = buildBaleSeriesCode(sourceStockCode, baleWeightKg)
  return Array.from({ length: count }, (_, index) => ({
    id: `OPENING-STOCK-BAL-${gradeCode}-${String(index + 1).padStart(3, '0')}`,
    date: OPENING_STOCK_DATE,
    batchNumber: OPENING_STOCK_BATCH,
    machine: MACHINE,
    sourceStockCode,
    baleWeightKg,
    baleSeriesCode: seriesCode,
    baleCode: buildBaleCode(sourceStockCode, baleWeightKg, index + 1),
    supervisorIds: ['SYSTEM'],
    supervisorNames: ['Opening stock'],
    balerIds: [],
    balerNames: [],
  }))
}

export function buildOpeningStockRecords() {
  const ubrBaledKg = 10400
  const ubrLooseKg = 239.1
  const brsBaledKg = 11900
  const brsLooseKg = 7.2
  const towBaledKg = 2750
  const towLooseKg = 44.8

  const dryingRecords = [
    {
      id: 'OPENING-STOCK-DRY-UBR',
      decorticationRecordId: 'OPENING-STOCK-DEC-01',
      decorticationDate: OPENING_STOCK_DATE,
      weighedDate: OPENING_STOCK_DATE,
      machine: MACHINE,
      shiftNumber: 1,
      batchNumber: OPENING_STOCK_BATCH,
      bundleWeights: [Number((ubrBaledKg + ubrLooseKg).toFixed(1))],
      totalDriedKg: Number((ubrBaledKg + ubrLooseKg).toFixed(1)),
      dryingTimeDays: 0,
      dryerId: 'SYSTEM',
      dryerName: 'Opening stock',
    },
  ]

  const brushingDailyRecords = [
    {
      id: 'OPENING-STOCK-BRD-01',
      date: OPENING_STOCK_DATE,
      batchNumber: OPENING_STOCK_BATCH,
      sourceStockCode: SOURCE_STOCK.ubr,
      machine: MACHINE,
      supervisorIds: ['SYSTEM'],
      supervisorNames: ['Opening stock'],
      brusherIds: ['SYSTEM'],
      brusherNames: ['Opening stock'],
      ubrUsedKg: 0,
      brsKg: Number((brsBaledKg + brsLooseKg).toFixed(1)),
      towKg: Number((towBaledKg + towLooseKg).toFixed(1)),
      efficiency: 0,
      dustLossKg: 0,
    },
  ]

  const balingRecords = [
    ...buildBalingRecords(SOURCE_STOCK.ubr, 100, 104, 'UBR'),
    ...buildBalingRecords(SOURCE_STOCK.brs, 100, 119, 'BRS'),
    ...buildBalingRecords(SOURCE_STOCK.tow, 50, 55, 'TOW'),
  ]

  const silageRecords = Array.from({ length: 92 }, (_, index) => ({
    id: `OPENING-STOCK-SLG-${String(index + 1).padStart(3, '0')}`,
    date: OPENING_STOCK_DATE,
    batchNumber: OPENING_STOCK_BATCH,
    massKg: 50,
    bagCode: buildSilageBagCode(OPENING_STOCK_BATCH, OPENING_STOCK_DATE, 50, index + 1),
    supervisorId: 'SYSTEM',
    supervisorName: 'Opening stock',
    operatorIds: [],
    operatorNames: [],
  }))

  return {
    dryingRecords,
    brushingDailyRecords,
    balingRecords,
    silageRecords,
  }
}

function hasOpeningStockRecords(data) {
  const collections = [
    data.dryingRecords,
    data.brushingDailyRecords,
    data.balingRecords,
    data.silageRecords,
  ]
  return collections.some(
    (items) =>
      Array.isArray(items) &&
      items.some((item) => String(item?.id ?? '').startsWith('OPENING-STOCK-')),
  )
}

export function mergeOpeningStockRecords(data) {
  if (!data || typeof data !== 'object' || hasOpeningStockRecords(data)) {
    return data
  }

  const opening = buildOpeningStockRecords()
  return {
    ...data,
    dryingRecords: [...(Array.isArray(data.dryingRecords) ? data.dryingRecords : []), ...opening.dryingRecords],
    brushingDailyRecords: [
      ...(Array.isArray(data.brushingDailyRecords) ? data.brushingDailyRecords : []),
      ...opening.brushingDailyRecords,
    ],
    balingRecords: [
      ...(Array.isArray(data.balingRecords) ? data.balingRecords : []),
      ...opening.balingRecords,
    ],
    silageRecords: [
      ...(Array.isArray(data.silageRecords) ? data.silageRecords : []),
      ...opening.silageRecords,
    ],
  }
}
