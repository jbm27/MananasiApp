import { getAppState } from '../stateStore.js'

export async function resolveEmployeeIdFromDevicePin(pin) {
  const raw = String(pin ?? '').trim()
  if (!raw) {
    return null
  }

  const state = await getAppState()
  const employees = Array.isArray(state?.data?.employees) ? state.data.employees : []

  const direct = employees.find((employee) => String(employee.id).trim() === raw)
  if (direct) {
    return direct.id
  }

  const pinWithoutLeadingZeros = raw.replace(/^0+/, '') || '0'
  const fromNumericPin = employees.find((employee) => {
    const id = String(employee.id).trim()
    const idWithoutLeadingZeros = id.replace(/^0+/, '') || '0'
    return idWithoutLeadingZeros === pinWithoutLeadingZeros
  })
  if (fromNumericPin) {
    return fromNumericPin.id
  }

  const legacyBiometric = employees.find(
    (employee) => String(employee.biometricPin ?? '').trim() === raw,
  )
  if (legacyBiometric) {
    return legacyBiometric.id
  }

  const upper = raw.toUpperCase()
  if (upper.startsWith('EMP-')) {
    const legacy = employees.find((employee) => employee.id.toUpperCase() === upper)
    if (legacy) {
      return legacy.id
    }
  }

  return null
}

export function mapZkStatusToEventType(statusCode) {
  const status = Number(statusCode)
  if (status === 0) {
    return 'clock_in'
  }
  if (status === 1) {
    return 'clock_out'
  }
  return null
}

export async function resolveEventTypeForPin(pin, statusCode, clockedInIds = []) {
  const mapped = mapZkStatusToEventType(statusCode)
  if (mapped) {
    return mapped
  }

  const employeeId = await resolveEmployeeIdFromDevicePin(pin)
  if (!employeeId) {
    return 'clock_in'
  }
  return clockedInIds.includes(employeeId) ? 'clock_out' : 'clock_in'
}
