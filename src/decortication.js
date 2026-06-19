export function getDecorticationShiftIdentityKey({ date, machine, shiftNumber }) {
  return `${date}__${machine}__${Number(shiftNumber)}`
}

export function findDuplicateDecorticationShift(
  records,
  { date, machine, shiftNumber },
  excludeRecordId = '',
) {
  const key = getDecorticationShiftIdentityKey({ date, machine, shiftNumber })
  return (records ?? []).find(
    (record) =>
      record.id !== excludeRecordId &&
      getDecorticationShiftIdentityKey(record) === key,
  )
}

export function formatDecorticationShiftConflictMessage({ date, machine, shiftNumber }) {
  const [year, month, day] = String(date ?? '').split('-')
  const displayDate = year && month && day ? `${day}/${month}/${year}` : date
  return `A decortication record for ${machine} shift ${shiftNumber} on ${displayDate} already exists.`
}
