import { normalizeEmployeeName } from './employeeWorkNumberAssignments.js'

export function buildEmployeeIdMapFromNameMatch(storedEmployees, mergedEmployees) {
  const mergedByName = new Map(
    mergedEmployees.map((employee) => [normalizeEmployeeName(employee.name), employee.id]),
  )
  const map = new Map()
  for (const employee of storedEmployees) {
    const newId = mergedByName.get(normalizeEmployeeName(employee.name))
    if (newId && String(employee.id) !== String(newId)) {
      map.set(String(employee.id), newId)
    }
  }
  return map
}

const EMPLOYEE_SCALAR_KEYS = new Set([
  'employeeId',
  'targetEmployeeId',
  'harvesterId',
  'recordedById',
  'driverId',
  'supervisorId',
  'dryerId',
  'balerId',
  'operatorId',
  'assignedById',
  'approvedById',
  'receivedById',
  'receiverEmployeeId',
])

const EMPLOYEE_ARRAY_KEYS = new Set([
  'clockedInIds',
  'loaderIds',
  'operatorIds',
  'supervisorIds',
  'balerIds',
  'dryerIds',
  'brusherIds',
])

const EMPLOYEE_OBJECT_KEY_OBJECTS = new Set([
  'pagePermissionOverrides',
  'dataEntryPermissionOverrides',
  'poApprovalLimits',
  'leaderPasswordHashes',
])

const PERIOD_NESTED_EMPLOYEE_KEY_OBJECTS = new Set([
  'payrollAdjustments',
  'salaryPayrollAdjustments',
])

function remapEmployeeId(value, idMap) {
  if (typeof value !== 'string') {
    return value
  }
  return idMap.get(value) ?? value
}

function remapEmployeeIdArray(values, idMap) {
  if (!Array.isArray(values)) {
    return values
  }
  return values.map((value) => remapEmployeeId(value, idMap))
}

function remapEmployeeObjectKeys(value, idMap) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const next = {}
  for (const [key, entryValue] of Object.entries(value)) {
    next[remapEmployeeId(key, idMap)] = entryValue
  }
  return next
}

function remapPeriodKeyedEmployeeObject(value, idMap) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const next = {}
  for (const [periodId, periodValue] of Object.entries(value)) {
    if (!periodValue || typeof periodValue !== 'object' || Array.isArray(periodValue)) {
      next[periodId] = periodValue
      continue
    }
    const remappedPeriod = {}
    for (const [employeeId, entry] of Object.entries(periodValue)) {
      remappedPeriod[remapEmployeeId(employeeId, idMap)] = remapNode(entry, idMap, {})
    }
    next[periodId] = remappedPeriod
  }
  return next
}

function remapNode(value, idMap, context = {}) {
  if (Array.isArray(value)) {
    if (context.employeeArray) {
      return value.map((employee) => {
        if (!employee || typeof employee !== 'object') {
          return employee
        }
        return {
          ...remapNode(employee, idMap, context),
          id: remapEmployeeId(employee.id, idMap),
        }
      })
    }
    return value.map((item) => remapNode(item, idMap, context))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const next = {}
  for (const [key, entryValue] of Object.entries(value)) {
    if (key === 'employees' && Array.isArray(entryValue)) {
      next[key] = remapNode(entryValue, idMap, { employeeArray: true })
      continue
    }
    if (EMPLOYEE_OBJECT_KEY_OBJECTS.has(key)) {
      next[key] = remapEmployeeObjectKeys(entryValue, idMap)
      continue
    }
    if (PERIOD_NESTED_EMPLOYEE_KEY_OBJECTS.has(key)) {
      next[key] = remapPeriodKeyedEmployeeObject(entryValue, idMap)
      continue
    }
    if (EMPLOYEE_SCALAR_KEYS.has(key)) {
      next[key] = remapEmployeeId(entryValue, idMap)
      continue
    }
    if (EMPLOYEE_ARRAY_KEYS.has(key)) {
      next[key] = remapEmployeeIdArray(entryValue, idMap)
      continue
    }
    next[key] = remapNode(entryValue, idMap, context)
  }
  return next
}

export function remapEmployeeIdsInAppState(data, idMap) {
  if (!data || typeof data !== 'object' || idMap.size === 0) {
    return data
  }
  return remapNode(data, idMap, {})
}

export function remapLeadershipPasswordHashes(hashes, idMap) {
  if (!hashes || typeof hashes !== 'object' || idMap.size === 0) {
    return hashes
  }
  return remapEmployeeObjectKeys(hashes, idMap)
}
