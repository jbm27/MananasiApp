const API_BASE = String(import.meta.env.VITE_API_URL ?? '')
  .trim()
  .replace(/\/+$/, '')

async function parseJsonResponse(response) {
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Server returned invalid JSON')
  }
}

export async function fetchAppState() {
  const response = await fetch(`${API_BASE}/api/state`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const body = await parseJsonResponse(response)
    throw new Error(body?.error ?? `Failed to load app state (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function saveAppState(state) {
  const response = await fetch(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!response.ok) {
    const body = await parseJsonResponse(response)
    throw new Error(body?.error ?? `Failed to save app state (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function postAttendanceEvent(event) {
  const response = await fetch(`${API_BASE}/api/attendance/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!response.ok) {
    const body = await parseJsonResponse(response)
    throw new Error(body?.error ?? `Failed to record attendance (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function fetchAttendanceEvents(limit = 100) {
  const response = await fetch(`${API_BASE}/api/attendance/events?limit=${limit}`)
  if (!response.ok) {
    const body = await parseJsonResponse(response)
    throw new Error(body?.error ?? `Failed to load attendance events (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function fetchAttendanceEventsForPeriod(fromDate, toDate, limit = 5000) {
  const params = new URLSearchParams({
    from: fromDate,
    to: toDate,
    limit: String(limit),
  })
  const response = await fetch(`${API_BASE}/api/attendance/events?${params.toString()}`)
  if (!response.ok) {
    const body = await parseJsonResponse(response)
    throw new Error(body?.error ?? `Failed to load attendance events (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function checkApiHealth() {
  const response = await fetch(`${API_BASE}/api/health`)
  return response.ok
}

async function parseErrorResponse(response, fallbackMessage) {
  const body = await parseJsonResponse(response)
  throw new Error(body?.error ?? fallbackMessage)
}

export async function leadershipLogin(username, password) {
  const response = await fetch(`${API_BASE}/api/auth/leadership/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) {
    await parseErrorResponse(response, `Login failed (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function fetchLeadershipAccounts(adminEmployeeId, adminPassword) {
  const response = await fetch(`${API_BASE}/api/auth/leadership/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminEmployeeId, adminPassword }),
  })
  if (!response.ok) {
    await parseErrorResponse(response, `Failed to load leadership accounts (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function changeLeadershipPassword({
  employeeId,
  currentPassword,
  newPassword,
  confirmPassword,
}) {
  const response = await fetch(`${API_BASE}/api/auth/leadership/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employeeId,
      currentPassword,
      newPassword,
      confirmPassword,
    }),
  })
  if (!response.ok) {
    await parseErrorResponse(response, `Failed to change password (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function setLeadershipPassword({
  adminEmployeeId,
  adminPassword,
  targetEmployeeId,
  newPassword,
  confirmPassword,
}) {
  const response = await fetch(`${API_BASE}/api/auth/leadership/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adminEmployeeId,
      adminPassword,
      targetEmployeeId,
      newPassword,
      confirmPassword,
    }),
  })
  if (!response.ok) {
    await parseErrorResponse(response, `Failed to save password (${response.status})`)
  }
  return parseJsonResponse(response)
}

export async function fetchApiHealthStatus() {
  if (!API_BASE) {
    return { configured: false, healthy: false }
  }

  const response = await fetch(`${API_BASE}/api/health`)
  const text = await response.text()

  try {
    const body = JSON.parse(text)
    if (body?.ok && body?.service === 'mananasi-api') {
      return { configured: true, healthy: true, url: API_BASE }
    }
    return {
      configured: true,
      healthy: false,
      url: API_BASE,
      reason: 'Health endpoint did not return the Mananasi API response.',
    }
  } catch {
    return {
      configured: true,
      healthy: false,
      url: API_BASE,
      reason:
        'This URL is serving the frontend app, not the Express API. On Railway, create a separate service with root directory server and point the scanner at that service domain.',
    }
  }
}
