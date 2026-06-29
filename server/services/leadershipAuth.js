import { createHash } from 'crypto'
import { getAppState } from '../stateStore.js'
import {
  getLeadershipPasswordHashes,
  setLeadershipPasswordHash,
} from './leadershipAuthStore.js'

const leadershipTeamEmployeeIds = new Set(['0001', '0008', '0013', '0003', '0012'])

export function buildLoginUsername(displayName) {
  return String(displayName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]+/g, '')
}

export function sha256Hex(message) {
  return createHash('sha256').update(String(message)).digest('hex')
}

function isLeadershipTeamMember(employee) {
  if (!employee || employee.role === 'inactive') {
    return false
  }
  if (leadershipTeamEmployeeIds.has(employee.id)) {
    return true
  }
  return ['admin', 'harvesting-manager', 'production-manager', 'director'].includes(employee.role)
}

async function getEmployees() {
  const state = await getAppState()
  return Array.isArray(state?.data?.employees) ? state.data.employees : []
}

async function verifyMemberPassword(employeeId, password) {
  const employees = await getEmployees()
  const member = employees.find((employee) => employee.id === employeeId)
  if (!member || !isLeadershipTeamMember(member)) {
    return { ok: false, error: 'That account cannot change a leadership sign-in password.' }
  }

  const hashes = await getLeadershipPasswordHashes()
  const storedHash = hashes[employeeId]
  if (storedHash) {
    if (sha256Hex(password) !== storedHash) {
      return { ok: false, error: 'Current password is incorrect.' }
    }
  } else if (String(password ?? '').trim() !== '') {
    return {
      ok: false,
      error: 'No password is set yet. Leave the current password blank to set your first password.',
    }
  }

  return { ok: true, member }
}

export async function changeLeadershipPasswordForUser({
  employeeId,
  currentPassword,
  newPassword,
  confirmPassword,
}) {
  const actor = await verifyMemberPassword(employeeId, currentPassword)
  if (!actor.ok) {
    return actor
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: 'New passwords do not match.' }
  }
  if (String(newPassword).length < 6) {
    return { ok: false, error: 'Use at least 6 characters.' }
  }

  await setLeadershipPasswordHash(employeeId, sha256Hex(String(newPassword)))
  return { ok: true }
}

export async function verifyLeadershipLogin(username, password) {
  const normalized = buildLoginUsername(username)
  if (!normalized) {
    return { ok: false, error: 'Enter your username.' }
  }

  const employees = await getEmployees()
  const leadership = employees.filter(isLeadershipTeamMember)
  const member = leadership.find((employee) => buildLoginUsername(employee.name) === normalized)
  if (!member) {
    return { ok: false, error: 'That username was not found.' }
  }

  const hashes = await getLeadershipPasswordHashes()
  const storedHash = hashes[member.id]
  if (storedHash) {
    const attempt = sha256Hex(password)
    if (attempt !== storedHash) {
      return { ok: false, error: 'Incorrect password.' }
    }
  } else if (String(password ?? '').trim() !== '') {
    return {
      ok: false,
      error:
        'No password has been saved for this account yet. Sign in once with a blank password.',
    }
  }

  return {
    ok: true,
    employee: {
      id: member.id,
      name: member.name,
      role: member.role,
    },
  }
}

async function verifyAdminActor(adminEmployeeId, adminPassword) {
  const employees = await getEmployees()
  const admin = employees.find((employee) => employee.id === adminEmployeeId)
  if (!admin || admin.role !== 'admin') {
    return { ok: false, error: 'Only an administrator can manage leadership sign-in accounts.' }
  }

  const hashes = await getLeadershipPasswordHashes()
  const storedHash = hashes[admin.id]
  if (storedHash) {
    if (sha256Hex(adminPassword) !== storedHash) {
      return { ok: false, error: 'Incorrect administrator password.' }
    }
  } else if (String(adminPassword ?? '').trim() !== '') {
    return { ok: false, error: 'Administrator password is not set yet. Sign in with a blank password first.' }
  }

  return { ok: true, admin }
}

export async function listLeadershipAccountsForAdmin(adminEmployeeId, adminPassword) {
  const actor = await verifyAdminActor(adminEmployeeId, adminPassword)
  if (!actor.ok) {
    return actor
  }

  const employees = await getEmployees()
  const hashes = await getLeadershipPasswordHashes()
  const accounts = employees
    .filter(isLeadershipTeamMember)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((employee) => ({
      employeeId: employee.id,
      name: employee.name,
      username: buildLoginUsername(employee.name),
      hasPassword: Boolean(hashes[employee.id]),
    }))

  return { ok: true, accounts }
}

export async function setLeadershipPasswordForAdmin({
  adminEmployeeId,
  adminPassword,
  targetEmployeeId,
  newPassword,
  confirmPassword,
}) {
  const actor = await verifyAdminActor(adminEmployeeId, adminPassword)
  if (!actor.ok) {
    return actor
  }

  const employees = await getEmployees()
  const target = employees.find((employee) => employee.id === targetEmployeeId)
  if (!target || !isLeadershipTeamMember(target)) {
    return { ok: false, error: 'That person is not on the leadership team.' }
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' }
  }
  if (String(newPassword).length < 6) {
    return { ok: false, error: 'Use at least 6 characters.' }
  }

  await setLeadershipPasswordHash(targetEmployeeId, sha256Hex(String(newPassword)))
  return { ok: true }
}
