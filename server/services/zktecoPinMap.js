import { getAppState } from '../stateStore.js'

function padEmployeeNumber(value) {
  const digits = String(value).replace(/\D/g, '')
  if (!digits) {
    return ''
  }
  return digits.padStart(3, '0')
}

export async function resolveEmployeeIdFromDevicePin(pin) {
  const raw = String(pin ?? '').trim()
  if (!raw) {
    return null
  }

  const state = await getAppState()
  const employees = Array.isArray(state?.data?.employees) ? state.data.employees : []

  const direct = employees.find((employee) => employee.id === raw)
  if (direct) {
    return direct.id
  }

  const upper = raw.toUpperCase()
  if (upper.startsWith('EMP-')) {
    const match = employees.find((employee) => employee.id.toUpperCase() === upper)
    if (match) {
      return match.id
    }
  }

  const padded = padEmployeeNumber(raw)
  if (padded) {
    const byCode = employees.find((employee) => employee.id === `EMP-${padded}`)
    if (byCode) {
      return byCode.id
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
