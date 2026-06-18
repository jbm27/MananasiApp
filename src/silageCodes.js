function normalizeBatchNumber(batchNumber) {
  const [yearPart, fieldPart] = String(batchNumber ?? '').split('-')
  const year = Number(yearPart)
  const field = Number(fieldPart)
  if (Number.isNaN(year) || Number.isNaN(field)) {
    return String(batchNumber ?? '')
  }
  return `${year}-${String(field).padStart(3, '0')}`
}

export const SILAGE_DRY_MATTER_OPTIONS = [25, 35]

export function normalizeSilageDryMatterPercent(value) {
  const numeric = Number(value)
  if (numeric === 25) {
    return 25
  }
  return 35
}

export function getSilageProductCodeSuffix(dryMatterPercent) {
  return `SLG${normalizeSilageDryMatterPercent(dryMatterPercent)}`
}

export function findSilageGradeInBagCode(bagCode) {
  const parts = String(bagCode ?? '').split('-')
  for (const grade of ['SLG25', 'SLG35', 'SLG']) {
    const index = parts.indexOf(grade)
    if (index >= 0) {
      return { grade, index, parts }
    }
  }
  return null
}

export function getSilageDryMatterFromBagCode(bagCode) {
  const match = findSilageGradeInBagCode(bagCode)
  if (!match) {
    return 35
  }
  if (match.grade === 'SLG25') {
    return 25
  }
  return 35
}

/** Stock series code, e.g. 2026-000-SLG35-050 */
export function buildSilageSeriesCode(batchNumber, massKg, dryMatterPercent = 35) {
  const normalizedBatch = normalizeBatchNumber(batchNumber)
  const massPart = String(Math.round(Number(massKg))).padStart(3, '0')
  return `${normalizedBatch}-${getSilageProductCodeSuffix(dryMatterPercent)}-${massPart}`
}

/** Individual bag label code, e.g. 2026-000-SLG35-050-0001 */
export function buildSilageBagCode(batchNumber, massKg, bagNumber, dryMatterPercent = 35) {
  const serialPart = String(bagNumber).padStart(4, '0')
  return `${buildSilageSeriesCode(batchNumber, massKg, dryMatterPercent)}-${serialPart}`
}

export function parseSilageBagCode(bagCode, record = {}) {
  const match = findSilageGradeInBagCode(bagCode)
  if (!match) {
    return null
  }
  const { grade, index, parts } = match
  const batch = normalizeBatchNumber(`${parts[0]}-${parts[1]}`)
  const normalizedGrade = grade === 'SLG' ? 'SLG35' : grade
  const dm = normalizedGrade === 'SLG25' ? 25 : 35
  const massIndex = index + 1
  const massRaw = parts[massIndex] ?? String(Math.round(record.massKg ?? 50))
  const massKg = Number(massRaw)
  const serialPart = parts[massIndex + 1]
  const serial = serialPart !== undefined ? Number(serialPart) : 0
  return {
    batch,
    grade: normalizedGrade,
    dm,
    massKg: Number.isNaN(massKg) ? Math.round(record.massKg ?? 50) : massKg,
    serial: Number.isNaN(serial) ? 0 : serial,
  }
}

export function migrateLegacySilageBagCode(bagCode, record = {}) {
  const parsed = parseSilageBagCode(bagCode, record)
  if (!parsed) {
    if (record?.batchNumber && record?.massKg) {
      return buildSilageBagCode(
        record.batchNumber,
        record.massKg,
        1,
        record.dryMatterPercent ?? 35,
      )
    }
    return String(bagCode ?? '')
  }
  if (!parsed.serial) {
    return buildSilageSeriesCode(parsed.batch, parsed.massKg, parsed.dm)
  }
  return buildSilageBagCode(parsed.batch, parsed.massKg, parsed.serial, parsed.dm)
}

export function getSilageBagSerialFromCode(bagCode) {
  const parsed = parseSilageBagCode(bagCode)
  return parsed?.serial ?? 0
}

export function getSilageBagSeriesCode(record) {
  const bagCode = migrateLegacySilageBagCode(record.bagCode ?? '', record)
  const parsed = parseSilageBagCode(bagCode, record)
  if (parsed) {
    return buildSilageSeriesCode(parsed.batch, parsed.massKg, parsed.dm)
  }
  return buildSilageSeriesCode(
    record.batchNumber,
    record.massKg,
    normalizeSilageDryMatterPercent(record.dryMatterPercent ?? 35),
  )
}

export function migrateSilageRecord(record) {
  if (!record || typeof record !== 'object') {
    return record
  }
  const bagCode = migrateLegacySilageBagCode(record.bagCode, record)
  const parsed = parseSilageBagCode(bagCode, record)
  return {
    ...record,
    bagCode,
    dryMatterPercent: parsed?.dm ?? record.dryMatterPercent ?? 35,
  }
}
