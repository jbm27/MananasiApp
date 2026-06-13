import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { jsPDF } from 'jspdf'
import './App.css'
import PayrollPage from './PayrollPage.jsx'
import {
  canApprovePayroll,
  createPayrollApproval,
  isPayrollPeriodApproved,
} from './payroll.js'
import { formatKenyaDateTime } from './kenyaTime.js'
import logoStandard from '../LogoStandard.png'
import { mananasiStaffEmployees } from './mananasiStaffEmployees.js'
import {
  calculateHarvestWage,
  getContractTypeLabel,
  getEmployeeDailyWageKes,
  getSeasonalGradeLabel,
} from './employeePay.js'
import {
  CONTRACT_TYPE_OPTIONS,
  SEASONAL_GRADE_OPTIONS,
  createBlankEmployeeTemplate,
  employeeRecordsNeedSeedMerge,
  formatEmployeeFieldValue,
  mergeEmployeesWithSeed,
  parseEmployeeProfileFromForm,
} from './employeeFields.js'

const RECENT_CLOCK_EVENTS_LIMIT = 10
import { useBackendSync } from './hooks/useBackendSync.js'
import {
  fetchAppState,
  fetchAttendanceEvents,
  fetchLeadershipAccounts,
  leadershipLogin,
  setLeadershipPassword,
} from './api/client.js'

function nextEmployeeWorkNumber(employees) {
  return (
    employees.reduce((max, employee) => {
      const digits = Number(String(employee.id).replace(/\D/g, ''))
      return Number.isFinite(digits) ? Math.max(max, digits) : max
    }, 1000) + 1
  )
}

function buildDemoClockedInIds(employeeList) {
  const ids = new Set()
  employeeList
    .filter((employee) => employee.role === 'harvester')
    .slice(0, 10)
    .forEach((employee) => ids.add(employee.id))
  employeeList
    .filter((employee) => employee.role === 'truck-driver')
    .forEach((employee) => ids.add(employee.id))
  employeeList
    .filter((employee) => employee.role === 'decorticator-operator')
    .slice(0, 14)
    .forEach((employee) => ids.add(employee.id))
  employeeList
    .filter((employee) => employee.role === 'decortication-supervisor')
    .forEach((employee) => ids.add(employee.id))
  employeeList
    .filter((employee) => employee.role === 'harvesting-manager')
    .forEach((employee) => ids.add(employee.id))
  return [...ids]
}

const seedHarvesters = mananasiStaffEmployees.filter((employee) => employee.role === 'harvester')
const seedHarvestSupervisors = mananasiStaffEmployees.filter(
  (employee) =>
    employee.role === 'harvesting-supervisor' || employee.role === 'harvesting-manager',
)
const initialDemoClockedInIds = buildDemoClockedInIds(mananasiStaffEmployees)
const activityModules = [
  {
    id: 'harvesting',
    name: 'Harvesting',
    summary: 'Track leaf collection volumes, field teams, and daily totals.',
  },
  {
    id: 'haulage',
    name: 'Haulage',
    summary: 'Plan trucks, routes, and delivery confirmation to factory.',
  },
  {
    id: 'decortication',
    name: 'Decortication',
    summary: 'Capture machine throughput, extracted fibre, and downtime.',
  },
  {
    id: 'drying',
    name: 'Drying',
    summary: 'Record batches on drying racks and moisture checks.',
  },
  {
    id: 'brushing',
    name: 'Brushing',
    summary: 'Log brushing runs, quality notes, and impurity removal.',
  },
  {
    id: 'baling',
    name: 'Baling',
    summary: 'Create bale records, weights, lot IDs, and export readiness.',
  },
  {
    id: 'silage-production',
    name: 'Silage Production',
    summary: 'Track decortication residue processing and bagging output.',
  },
  {
    id: 'invoicing',
    name: 'Invoicing',
    summary: 'Create proforma invoices and convert confirmed deals into invoices.',
  },
  {
    id: 'worker-transport',
    name: 'Worker Transport',
    summary: 'Manage staff pickup routes, vehicle allocation, and trip logs.',
  },
]

const PAGE_PERMISSIONS_STORAGE_KEY = 'mananasiPagePermissions'
const DATA_ENTRY_PERMISSIONS_STORAGE_KEY = 'mananasiDataEntryPermissions'

const PAGE_ACCESS_IDS = [
  'dashboard',
  'employees',
  'customers',
  'stock',
  'harvesting',
  'haulage',
  'worker-transport',
  'decortication',
  'drying',
  'brushing',
  'baling',
  'silage-production',
  'invoicing',
  'payroll',
]

const PAGE_ACCESS_LABELS = {
  dashboard: 'Dashboard',
  employees: 'Employees',
  customers: 'Customers',
  stock: 'Stock',
  harvesting: 'Harvesting',
  haulage: 'Haulage',
  'worker-transport': 'Worker transport',
  decortication: 'Decortication',
  drying: 'Drying',
  brushing: 'Brushing',
  baling: 'Baling',
  'silage-production': 'Silage production',
  invoicing: 'Invoicing',
  payroll: 'Payroll',
}

const DATA_ENTRY_PERMISSION_IDS = [
  'harvesting-entry',
  'harvesting-batch',
  'harvesting-compensation',
  'haulage-trip',
  'haulage-mileage',
  'decortication-entry',
  'drying-entry',
  'brushing-entry',
  'baling-entry',
  'silage-entry',
]

const DATA_ENTRY_PERMISSION_LABELS = {
  'harvesting-entry': 'Harvesting weight entry',
  'harvesting-batch': 'Harvesting batch allocation',
  'harvesting-compensation': 'Harvesting incentive rule',
  'haulage-trip': 'Haulage trip creation',
  'haulage-mileage': 'Haulage mileage, fuel, and maintenance',
  'decortication-entry': 'Decortication shift and production entry',
  'drying-entry': 'Drying entries',
  'brushing-entry': 'Brushing stock and outputs entry',
  'baling-entry': 'Baling creation',
  'silage-entry': 'Silage bag creation',
}

/** Policy defaults from organisation roles; James (admin) always receives full access in code. */
const DEFAULT_PAGE_ACCESS_BY_EMPLOYEE_ID = {
  '1002': ['dashboard', 'employees', 'payroll'],
  '1010': ['dashboard', 'employees', 'invoicing', 'customers', 'stock', 'payroll'],
  '1018': ['dashboard', 'stock'],
  '1019': [...PAGE_ACCESS_IDS],
  '1004': [
    'dashboard',
    'stock',
    'decortication',
    'silage-production',
    'brushing',
    'baling',
    'drying',
  ],
  '1005': [
    'dashboard',
    'stock',
    'decortication',
    'silage-production',
    'brushing',
    'baling',
    'drying',
  ],
  '1009': ['dashboard', 'harvesting', 'haulage', 'worker-transport'],
  '1017': ['dashboard', 'harvesting'],
}

function readPagePermissionOverrides() {
  if (typeof localStorage === 'undefined') {
    return {}
  }
  try {
    const raw = localStorage.getItem(PAGE_PERMISSIONS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
    return {}
  } catch {
    return {}
  }
}

function readDataEntryPermissionOverrides() {
  if (typeof localStorage === 'undefined') {
    return {}
  }
  try {
    const raw = localStorage.getItem(DATA_ENTRY_PERMISSIONS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
    return {}
  } catch {
    return {}
  }
}

function pathnameToRequiredPageId(pathname) {
  const path = pathname || ''
  if (path === '/' || path === '') {
    return null
  }
  if (path.startsWith('/employees')) {
    return 'employees'
  }
  if (path.startsWith('/customers')) {
    return 'customers'
  }
  if (path.startsWith('/stock')) {
    return 'stock'
  }
  if (path.startsWith('/activities/harvesting')) {
    return 'harvesting'
  }
  if (path.startsWith('/activities/haulage')) {
    return 'haulage'
  }
  if (path.startsWith('/activities/worker-transport')) {
    return 'worker-transport'
  }
  if (path.startsWith('/activities/decortication')) {
    return 'decortication'
  }
  if (path.startsWith('/activities/drying')) {
    return 'drying'
  }
  if (path.startsWith('/activities/brushing')) {
    return 'brushing'
  }
  if (path.startsWith('/activities/baling')) {
    return 'baling'
  }
  if (path.startsWith('/activities/silage-production')) {
    return 'silage-production'
  }
  if (path.startsWith('/activities/invoicing')) {
    return 'invoicing'
  }
  if (path.startsWith('/payroll')) {
    return 'payroll'
  }
  if (path.startsWith('/activities/')) {
    return null
  }
  return null
}

function getBasePageListForEditor(employeeId, overrides, employees) {
  const employee = employees.find((item) => item.id === employeeId)
  if (employee?.role === 'admin') {
    return [...PAGE_ACCESS_IDS]
  }
  const override = overrides[employeeId]
  if (Array.isArray(override)) {
    return [...override]
  }
  if (DEFAULT_PAGE_ACCESS_BY_EMPLOYEE_ID[employeeId]) {
    return [...DEFAULT_PAGE_ACCESS_BY_EMPLOYEE_ID[employeeId]]
  }
  return ['dashboard']
}

function getEffectivePagePermissions(employeeId, overrides, employees) {
  const employee = employees.find((item) => item.id === employeeId)
  if (employee?.role === 'admin') {
    return new Set(PAGE_ACCESS_IDS)
  }
  const base = getBasePageListForEditor(employeeId, overrides, employees)
  const set = new Set(base)
  set.add('dashboard')
  return set
}

function getDefaultDataEntryPermissionsForRole(role) {
  if (role === 'admin') {
    return [...DATA_ENTRY_PERMISSION_IDS]
  }
  if (role === 'harvesting-manager') {
    return ['harvesting-entry', 'harvesting-batch', 'haulage-mileage']
  }
  if (role === 'harvesting-supervisor') {
    return ['harvesting-entry']
  }
  if (role === 'truck-driver') {
    return ['haulage-trip']
  }
  if (role === 'production-manager') {
    return [
      'decortication-entry',
      'drying-entry',
      'brushing-entry',
      'baling-entry',
      'silage-entry',
    ]
  }
  if (role === 'decortication-supervisor') {
    return ['decortication-entry']
  }
  if (role === 'dryer') {
    return ['drying-entry']
  }
  if (role === 'brushing-supervisor') {
    return ['brushing-entry']
  }
  if (role === 'baling-supervisor') {
    return ['baling-entry']
  }
  if (role === 'silage-supervisor') {
    return ['silage-entry']
  }
  return []
}

function getBaseDataEntryPermissionsForEditor(employeeId, overrides, employees) {
  const employee = employees.find((item) => item.id === employeeId)
  if (!employee) {
    return []
  }
  const override = overrides[employeeId]
  if (Array.isArray(override)) {
    return override.filter((id) => DATA_ENTRY_PERMISSION_IDS.includes(id))
  }
  return getDefaultDataEntryPermissionsForRole(employee.role)
}

function getEffectiveDataEntryPermissions(employeeId, overrides, employees) {
  const employee = employees.find((item) => item.id === employeeId)
  if (!employee) {
    return new Set()
  }
  if (employee.role === 'admin') {
    return new Set(DATA_ENTRY_PERMISSION_IDS)
  }
  return new Set(getBaseDataEntryPermissionsForEditor(employeeId, overrides, employees))
}

function GatedRoutes({ allowedPages, children }) {
  const location = useLocation()
  const required = pathnameToRequiredPageId(location.pathname)
  if (required && !allowedPages.has(required)) {
    return <Navigate to="/" replace />
  }
  return children
}

const integrationDevice = {
  name: 'ZKTeco Horus E1-FP',
  fit: 'Primary biometric device planned for attendance with field GSM/4G connectivity.',
}

const initialCustomers = [
  {
    id: 'CUST-001',
    name: 'Ita Francia Linen Knitting Company Limited',
    addressLine1: '4th floor 3th building',
    addressLine2: '26th Zhenxing Road, Chancheng District',
    city: 'Foshan City',
    postCode: '',
    country: 'China',
    email: '',
    phone: '',
    companyRegistration: '91440605L082304604',
  },
]

const defaultCompensationRules = {
  incentiveThresholdKg: 250,
  incentiveRateKesPerKg: 1,
}

function seededKg(employeeIndex, dayOffset) {
  const raw = ((employeeIndex + 3) * 37 + dayOffset * 19) % 351
  return 200 + raw
}

function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

const employeeRoleOptions = [
  { value: 'harvester', label: 'Harvester' },
  { value: 'general-staff', label: 'General / Office Staff' },
  { value: 'harvesting-supervisor', label: 'Harvesting Supervisor' },
  { value: 'harvesting-manager', label: 'Harvesting Manager' },
  { value: 'production-manager', label: 'Production Manager' },
  { value: 'decortication-supervisor', label: 'Decortication Supervisor' },
  { value: 'decorticator-operator', label: 'Decorticator Operator' },
  { value: 'truck-driver', label: 'Truck Driver' },
  { value: 'loader', label: 'Loader' },
  { value: 'dryer', label: 'Dryer' },
  { value: 'brushing-supervisor', label: 'Brushing Supervisor' },
  { value: 'brusher', label: 'Brusher' },
  { value: 'baling-supervisor', label: 'Baling Supervisor' },
  { value: 'baler', label: 'Baler' },
  { value: 'silage-supervisor', label: 'Silage Supervisor' },
  { value: 'silage-operator', label: 'Silage Operator' },
  { value: 'admin', label: 'Admin' },
]

function getEmployeeRoleLabel(role) {
  return employeeRoleOptions.find((item) => item.value === role)?.label ?? 'Supervisor'
}

function getEmployeePermissionSummary(role) {
  if (role === 'admin') return 'Can manage employees and compensation settings'
  if (role === 'general-staff') return 'Directory profile only; no operational modules'
  if (role === 'harvesting-manager') {
    return 'Can manage employees, active batch number, payroll profile fields, and harvest data entry'
  }
  if (role === 'production-manager') return 'Can assign decortication staff and capture machine metrics'
  if (role === 'decortication-supervisor') return 'Decortication machine supervision'
  if (role === 'decorticator-operator') return 'Decortication machine operations'
  if (role === 'truck-driver') return 'Can create haulage trips (must be clocked in)'
  if (role === 'loader') return 'Attendance and trip assignment only (no app entry)'
  if (role === 'dryer') return 'Can record drying bundle weights (must be clocked in)'
  if (role === 'brushing-supervisor') return 'Can issue/return UBR and capture brushing outputs'
  if (role === 'brusher') return 'Brushing line operations and attendance tracking'
  if (role === 'baling-supervisor') return 'Can convert BRS stock into coded bales'
  if (role === 'baler') return 'Bale compression and barcode label operations'
  if (role === 'silage-supervisor') return 'Can create coded silage bag stock records and labels'
  if (role === 'silage-operator') return 'Silage processing operations and attendance tracking'
  if (role === 'harvesting-supervisor') return 'Can enter kg for any clocked-in harvester'
  return 'No app access; attendance clock-in only'
}

function getInclusiveDays(fromDate, toDate) {
  const from = new Date(fromDate)
  const to = new Date(toDate)
  const diffMs = to.getTime() - from.getTime()
  return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1)
}

function listDatesInRange(fromDate, toDate) {
  const dates = []
  const cursor = new Date(fromDate)
  const end = new Date(toDate)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function countMondaySaturdayWorkDays(fromDate, toDate) {
  return listDatesInRange(fromDate, toDate).filter((dateStr) => {
    const day = new Date(`${dateStr}T12:00:00`).getDay()
    return day >= 1 && day <= 6
  }).length
}

function buildBatchNumber(startYear, fieldNumber) {
  return `${startYear}-${String(fieldNumber).padStart(3, '0')}`
}

function normalizeBatchNumber(batchNumber) {
  const [yearPart, fieldPart] = String(batchNumber ?? '').split('-')
  const year = Number(yearPart)
  const field = Number(fieldPart)
  if (Number.isNaN(year) || Number.isNaN(field)) {
    return String(batchNumber ?? '')
  }
  return buildBatchNumber(year, field)
}

function buildTraceabilityCode(batchNumber, machineCode) {
  const normalizedBatch = normalizeBatchNumber(batchNumber)
  const machineNumber = Number(String(machineCode ?? '').replace(/[^\d]/g, ''))
  if (Number.isNaN(machineNumber) || machineNumber <= 0) {
    return `${normalizedBatch}-00`
  }
  return `${normalizedBatch}-${String(machineNumber).padStart(2, '0')}`
}

function buildStockCode(batchNumber, machineCode, grade = 'UBR') {
  return `${buildTraceabilityCode(batchNumber, machineCode)}-${grade}`
}

function getMachineFromStockCode(stockCode) {
  const parts = String(stockCode ?? '').split('-')
  if (parts.length < 4) {
    return 'N/A'
  }
  const machinePart = parts[2]
  const machineNumber = Number(machinePart)
  if (Number.isNaN(machineNumber) || machineNumber <= 0) {
    return 'N/A'
  }
  return `D${machineNumber}`
}

function buildBaleSeriesCode(sourceStockCode, baleWeightKg) {
  return `${sourceStockCode}-${Math.round(baleWeightKg)}`
}

function buildBaleCode(sourceStockCode, baleWeightKg, serialNumber) {
  return `${buildBaleSeriesCode(sourceStockCode, baleWeightKg)}-${String(serialNumber).padStart(2, '0')}`
}

function buildSilageBagCode(batchNumber, baggingDate, massKg, bagNumber) {
  const normalizedBatch = normalizeBatchNumber(batchNumber)
  const [year, month, day] = String(baggingDate ?? '').split('-')
  const datePart =
    year && month && day ? `${month}${day}${year.slice(-2)}` : new Date().toISOString().slice(5, 7) + new Date().toISOString().slice(8, 10) + new Date().toISOString().slice(2, 4)
  const massPart = String(Math.round(Number(massKg))).padStart(2, '0')
  const serialPart = String(bagNumber).padStart(3, '0')
  return `${normalizedBatch}-${datePart}-${massPart}-${serialPart}-SLG`
}

function getInvoiceDescriptionFromProductCode(productCode) {
  const suffix = String(productCode ?? '').split('-').at(-1)
  if (suffix === 'UBR') {
    return 'Pineapple Leaf Fibre'
  }
  if (suffix === 'BRS') {
    return 'Brushed Pineapple Leaf Fibre'
  }
  if (suffix === 'TOW') {
    return 'Residue Pineapple Leaf Fibre'
  }
  if (suffix === 'SLG') {
    return 'Silage'
  }
  if (suffix === 'CUS') {
    return ''
  }
  return 'Custom Item'
}

function buildBarcodeBits(value) {
  const text = String(value ?? '')
  let bits = '1010'
  for (const char of text) {
    bits += char.charCodeAt(0).toString(2).padStart(7, '0')
    bits += '0'
  }
  bits += '1011'
  return bits
}

function buildSeedRecords(harvesters, supervisors, compensationRules, activeBatchNumber) {
  const today = new Date()
  const records = []
  if (harvesters.length === 0 || supervisors.length === 0) {
    return records
  }
  let supervisorPool = [...supervisors]
  while (supervisorPool.length < 3) {
    supervisorPool.push(supervisorPool[supervisorPool.length - 1])
  }
  const [supervisorOne, supervisorTwo, supervisorThree] = supervisorPool

  for (let dayOffset = 1; dayOffset <= 30; dayOffset += 1) {
    const dayDate = new Date(today)
    dayDate.setDate(today.getDate() - dayOffset)
    const harvestedOn = dayDate.toISOString().slice(0, 10)

    harvesters.forEach((harvester, employeeIndex) => {
      const recordedBy =
        dayOffset <= 20
          ? supervisorOne
          : employeeIndex % 2 === 0
            ? supervisorTwo
            : supervisorThree
      const kg = seededKg(employeeIndex, dayOffset)
      const clockInTime = `7:${String(10 + ((employeeIndex + dayOffset) % 10)).padStart(2, '0')}`
      const clockOutTime = `4:${String(40 + ((employeeIndex + dayOffset) % 20)).padStart(2, '0')}`
      const wage = calculateHarvestWage(kg, harvester, compensationRules)
      records.push({
        id: `${harvester.id}-${harvestedOn}`,
        harvesterId: harvester.id,
        harvesterName: harvester.name,
        kg,
        harvestedOn,
        baseWageKes: wage.baseWageKes,
        incentiveKes: wage.incentiveKes,
        wageKes: wage.wageKes,
        recordedById: recordedBy.id,
        recordedByName: recordedBy.name,
        supervisorDailyWageKes: getEmployeeDailyWageKes(recordedBy),
        batchNumber: normalizeBatchNumber(activeBatchNumber),
        clockInTime,
        clockOutTime,
      })
    })
  }

  return records
}

function buildSeedHaulageTrips(records, employees) {
  const drivers = employees.filter((employee) => employee.role === 'truck-driver')
  const dedicatedLoaders = employees.filter((employee) => employee.role === 'loader')
  const loaders =
    dedicatedLoaders.length >= 2
      ? dedicatedLoaders
      : employees.filter((employee) => employee.role === 'decorticator-operator').slice(0, 2)
  if (drivers.length === 0 || loaders.length < 2 || records.length === 0) {
    return []
  }

  const truckCapacityKg = 15000
  const groupedByDateBatch = records.reduce((map, record) => {
    const key = `${record.harvestedOn}__${record.batchNumber}`
    if (!map[key]) {
      map[key] = {
        date: record.harvestedOn,
        batchNumber: record.batchNumber,
        records: [],
      }
    }
    map[key].records.push(record)
    return map
  }, {})

  const sortedDateBatchGroups = Object.values(groupedByDateBatch).sort((a, b) =>
    a.date === b.date ? a.batchNumber.localeCompare(b.batchNumber) : a.date.localeCompare(b.date),
  )

  return sortedDateBatchGroups.flatMap((group, groupIndex) => {
    const totalOfficialWeightKg = group.records.reduce((sum, record) => sum + record.kg, 0)
    const tripsNeeded = Math.max(1, Math.ceil(totalOfficialWeightKg / truckCapacityKg))
    let remainingWeight = totalOfficialWeightKg
    return Array.from({ length: tripsNeeded }, (_, tripIndex) => {
      const officialWeightKg =
        tripIndex === tripsNeeded - 1 ? remainingWeight : truckCapacityKg
      remainingWeight -= officialWeightKg
      const weighbridgeWeightKg = officialWeightKg + (groupIndex % 2 === 0 ? -20 : 15)
      const selectedLoaders = [
        loaders[(groupIndex + tripIndex) % loaders.length],
        loaders[(groupIndex + tripIndex + 1) % loaders.length],
      ]
      const seededTripDistanceKm = 42 + ((groupIndex + tripIndex) % 7)
      return {
        id: `TRIP-${group.date}-${group.batchNumber}-${tripIndex + 1}`,
        date: group.date,
        tripNumber: tripIndex + 1,
        batchNumber: group.batchNumber,
        officialWeightKg,
        weighbridgeWeightKg,
        driverId: drivers[0].id,
        driverName: drivers[0].name,
        loaderIds: selectedLoaders.map((loader) => loader.id),
        loaderNames: selectedLoaders.map((loader) => loader.name),
        tripDistanceKm: seededTripDistanceKm,
      }
    })
  })
}

function buildSeedFuelAndMaintenance(haulageTrips) {
  const sortedTrips = [...haulageTrips].sort((a, b) => a.date.localeCompare(b.date))
  const distanceByDate = sortedTrips.reduce((map, trip) => {
    map[trip.date] = (map[trip.date] ?? 0) + (trip.tripDistanceKm ?? 0)
    return map
  }, {})
  const dates = Object.keys(distanceByDate).sort()

  const fuelEntries = []
  for (let i = 0; i < dates.length; i += 7) {
    const windowDates = dates.slice(i, i + 7)
    const totalDistanceKm = windowDates.reduce((sum, date) => sum + (distanceByDate[date] ?? 0), 0)
    const litres = Number((totalDistanceKm / 2.5).toFixed(1))
    const costKes = Math.round(litres * 176)
    if (windowDates.length > 0) {
      fuelEntries.push({
        id: `FUEL-${windowDates[windowDates.length - 1]}`,
        date: windowDates[windowDates.length - 1],
        litres,
        costKes,
      })
    }
  }

  const maintenanceEntries = []
  let cumulativeDistance = 0
  let nextServiceAtKm = 5000
  dates.forEach((date, idx) => {
    cumulativeDistance += distanceByDate[date] ?? 0
    if (cumulativeDistance >= nextServiceAtKm) {
      maintenanceEntries.push({
        id: `MTN-SVC-${date}`,
        date,
        type: 'service',
        costKes: 100000,
      })
      nextServiceAtKm += 5000
    }
    if (idx % 14 === 0) {
      maintenanceEntries.push({
        id: `MTN-REP-${date}`,
        date,
        type: 'repair',
        costKes: 38000 + (idx % 3) * 6000,
      })
    }
  })

  return { fuelEntries, maintenanceEntries }
}

function buildSeedDecorticationRecords(haulageTrips, employees) {
  const supervisors = employees.filter((employee) => employee.role === 'decortication-supervisor')
  const operators = employees.filter((employee) => employee.role === 'decorticator-operator')
  const primarySupervisor = supervisors[0]
  const secondarySupervisor = supervisors[1] ?? supervisors[0]
  const machinePlan = [
    { machine: 'D2', supervisor: primarySupervisor },
    { machine: 'D3', supervisor: secondarySupervisor },
  ]
  if (!primarySupervisor || operators.length < 14) {
    return []
  }

  const grouped = haulageTrips.reduce((map, trip) => {
    const key = `${trip.date}__${trip.batchNumber}`
    if (!map[key]) {
      map[key] = { date: trip.date, batchNumber: trip.batchNumber, officialWeightKg: 0 }
    }
    map[key].officialWeightKg += trip.officialWeightKg
    return map
  }, {})

  const groups = Object.values(grouped).sort((a, b) =>
    a.date === b.date ? a.batchNumber.localeCompare(b.batchNumber) : a.date.localeCompare(b.date),
  )

  return groups.flatMap((group, idx) => {
    const totalFibreKg = group.officialWeightKg * 0.015
    return machinePlan.map((machineConfig, machineIndex) => {
      const fibreKg = Number((totalFibreKg / 2 + (machineIndex === 0 ? 1.2 : -1.2)).toFixed(1))
      const operatorStart = machineIndex * 7
      const assignedOperators = operators.slice(operatorStart, operatorStart + 7)
      return {
        id: `DEC-${group.date}-${group.batchNumber}-${machineConfig.machine}-1`,
        date: group.date,
        machine: machineConfig.machine,
        shiftNumber: 1,
        batchNumber: group.batchNumber,
        leafInputKg: Number((group.officialWeightKg / 2).toFixed(1)),
        fibreKg,
        waterM3: Number((11.2 + ((idx + machineIndex) % 4) * 0.6).toFixed(1)),
        runtimeHours: Number((6.1 + ((idx + machineIndex) % 3) * 0.4).toFixed(1)),
        supervisorId: machineConfig.supervisor.id,
        supervisorName: machineConfig.supervisor.name,
        operatorIds: assignedOperators.map((person) => person.id),
        operatorNames: assignedOperators.map((person) => person.name),
      }
    })
  })
}

function buildDecorticationAssignmentsFromRecords(decorticationRecords) {
  const assignmentMap = {}
  decorticationRecords.forEach((record) => {
    const key = `${record.date}__${record.machine}__${record.shiftNumber}__${record.batchNumber}`
    if (!assignmentMap[key]) {
      assignmentMap[key] = {
        id: `ASG-${record.date}-${record.machine}-${record.shiftNumber}-${record.batchNumber}`,
        date: record.date,
        machine: record.machine,
        shiftNumber: record.shiftNumber,
        batchNumber: record.batchNumber,
        supervisorId: record.supervisorId,
        supervisorName: record.supervisorName,
        operatorIds: record.operatorIds,
        operatorNames: record.operatorNames,
      }
    }
  })
  return Object.values(assignmentMap)
}

function buildSeedDryingRecords(decorticationRecords, employees) {
  let dryers = employees.filter((employee) => employee.role === 'dryer')
  if (dryers.length === 0) {
    dryers = employees.filter((employee) => employee.role === 'decorticator-operator').slice(0, 3)
  }
  if (dryers.length === 0) {
    return []
  }
  return decorticationRecords
    .slice(0, 24)
    .map((record, index) => {
      const weighedDate = new Date(record.date)
      weighedDate.setDate(weighedDate.getDate() + 2 + (index % 3))
      const bundleCount = 8 + (index % 3)
      const totalDriedKg = Number((record.fibreKg * (0.95 + (index % 3) * 0.01)).toFixed(1))
      const averageBundle = totalDriedKg / bundleCount
      const bundleWeights = Array.from({ length: bundleCount }, (_, bundleIndex) =>
        Number((averageBundle + (bundleIndex % 2 === 0 ? 0.2 : -0.2)).toFixed(1)),
      )
      const normalizedTotal = Number(
        bundleWeights.reduce((sum, weight) => sum + weight, 0).toFixed(1),
      )
      const dryer = dryers[index % dryers.length]
      return {
        id: `DRY-${record.id}`,
        decorticationRecordId: record.id,
        decorticationDate: record.date,
        weighedDate: weighedDate.toISOString().slice(0, 10),
        machine: record.machine,
        shiftNumber: record.shiftNumber,
        batchNumber: record.batchNumber,
        bundleWeights,
        totalDriedKg: normalizedTotal,
        dryingTimeDays: Math.max(
          0,
          Math.floor((weighedDate.getTime() - new Date(record.date).getTime()) / (1000 * 60 * 60 * 24)),
        ),
        dryerId: dryer.id,
        dryerName: dryer.name,
      }
    })
    .sort((a, b) => b.weighedDate.localeCompare(a.weighedDate))
}

function buildSeedBrushingData(dryingRecords, employees) {
  const supervisors = employees.filter((employee) => employee.role === 'brushing-supervisor')
  const brushers = employees.filter((employee) => employee.role === 'brusher')
  if (supervisors.length === 0 || brushers.length === 0 || dryingRecords.length === 0) {
    return { brushingStockMovements: [], brushingDailyRecords: [] }
  }

  const grouped = dryingRecords.reduce((map, record) => {
    const brushingDate = new Date(record.weighedDate)
    brushingDate.setDate(brushingDate.getDate() + 1)
    const date = brushingDate.toISOString().slice(0, 10)
    const sourceStockCode = buildStockCode(record.batchNumber, record.machine, 'UBR')
    const batchNumber = normalizeBatchNumber(record.batchNumber)
    const key = `${date}__${sourceStockCode}`
    if (!map[key]) {
      map[key] = {
        date,
        batchNumber,
        sourceStockCode,
        machine: record.machine,
        ubrAvailableKg: 0,
      }
    }
    map[key].ubrAvailableKg += record.totalDriedKg
    return map
  }, {})

  const sortedGroups = Object.values(grouped).sort((a, b) =>
    a.date === b.date ? a.batchNumber.localeCompare(b.batchNumber) : a.date.localeCompare(b.date),
  )

  const brushingStockMovements = []
  const brushingDailyRecords = []

  sortedGroups.forEach((group, index) => {
    const issueKg = Number((group.ubrAvailableKg * (0.84 + (index % 3) * 0.03)).toFixed(1))
    const returnKg = index % 2 === 0 ? Number((issueKg * 0.07).toFixed(1)) : 0
    const ubrUsedKg = Number((issueKg - returnKg).toFixed(1))
    const brsKg = Number((ubrUsedKg * (0.77 + (index % 4) * 0.015)).toFixed(1))
    const towKg = Number((ubrUsedKg * (0.16 + (index % 3) * 0.01)).toFixed(1))
    const dustLossKg = Number((ubrUsedKg - (brsKg + towKg)).toFixed(1))
    const efficiency = ubrUsedKg > 0 ? Number((brsKg / ubrUsedKg).toFixed(3)) : 0

    const supervisorA = supervisors[index % supervisors.length]
    const supervisorB = supervisors[(index + 1) % supervisors.length]
    const supervisorIds =
      supervisors.length > 1 && index % 3 === 0 ? [supervisorA.id, supervisorB.id] : [supervisorA.id]
    const supervisorNames = supervisorIds.map(
      (id) => employees.find((employee) => employee.id === id)?.name ?? id,
    )

    const brusherCount = Math.min(5, Math.max(2, 2 + (index % 4)))
    const brusherIds = Array.from({ length: brusherCount }, (_, workerIndex) => {
      const brusher = brushers[(index + workerIndex) % brushers.length]
      return brusher.id
    })
    const brusherNames = brusherIds.map(
      (id) => employees.find((employee) => employee.id === id)?.name ?? id,
    )

    brushingStockMovements.push({
      id: `BRM-SEED-${index + 1}-ISSUE`,
      date: group.date,
      batchNumber: group.batchNumber,
      sourceStockCode: group.sourceStockCode,
      machine: group.machine,
      type: 'issue',
      quantityKg: issueKg,
      recordedById: supervisorA.id,
      recordedByName: supervisorA.name,
    })
    if (returnKg > 0) {
      brushingStockMovements.push({
        id: `BRM-SEED-${index + 1}-RETURN`,
        date: group.date,
        batchNumber: group.batchNumber,
        sourceStockCode: group.sourceStockCode,
        machine: group.machine,
        type: 'return',
        quantityKg: returnKg,
        recordedById: supervisorA.id,
        recordedByName: supervisorA.name,
      })
    }

    brushingDailyRecords.push({
      id: `BRD-SEED-${index + 1}`,
      date: group.date,
      batchNumber: group.batchNumber,
      sourceStockCode: group.sourceStockCode,
      machine: group.machine,
      supervisorIds,
      supervisorNames,
      brusherIds,
      brusherNames,
      ubrUsedKg,
      brsKg,
      towKg,
      efficiency,
      dustLossKg,
    })
  })

  return {
    brushingStockMovements: brushingStockMovements.sort((a, b) => b.date.localeCompare(a.date)),
    brushingDailyRecords: brushingDailyRecords.sort((a, b) => b.date.localeCompare(a.date)),
  }
}

function buildSeedBalingRecords(brushingDailyRecords, employees) {
  const supervisors = employees.filter((employee) => employee.role === 'baling-supervisor')
  const balers = employees.filter((employee) => employee.role === 'baler')
  if (supervisors.length === 0 || balers.length < 2 || brushingDailyRecords.length === 0) {
    return []
  }
  const serialBySeries = {}
  return brushingDailyRecords.slice(0, 12).flatMap((record, index) => {
    const sourceStockCode = `${String(record.sourceStockCode ?? '').replace(/-UBR$/, '')}-BRS`
    const baleWeightKg = 100
    const targetBales = Math.max(1, Math.floor(record.brsKg / baleWeightKg))
    const supervisor = supervisors[index % supervisors.length]
    const balerIds = [balers[index % balers.length].id, balers[(index + 1) % balers.length].id]
    const balerNames = balerIds.map((id) => employees.find((employee) => employee.id === id)?.name ?? id)
    return Array.from({ length: targetBales }, (_, baleIndex) => {
      const seriesCode = buildBaleSeriesCode(sourceStockCode, baleWeightKg)
      serialBySeries[seriesCode] = (serialBySeries[seriesCode] ?? 0) + 1
      return {
        id: `BAL-SEED-${index + 1}-${baleIndex + 1}`,
        date: record.date,
        batchNumber: normalizeBatchNumber(record.batchNumber),
        machine: getMachineFromStockCode(sourceStockCode),
        sourceStockCode,
        baleWeightKg,
        baleSeriesCode: seriesCode,
        baleCode: buildBaleCode(sourceStockCode, baleWeightKg, serialBySeries[seriesCode]),
        supervisorIds: [supervisor.id],
        supervisorNames: [supervisor.name],
        balerIds,
        balerNames,
      }
    })
  })
}

function buildSeedSilageRecords(dryingRecords, employees) {
  const supervisors = employees.filter((employee) => employee.role === 'silage-supervisor')
  const operators = employees.filter((employee) => employee.role === 'silage-operator')
  if (supervisors.length === 0 || dryingRecords.length === 0) {
    return []
  }

  const groupedByDateAndBatch = dryingRecords.reduce((map, record) => {
    const date = record.weighedDate
    const batchNumber = normalizeBatchNumber(record.batchNumber)
    const key = `${date}__${batchNumber}`
    if (!map[key]) {
      map[key] = { date, batchNumber, driedFibreKg: 0 }
    }
    map[key].driedFibreKg += record.totalDriedKg
    return map
  }, {})

  const serialByDateBatchMass = {}
  const seededRecords = []

  Object.values(groupedByDateAndBatch)
    .sort((a, b) => (a.date === b.date ? a.batchNumber.localeCompare(b.batchNumber) : a.date.localeCompare(b.date)))
    .forEach((group, index) => {
      const targetSilageKg = group.driedFibreKg * 10
      const useTwoBagSizes = index % 4 === 0
      const supervisor = supervisors[index % supervisors.length]
      const operatorIds = operators.map((operator) => operator.id)
      const operatorNames = operators.map((operator) => operator.name)

      const bagPlans = useTwoBagSizes
        ? [
            {
              massKg: 75,
              count: Math.max(1, Math.floor((targetSilageKg * 0.7) / 75)),
            },
            {
              massKg: 50,
              count: Math.max(
                1,
                Math.round(
                  Math.max(50, targetSilageKg - Math.floor((targetSilageKg * 0.7) / 75) * 75) / 50,
                ),
              ),
            },
          ]
        : [
            {
              massKg: 75,
              count: Math.max(1, Math.round(targetSilageKg / 75)),
            },
          ]

      bagPlans.forEach((plan) => {
        const serialKey = `${group.date}__${group.batchNumber}__${Math.round(plan.massKg)}`
        if (!serialByDateBatchMass[serialKey]) {
          serialByDateBatchMass[serialKey] = 0
        }
        for (let serial = 0; serial < plan.count; serial += 1) {
          serialByDateBatchMass[serialKey] += 1
          seededRecords.push({
            id: `SLG-SEED-${index + 1}-${Math.round(plan.massKg)}-${serialByDateBatchMass[serialKey]}`,
            date: group.date,
            batchNumber: group.batchNumber,
            massKg: Number(plan.massKg.toFixed(1)),
            bagCode: buildSilageBagCode(
              group.batchNumber,
              group.date,
              plan.massKg,
              serialByDateBatchMass[serialKey],
            ),
            supervisorId: supervisor.id,
            supervisorName: supervisor.name,
            operatorIds,
            operatorNames,
          })
        }
      })
    })

  return seededRecords.sort((a, b) => b.date.localeCompare(a.date))
}

function HomePage({ employees, records, clockedInIds }) {
  const totalKgInView = records.reduce((sum, record) => sum + record.kg, 0)
  const totalPayoutInView = records.reduce((sum, record) => sum + record.wageKes, 0)

  return (
    <section className="panel">
      <h2>Operations Dashboard</h2>
      <p>
        Welcome to the pineapple fibre business management system. The main workflows are
        now connected to employees, clock-in status, and harvesting pay calculation.
      </p>
      <div className="kpi-grid">
        <article className="card">
          <h3>Employees</h3>
          <p>{employees.length} registered</p>
        </article>
        <article className="card">
          <h3>Clocked In Today</h3>
          <p>{clockedInIds.length} active workers</p>
        </article>
        <article className="card">
          <h3>Harvested (Last 30 days)</h3>
          <p>{totalKgInView.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Estimated Payout (Last 30 days)</h3>
          <p>KES {totalPayoutInView.toLocaleString()}</p>
        </article>
      </div>
      <div className="card-grid">
        {activityModules.map((activity) => (
          <article key={activity.id} className="card">
            <h3>{activity.name}</h3>
            <p>{activity.summary}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function ActivityPage({ name, summary }) {
  return (
    <section className="panel">
      <h2>{name}</h2>
      <p>{summary}</p>
      <div className="placeholder">
        This is a starter module. Next step: define data fields, forms, and reports for{' '}
        {name.toLowerCase()}.
      </div>
    </section>
  )
}

function CustomersPage({ customers, onAddCustomer }) {
  const [name, setName] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [postCode, setPostCode] = useState('')
  const [country, setCountry] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [companyRegistration, setCompanyRegistration] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    if (!name.trim() || !addressLine1.trim() || !city.trim() || !country.trim()) {
      return
    }
    onAddCustomer({
      name: name.trim(),
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2.trim(),
      city: city.trim(),
      postCode: postCode.trim(),
      country: country.trim(),
      email: email.trim(),
      phone: phone.trim(),
      companyRegistration: companyRegistration.trim(),
    })
    setName('')
    setAddressLine1('')
    setAddressLine2('')
    setCity('')
    setPostCode('')
    setCountry('')
    setEmail('')
    setPhone('')
    setCompanyRegistration('')
  }

  return (
    <section className="panel">
      <h2>Customers</h2>
      <p>Register and maintain your full customer list for invoice selection.</p>

      <CollapsibleSection title="Add Customer" isOpen onToggle={() => {}}>
        <form className="stacked-form" onSubmit={handleSubmit}>
          <label>
            Customer Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Customer Address Line 1
            <input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} />
          </label>
          <label>
            Customer Address Line 2
            <input value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} />
          </label>
          <label>
            City
            <input value={city} onChange={(event) => setCity(event.target.value)} />
          </label>
          <label>
            Post code
            <input value={postCode} onChange={(event) => setPostCode(event.target.value)} />
          </label>
          <label>
            Country
            <input value={country} onChange={(event) => setCountry(event.target.value)} />
          </label>
          <label>
            Email address
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Phone
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label>
            Company registration
            <input
              value={companyRegistration}
              onChange={(event) => setCompanyRegistration(event.target.value)}
            />
          </label>
          <button type="submit">Add Customer</button>
        </form>
      </CollapsibleSection>

      <h3>Customer Register</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer Name</th>
              <th>Address</th>
              <th>Registration</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>{customer.id}</td>
                <td>{customer.name}</td>
                <td>
                  {[
                    customer.addressLine1,
                    customer.addressLine2,
                    customer.city,
                    customer.postCode,
                    customer.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </td>
                <td>{customer.companyRegistration || 'N/A'}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan="4">No customers yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function InvoicingPage({
  customers,
  invoiceDocuments,
  onCreateDocument,
  onConvertToInvoice,
}) {
  const [documentType, setDocumentType] = useState('proforma')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [origin, setOrigin] = useState('Kenya')
  const [currency, setCurrency] = useState('USD')
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id ?? '')
  const [lineItems, setLineItems] = useState([])
  const productCodeOptions = ['UBR', 'BRS', 'TOW', 'SLG', 'CUS']
  const [hsCode, setHsCode] = useState('53050090')
  const [paymentTerms, setPaymentTerms] = useState('30% deposit, balance upon arrival at port')
  const [shippingTerms, setShippingTerms] = useState('CIF Nansha')
  const [selectedDocumentId, setSelectedDocumentId] = useState('')

  const sortedDocuments = [...invoiceDocuments].sort((a, b) =>
    a.createdAt === b.createdAt
      ? String(b.documentNumber).localeCompare(String(a.documentNumber))
      : b.createdAt.localeCompare(a.createdAt),
  )

  const selectedDocument =
    sortedDocuments.find((item) => item.id === selectedDocumentId) ?? sortedDocuments[0] ?? null
  const selectedCustomer = customers.find((item) => item.id === selectedCustomerId) ?? null
  const selectedCustomerAddress = selectedCustomer
    ? [
        selectedCustomer.addressLine1,
        selectedCustomer.addressLine2,
        selectedCustomer.city,
        selectedCustomer.postCode,
        selectedCustomer.country,
      ]
        .filter(Boolean)
        .join(', ')
    : ''

  useEffect(() => {
    if (lineItems.length === 0) {
      setLineItems([
        {
          id: `LINE-${Date.now()}`,
          product: 'UBR',
          customDescription: '',
          quantityKg: '',
          rate: '',
          vatEnabled: false,
        },
      ])
    }
  }, [lineItems])

  const computedLineItems = lineItems.map((item) => {
    const quantityValue = Number(item.quantityKg)
    const rateValue = Number(item.rate)
    const subtotal =
      Number.isNaN(quantityValue) || Number.isNaN(rateValue)
        ? 0
        : Number((quantityValue * rateValue).toFixed(2))
    const vatAmount = item.vatEnabled ? Number((subtotal * 0.16).toFixed(2)) : 0
    const total = Number((subtotal + vatAmount).toFixed(2))
    return {
      ...item,
      description:
        item.product === 'CUS'
          ? String(item.customDescription ?? '')
          : getInvoiceDescriptionFromProductCode(item.product),
      subtotal,
      vatAmount,
      total,
    }
  })
  const invoiceSubtotal = Number(
    computedLineItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2),
  )
  const invoiceVatTotal = Number(
    computedLineItems.reduce((sum, item) => sum + item.vatAmount, 0).toFixed(2),
  )
  const invoiceGrandTotal = Number((invoiceSubtotal + invoiceVatTotal).toFixed(2))

  function handleAddProductLine() {
    setLineItems((prev) => [
      ...prev,
      {
        id: `LINE-${Date.now()}-${prev.length + 1}`,
        product: 'UBR',
        customDescription: '',
        quantityKg: '',
        rate: '',
        vatEnabled: false,
      },
    ])
  }

  function handleRemoveProductLine(lineId) {
    setLineItems((prev) => prev.filter((item) => item.id !== lineId))
  }

  function handleLineItemChange(lineId, field, value) {
    setLineItems((prev) =>
      prev.map((item) => (item.id === lineId ? { ...item, [field]: value } : item)),
    )
  }

  function handleCreateDocument(event) {
    event.preventDefault()
    const hasInvalidLine = computedLineItems.some((item) => {
      const quantityValue = Number(item.quantityKg)
      const rateValue = Number(item.rate)
      return (
        !item.product.trim() ||
        !item.description.trim() ||
        Number.isNaN(quantityValue) ||
        Number.isNaN(rateValue) ||
        quantityValue <= 0 ||
        rateValue <= 0
      )
    })
    if (
      !selectedCustomer ||
      !invoiceDate ||
      computedLineItems.length === 0 ||
      hasInvalidLine
    ) {
      return
    }
    const nextDocument = onCreateDocument({
      documentType,
      invoiceDate,
      origin,
      currency,
      customerName: selectedCustomer.name,
      customerAddress: selectedCustomerAddress,
      customerRegistration: selectedCustomer.companyRegistration,
      items: computedLineItems.map((item) => ({
        product: item.product.trim(),
        description: item.description.trim(),
        quantityKg: Number(Number(item.quantityKg).toFixed(2)),
        rate: Number(Number(item.rate).toFixed(2)),
        vatEnabled: item.vatEnabled,
        vatRate: item.vatEnabled ? 0.16 : 0,
        subtotal: item.subtotal,
        vatAmount: item.vatAmount,
        amount: item.total,
      })),
      hsCode: hsCode.trim(),
      paymentTerms: paymentTerms.trim(),
      shippingTerms: shippingTerms.trim(),
    })
    setSelectedDocumentId(nextDocument.id)
  }

  async function handlePrintDocumentPdf() {
    if (!selectedDocument) {
      return
    }
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const left = 8
    const pageWidth = 210
    const contentWidth = 194
    const right = left + contentWidth

    pdf.setFillColor(238, 238, 238)
    pdf.rect(0, 0, pageWidth, 297, 'F')

    try {
      const response = await fetch(logoStandard)
      const blob = await response.blob()
      const logoDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const logoImage = await new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = logoDataUrl
      })
      const logoBox = { x: right - 84, y: 3, width: 76, height: 48 }
      const logoAspectRatio = logoImage.naturalWidth / logoImage.naturalHeight
      let logoWidth = logoBox.width
      let logoHeight = logoWidth / logoAspectRatio
      if (logoHeight > logoBox.height) {
        logoHeight = logoBox.height
        logoWidth = logoHeight * logoAspectRatio
      }
      const logoX = logoBox.x + (logoBox.width - logoWidth) / 2
      const logoY = logoBox.y + (logoBox.height - logoHeight) / 2
      pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight, undefined, 'FAST')
    } catch (error) {
      // Keep PDF generation working even if logo loading fails.
      console.error('Unable to load invoice logo for PDF export:', error)
    }

    pdf.setTextColor(0, 0, 0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12.5)
    pdf.text('Mananasi Fibre Limited', left, 13)

    pdf.setFontSize(9)
    pdf.text('Address:', left, 20)
    pdf.setFont('helvetica', 'normal')
    pdf.text('P.O Box 14483', left + 28, 20)
    pdf.text('Nairobi 00800', left + 28, 24.5)
    pdf.text('Kenya', left + 28, 29)

    pdf.setFont('helvetica', 'bold')
    pdf.text('KRA PIN', left, 36)
    pdf.setFont('helvetica', 'normal')
    pdf.text('P052141076P', left + 28, 36)

    pdf.setFont('helvetica', 'bold')
    pdf.text('Contact', left, 43)
    pdf.setFont('helvetica', 'normal')
    pdf.text('info@mananasi-fibre.com', left + 28, 43)
    pdf.text('+254717903799', left + 28, 47.5)

    const label = selectedDocument.documentType === 'proforma' ? 'Proforma number:' : 'Invoice number:'
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.text('Invoice to:', left, 60)
    pdf.setFontSize(9)
    pdf.text(label, 105, 60)
    pdf.setFont('helvetica', 'normal')
    pdf.text(String(selectedDocument.documentNumber), 150, 60)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Date:', 105, 67)
    pdf.setFont('helvetica', 'normal')
    pdf.text(formatDisplayDate(selectedDocument.invoiceDate), 150, 67)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Origin', 105, 74)
    pdf.setFont('helvetica', 'normal')
    pdf.text(selectedDocument.origin, 150, 74)

    pdf.setFont('helvetica', 'bold')
    pdf.text(selectedDocument.customerName, left, 67)
    pdf.setFont('helvetica', 'normal')
    const customerLines = pdf.splitTextToSize(selectedDocument.customerAddress, 70)
    pdf.text(customerLines, left, 73)
    pdf.text(`Company registration: ${selectedDocument.customerRegistration}`, left, 93)

    const tableTop = 102
    const rowH = 7
    const tableRows = Math.max(4, selectedDocument.items.length + 2)
    const colX = {
      product: left,
      description: left + 28,
      qty: left + 96,
      rate: left + 126,
      amount: left + 154,
      end: right,
    }

    pdf.setDrawColor(0)
    pdf.setLineWidth(0.5)
    pdf.rect(left, tableTop, contentWidth, rowH * (tableRows + 1))
    ;[colX.description, colX.qty, colX.rate, colX.amount].forEach((x) => {
      pdf.line(x, tableTop, x, tableTop + rowH * (tableRows + 1))
    })
    for (let i = 1; i <= tableRows; i += 1) {
      pdf.line(left, tableTop + rowH * i, right, tableTop + rowH * i)
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8.5)
    pdf.text('Product', colX.product + 1, tableTop + 4.8)
    pdf.text('Description', colX.description + 1, tableTop + 4.8)
    pdf.text('QTY (kg)', colX.qty + 1, tableTop + 4.8)
    pdf.text(`Rate (${selectedDocument.currency}/kg)`, colX.rate + 1, tableTop + 4.8)
    pdf.text('Amount', colX.amount + 1, tableTop + 4.8)

    pdf.setFont('helvetica', 'normal')
    selectedDocument.items.forEach((item, index) => {
      const y = tableTop + rowH * (index + 1) + 4.8
      pdf.text(String(item.product), colX.product + 1, y)
      pdf.text(pdf.splitTextToSize(String(item.description), 66)[0] ?? '', colX.description + 1, y)
      pdf.text(String(item.quantityKg), colX.qty + 1, y)
      pdf.text(String(item.rate.toFixed(2)), colX.rate + 1, y)
      pdf.text(
        `${selectedDocument.currency} ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        colX.amount + 1,
        y,
      )
    })

    const totalRowY = tableTop + rowH * tableRows
    pdf.setFont('helvetica', 'bold')
    pdf.text('Total', colX.rate + 1, totalRowY + 4.8)
    pdf.text(
      `${selectedDocument.currency} ${selectedDocument.totalAmount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      })}`,
      colX.amount + 1,
      totalRowY + 4.8,
    )

    const footerY = tableTop + rowH * (tableRows + 1) + 12
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text('HS Code', left, footerY)
    pdf.text(selectedDocument.hsCode, left + 78, footerY)
    pdf.text('Payment terms:', left + 30, footerY + 13)
    pdf.text(selectedDocument.paymentTerms, left + 98, footerY + 13)
    pdf.text('Shipping:', left + 30, footerY + 20)
    pdf.text(selectedDocument.shippingTerms, left + 98, footerY + 20)
    pdf.text('Authorised by:', left + 30, footerY + 32)
    pdf.text('James Boyd-Moss (Managing Director)', left + 98, footerY + 32)

    const filePrefix = selectedDocument.documentType === 'proforma' ? 'proforma' : 'invoice'
    pdf.save(`${filePrefix}-${selectedDocument.documentNumber}.pdf`)
  }

  return (
    <section className="panel">
      <h2>Invoicing</h2>
      <p>
        Create a Proforma Invoice first, then convert it to a final Invoice once the deal is
        confirmed.
      </p>

      <CollapsibleSection title="Create Document" isOpen onToggle={() => {}}>
        <form className="form-grid" onSubmit={handleCreateDocument}>
          <label>
            Document Type
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              <option value="proforma">Proforma Invoice</option>
              <option value="invoice">Invoice</option>
            </select>
          </label>
          <label>
            Date
            <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
          </label>
          <label>
            Origin
            <input value={origin} onChange={(event) => setOrigin(event.target.value)} />
          </label>
          <label>
            Currency
            <input value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </label>
          <label>
            Customer
            <select
              value={selectedCustomerId}
              onChange={(event) => setSelectedCustomerId(event.target.value)}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            HS Code
            <input value={hsCode} onChange={(event) => setHsCode(event.target.value)} />
          </label>
          <label className="full-width">
            Payment Terms
            <textarea
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value)}
              rows={4}
              placeholder="Enter detailed payment terms..."
            />
          </label>
          <label>
            Shipping
            <input value={shippingTerms} onChange={(event) => setShippingTerms(event.target.value)} />
          </label>
          <button type="submit">
            Create {documentType === 'proforma' ? 'Proforma Invoice' : 'Invoice'}
          </button>
        </form>
        <button type="button" onClick={handleAddProductLine}>
          Add Product
        </button>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity (kg)</th>
                <th>Price ({currency}/kg)</th>
                <th>VAT</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {computedLineItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <select
                      value={item.product}
                      onChange={(event) =>
                        handleLineItemChange(item.id, 'product', event.target.value)
                      }
                    >
                      <option value="">Select product code</option>
                      {productCodeOptions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                    <input
                      value={item.description}
                      onChange={(event) =>
                        handleLineItemChange(item.id, 'customDescription', event.target.value)
                      }
                      disabled={item.product !== 'CUS'}
                      placeholder={
                        item.product === 'CUS'
                          ? 'Enter custom item description'
                          : 'Auto-mapped description'
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={item.quantityKg}
                      onChange={(event) =>
                        handleLineItemChange(item.id, 'quantityKg', event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.rate}
                      onChange={(event) =>
                        handleLineItemChange(item.id, 'rate', event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <label className="check-item">
                      <span>Add VAT</span>
                      <input
                        type="checkbox"
                        checked={item.vatEnabled}
                        onChange={(event) =>
                          handleLineItemChange(item.id, 'vatEnabled', event.target.checked)
                        }
                      />
                    </label>
                  </td>
                  <td>
                    {currency} {item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <button type="button" onClick={() => handleRemoveProductLine(item.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {computedLineItems.length === 0 && (
                <tr>
                  <td colSpan="6">No product lines. Click "Add Product" to start.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="kpi-grid">
          <article className="card">
            <h3>Subtotal</h3>
            <p>
              {currency} {invoiceSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </article>
          <article className="card">
            <h3>VAT Total</h3>
            <p>
              {currency} {invoiceVatTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </article>
          <article className="card">
            <h3>Grand Total</h3>
            <p>
              {currency} {invoiceGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </article>
        </div>
      </CollapsibleSection>

      <h3>Document Register</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Number</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedDocuments.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.documentType === 'proforma' ? 'Proforma' : 'Invoice'}</td>
                <td>{doc.documentNumber}</td>
                <td>{formatDisplayDate(doc.invoiceDate)}</td>
                <td>{doc.customerName}</td>
                <td>
                  {doc.currency} {doc.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td>{doc.status}</td>
                <td>
                  <button type="button" onClick={() => setSelectedDocumentId(doc.id)}>
                    View
                  </button>
                  {doc.documentType === 'proforma' && (
                    <button type="button" onClick={() => onConvertToInvoice(doc.id)}>
                      Convert
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {sortedDocuments.length === 0 && (
              <tr>
                <td colSpan="7">No invoices yet. Create your first proforma invoice.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedDocument && (
        <>
          <div className="invoice-actions">
            <button type="button" onClick={handlePrintDocumentPdf}>
              Print Document
            </button>
          </div>
          <article className="invoice-sheet">
            <header className="invoice-top">
              <div>
                <h3>Mananasi Fibre Limited</h3>
                <p><strong>Address:</strong> P.O Box 14483, Nairobi 00800, Kenya</p>
                <p><strong>KRA PIN</strong> P052141076P</p>
                <p><strong>Contact</strong> info@mananasi-fibre.com | +254717903799</p>
              </div>
              <div className="invoice-logo-block">
                <img src={logoStandard} alt="Mananasi Fibre logo" className="invoice-logo-image" />
                <div>MANANASI FIBRE LTD</div>
              </div>
            </header>

            <section className="invoice-meta-grid">
              <div>
                <h4>Invoice to:</h4>
                <p><strong>{selectedDocument.customerName}</strong></p>
                <p>{selectedDocument.customerAddress}</p>
                <p>Company registration: {selectedDocument.customerRegistration}</p>
              </div>
              <div>
                <p><strong>{selectedDocument.documentType === 'proforma' ? 'Proforma number' : 'Invoice number'}:</strong> {selectedDocument.documentNumber}</p>
                <p><strong>Date:</strong> {formatDisplayDate(selectedDocument.invoiceDate)}</p>
                <p><strong>Origin:</strong> {selectedDocument.origin}</p>
              </div>
            </section>

            <table className="invoice-line-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Description</th>
                  <th>QTY (kg)</th>
                  <th>Rate ({selectedDocument.currency}/kg)</th>
                  <th>VAT</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {selectedDocument.items.map((item, index) => (
                  <tr key={`${selectedDocument.id}-${index + 1}`}>
                    <td>{item.product}</td>
                    <td>{item.description}</td>
                    <td>{item.quantityKg.toLocaleString()}</td>
                    <td>{item.rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td>
                      {item.vatEnabled
                        ? `${Math.round((item.vatRate ?? 0.16) * 100)}%`
                        : 'No'}
                    </td>
                    <td>
                      {selectedDocument.currency}{' '}
                      {item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan="5"><strong>Total</strong></td>
                  <td>
                    <strong>
                      {selectedDocument.currency}{' '}
                      {selectedDocument.totalAmount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>

            <section className="invoice-foot-grid">
              <p><strong>HS Code</strong> {selectedDocument.hsCode}</p>
              <p><strong>Payment terms:</strong> {selectedDocument.paymentTerms}</p>
              <p><strong>Shipping:</strong> {selectedDocument.shippingTerms}</p>
              <p><strong>Authorised by:</strong> James Boyd-Moss (Managing Director)</p>
            </section>
          </article>
        </>
      )}
    </section>
  )
}

function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  children,
  canExpand = true,
  deniedMessage = 'You do not have permission to expand this section.',
}) {
  return (
    <section className="collapsible-section">
      <button
        type="button"
        className="section-toggle"
        onClick={onToggle}
        disabled={!canExpand}
      >
        <span>{title}</span>
        <span>{isOpen ? '▾' : '▸'}</span>
      </button>
      {!canExpand && <div className="section-denied">{deniedMessage}</div>}
      {isOpen && <div className="section-content">{children}</div>}
    </section>
  )
}

/** Shown under Leadership & Administration regardless of app role (from staff roster). */
const leadershipTeamEmployeeIds = new Set([
  '1002',
  '1010',
  '1018',
  '1005',
  '1017',
]) // Naomi, Doreen, Cosmus, David, Francis

const AUTH_SESSION_KEY = 'mananasiAuthLeadershipUserId'

function isAppAdmin(user) {
  return user?.role === 'admin'
}

function readAuthLeadershipId() {
  if (typeof sessionStorage === 'undefined') {
    return ''
  }
  try {
    return sessionStorage.getItem(AUTH_SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

function readValidAuthLeadershipId(employeeSource) {
  const raw = readAuthLeadershipId()
  if (!raw || !employeeSource.some((employee) => employee.id === raw)) {
    return ''
  }
  return raw
}

function isLeadershipTeamMember(employee) {
  if (leadershipTeamEmployeeIds.has(employee.id)) {
    return true
  }
  return ['admin', 'harvesting-manager', 'production-manager'].includes(employee.role)
}

function buildLoginUsername(displayName) {
  return String(displayName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]+/g, '')
}

function LoginPage({ onLoginSuccess }) {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const employee = await leadershipLogin(username, password)
      onLoginSuccess(employee.id)
      navigate('/', { replace: true })
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-layout">
      <section className="panel login-panel">
        <h1>Mananasi Fibre App</h1>
        <h2>Leadership sign in</h2>
        <p>
          Usernames match each person&apos;s display name: lowercase, spaces become dots (for example{' '}
          <code>naomi.wanjiku.mbugua</code>). If no password has been set yet, leave the password
          field blank once, then ask the administrator to set one.
        </p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="e.g. naomi.wanjiku.mbugua"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Leave blank until a password is set"
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {error ? <div className="placeholder">{error}</div> : null}
      </section>
    </div>
  )
}

function LeadershipAccountRow({ account, adminEmployeeId, adminPassword, onPasswordSaved }) {
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setMessage('')
    setSaving(true)
    try {
      await setLeadershipPassword({
        adminEmployeeId,
        adminPassword,
        targetEmployeeId: account.employeeId,
        newPassword: nextPassword,
        confirmPassword,
      })
      setNextPassword('')
      setConfirmPassword('')
      setMessage('Password saved.')
      onPasswordSaved()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td>{account.name}</td>
      <td>
        <code>{account.username}</code>
      </td>
      <td>
        {account.hasPassword
          ? 'Password saved'
          : 'Not set yet — they can sign in once with a blank password'}
      </td>
      <td>
        <div className="leadership-password-tools">
          <input
            type="password"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            placeholder="New password"
            autoComplete="new-password"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirm"
            autoComplete="new-password"
          />
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save password'}
          </button>
          {message ? <span className="inline-hint">{message}</span> : null}
        </div>
      </td>
    </tr>
  )
}

function LeadershipAccountsPage({ currentUser }) {
  const [adminPassword, setAdminPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function loadAccounts(password) {
    const result = await fetchLeadershipAccounts(currentUser.id, password)
    setAccounts(result.accounts)
    setUnlocked(true)
    setError('')
  }

  async function handleUnlock(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await loadAccounts(adminPassword)
    } catch (unlockError) {
      setUnlocked(false)
      setAccounts([])
      setError(unlockError.message)
    } finally {
      setLoading(false)
    }
  }

  if (!isAppAdmin(currentUser)) {
    return <Navigate to="/" replace />
  }

  return (
    <section className="panel">
      <h2>Leadership sign-in accounts</h2>
      <p>
        <Link to="/employees">Back to employees</Link>
      </p>
      <p>
        Only the administrator can view or change leadership passwords. Hashes are stored privately on
        the server and are not included in the general app data sync.
      </p>

      {!unlocked ? (
        <form className="form-grid" onSubmit={handleUnlock}>
          <label>
            Confirm your administrator password
            <input
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Required to unlock this page"
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Unlock account management'}
          </button>
        </form>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Password status</th>
                <th>Set password</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <LeadershipAccountRow
                  key={account.employeeId}
                  account={account}
                  adminEmployeeId={currentUser.id}
                  adminPassword={adminPassword}
                  onPasswordSaved={() => loadAccounts(adminPassword)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? <div className="placeholder">{error}</div> : null}
    </section>
  )
}

function PageAccessAdminSection({
  employees,
  currentUser,
  pagePermissionOverrides,
  onSaveEmployeePageAccess,
  onClearEmployeePageAccessOverride,
}) {
  const isAdmin = currentUser?.role === 'admin'
  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  )
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(() => sortedEmployees[0]?.id ?? '')
  const [selectedPages, setSelectedPages] = useState(() => new Set(['dashboard']))
  const [saveNote, setSaveNote] = useState('')

  useEffect(() => {
    if (!sortedEmployees.some((item) => item.id === selectedEmployeeId) && sortedEmployees[0]) {
      setSelectedEmployeeId(sortedEmployees[0].id)
    }
  }, [sortedEmployees, selectedEmployeeId])

  useEffect(() => {
    setSaveNote('')
  }, [selectedEmployeeId])

  useEffect(() => {
    if (!selectedEmployeeId) {
      return
    }
    setSelectedPages(new Set(getBasePageListForEditor(selectedEmployeeId, pagePermissionOverrides, employees)))
  }, [selectedEmployeeId, pagePermissionOverrides, employees])

  function togglePage(pageId) {
    if (pageId === 'dashboard') {
      return
    }
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(pageId)) {
        next.delete(pageId)
      } else {
        next.add(pageId)
      }
      next.add('dashboard')
      return next
    })
  }

  function handleSaveAccess() {
    onSaveEmployeePageAccess(selectedEmployeeId, [...selectedPages])
    setSaveNote('Saved page access for this person in this browser.')
  }

  function handleUsePolicyDefaults() {
    onClearEmployeePageAccessOverride(selectedEmployeeId)
    setSaveNote('Cleared custom access; organisation defaults apply for this person.')
  }

  if (!isAdmin) {
    return null
  }

  const editablePageIds = PAGE_ACCESS_IDS.filter((id) => id !== 'dashboard')

  return (
    <section className="page-access-admin">
      <h3>Page access (administrator)</h3>
      <p>
        Choose an employee, tick the areas they may open in the sidebar, then save. Changes are
        stored on the Railway backend. Administrators always have every page.
      </p>
      <div className="form-grid page-access-admin-toolbar">
        <label>
          Employee
          <select
            value={selectedEmployeeId}
            onChange={(event) => setSelectedEmployeeId(event.target.value)}
          >
            {sortedEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} ({employee.id})
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="page-access-checkboxes">
        <legend>Allowed pages</legend>
        <label className="check-item page-access-dashboard-lock">
          <input type="checkbox" checked disabled />
          <span>{PAGE_ACCESS_LABELS.dashboard} (always on)</span>
        </label>
        {editablePageIds.map((pageId) => (
          <label key={pageId} className="check-item">
            <input
              type="checkbox"
              checked={selectedPages.has(pageId)}
              onChange={() => togglePage(pageId)}
            />
            <span>{PAGE_ACCESS_LABELS[pageId] ?? pageId}</span>
          </label>
        ))}
      </fieldset>
      <div className="page-access-admin-actions">
        <button type="button" onClick={handleSaveAccess}>
          Save page access
        </button>
        <button type="button" className="button-quiet" onClick={handleUsePolicyDefaults}>
          Use policy defaults for this person
        </button>
      </div>
      {saveNote ? <p className="inline-hint">{saveNote}</p> : null}
    </section>
  )
}

function AddEmployeePage({
  employees,
  currentUser,
  onAddEmployee,
  pagePermissionOverrides,
  onSaveEmployeePageAccess,
  onClearEmployeePageAccessOverride,
}) {
  const navigate = useNavigate()
  const [role, setRole] = useState('harvester')
  const canManageEmployees =
    currentUser?.role === 'admin' || currentUser?.role === 'harvesting-manager'
  const nextWorkNo = useMemo(() => String(nextEmployeeWorkNumber(employees)), [employees])
  const blankEmployee = useMemo(
    () => createBlankEmployeeTemplate(nextWorkNo, role),
    [nextWorkNo, role],
  )

  function handleProfileSubmit(profile) {
    if (!profile.name?.trim() || !canManageEmployees) {
      return
    }
    onAddEmployee({
      ...profile,
      role,
      position: profile.position || getEmployeeRoleLabel(role),
    })
    navigate('/employees')
  }

  return (
    <section className="panel">
      <h2>Add employee</h2>
      <p>
        <Link to="/employees">Back to employee list</Link>
      </p>
      {!canManageEmployees && (
        <div className="placeholder">
          Only Admin or Harvesting Manager can add employees or manage employee settings.
        </div>
      )}

      <div className="card-grid">
        <article className="card">
          <h3>App role</h3>
          <p className="placeholder">
            A new Work No <code>{nextWorkNo}</code> will be assigned automatically. This is also
            the scanner User ID.
          </p>
          <label className="form-grid">
            Role in Mananasi app
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={!canManageEmployees}
            >
              {employeeRoleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </article>
        <article className="card">
          <h3>Employee database details</h3>
          <EmployeeProfileEditor
            key={`${nextWorkNo}-${role}`}
            employee={blankEmployee}
            canEdit={canManageEmployees}
            onSubmit={handleProfileSubmit}
            submitLabel="Save employee"
          />
        </article>
      </div>

      <PageAccessAdminSection
        employees={employees}
        currentUser={currentUser}
        pagePermissionOverrides={pagePermissionOverrides}
        onSaveEmployeePageAccess={onSaveEmployeePageAccess}
        onClearEmployeePageAccessOverride={onClearEmployeePageAccessOverride}
      />
    </section>
  )
}

function EmployeesPage({
  employees,
  currentUser,
  harvestingDateFrom,
  harvestingDateTo,
  clockedInIds,
  attendanceEvents,
  onRefreshAttendance,
  attendanceRefreshing,
}) {
  const navigate = useNavigate()
  const canManageEmployees =
    currentUser?.role === 'admin' || currentUser?.role === 'harvesting-manager'
  const [showRecentEvents, setShowRecentEvents] = useState(false)
  const clockedInCount = clockedInIds.length
  const recentClockEvents = attendanceEvents.slice(0, RECENT_CLOCK_EVENTS_LIMIT)
  const roleDefinitions = useMemo(
    () => employeeRoleOptions.map((option) => ({ id: option.value, name: option.label })),
    [],
  )
  const [openRoles, setOpenRoles] = useState(() => ({
    admin: true,
    'harvesting-manager': true,
  }))
  const employeesByRole = useMemo(
    () =>
      employees.reduce((grouped, employee) => {
        if (!grouped[employee.role]) {
          grouped[employee.role] = []
        }
        grouped[employee.role].push(employee)
        return grouped
      }, {}),
    [employees],
  )
  const unknownRoles = Object.keys(employeesByRole).filter(
    (role) => !roleDefinitions.some((item) => item.id === role),
  )
  const orderedRoles = [
    ...roleDefinitions,
    ...unknownRoles.map((role) => ({ id: role, name: getEmployeeRoleLabel(role) })),
  ]

  function toggleRole(roleId) {
    setOpenRoles((prev) => ({
      ...prev,
      [roleId]: !prev[roleId],
    }))
  }

  return (
    <section className="panel">
      <h2>Employees</h2>
      <p>Browse employees by job type and open each profile for details.</p>
      {!canManageEmployees && (
        <div className="placeholder">
          Only Admin or Harvesting Manager can add new employees.
        </div>
      )}
      <p>
        <button type="button" disabled={!canManageEmployees} onClick={() => navigate('/employees/new')}>
          Add Employee
        </button>
        {isAppAdmin(currentUser) ? (
          <>
            {' '}
            <Link to="/admin/sign-in-accounts" className="action-link">
              Manage leadership sign-in accounts
            </Link>
          </>
        ) : null}
      </p>

      <div className="attendance-toolbar">
        <p>
          <strong>{clockedInCount}</strong> of {employees.length} employees clocked in today.
          Scanner User ID on each device matches the employee Work No.
        </p>
        <button type="button" onClick={onRefreshAttendance} disabled={attendanceRefreshing}>
          {attendanceRefreshing ? 'Refreshing…' : 'Refresh clock-in status'}
        </button>
      </div>

      <CollapsibleSection
        title={`Recent clock events (last ${RECENT_CLOCK_EVENTS_LIMIT})`}
        isOpen={showRecentEvents}
        onToggle={() => setShowRecentEvents((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Employee</th>
                <th>Work No</th>
                <th>Event</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>
              {recentClockEvents.map((event) => {
                const employee = employees.find((item) => item.id === event.employeeId)
                return (
                  <tr key={event.id}>
                    <td>{formatKenyaDateTime(event.occurredAt)}</td>
                    <td>{employee?.name ?? 'Unknown'}</td>
                    <td>
                      <code>{event.employeeId}</code>
                    </td>
                    <td>{event.eventType === 'clock_in' ? 'Clock In' : 'Clock Out'}</td>
                    <td>{event.deviceId ?? '—'}</td>
                  </tr>
                )
              })}
              {recentClockEvents.length === 0 && (
                <tr>
                  <td colSpan="5">No clock events recorded on the server yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {orderedRoles.map((roleItem) => {
        const roleEmployees = (employeesByRole[roleItem.id] ?? [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
        return (
          <CollapsibleSection
            key={roleItem.id}
            title={`${roleItem.name} (${roleEmployees.length})`}
            isOpen={openRoles[roleItem.id] ?? false}
            onToggle={() => toggleRole(roleItem.id)}
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Work No</th>
                    <th>Name</th>
                    <th>Contract</th>
                    <th>Clock-in</th>
                    <th>View details</th>
                  </tr>
                </thead>
                <tbody>
                  {roleEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <code>{employee.id}</code>
                      </td>
                      <td>{employee.name}</td>
                      <td>
                        {getContractTypeLabel(employee.contractType)}
                        {employee.contractType === 'seasonal' && employee.seasonalGrade
                          ? ` (${getSeasonalGradeLabel(employee.seasonalGrade)})`
                          : ''}
                      </td>
                      <td>
                        <span
                          className={
                            clockedInIds.includes(employee.id) ? 'badge badge-on' : 'badge badge-off'
                          }
                        >
                          {clockedInIds.includes(employee.id) ? 'Clocked In' : 'Not Clocked In'}
                        </span>
                      </td>
                      <td>
                        <Link
                          to={`/employees/${employee.id}?from=${harvestingDateFrom}&to=${harvestingDateTo}`}
                          className="action-link"
                        >
                          View details
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {roleEmployees.length === 0 && (
                    <tr>
                      <td colSpan="5">No employees with this role yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>
        )
      })}
    </section>
  )
}

function EmployeeRecordPage({
  employees,
  currentUser,
  clockedInIds,
  records,
  haulageTrips,
  decorticationAssignments,
  dryingRecords,
  brushingStockMovements,
  brushingDailyRecords,
  balingRecords,
  silageRecords,
}) {
  const { employeeId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const employee = employees.find((item) => item.id === employeeId)

  if (!employee) {
    return (
      <section className="panel">
        <h2>Employee record</h2>
        <div className="placeholder">
          Employee not found. <Link to="/employees">Back to employees list</Link>.
        </div>
      </section>
    )
  }

  const canEditEmployee = currentUser?.role === 'admin' || currentUser?.role === 'harvesting-manager'

  const allActivityDates = [
    ...records.map((item) => item.harvestedOn),
    ...haulageTrips.map((item) => item.date),
    ...decorticationAssignments.map((item) => item.date),
    ...dryingRecords.map((item) => item.weighedDate),
    ...brushingStockMovements.map((item) => item.date),
    ...brushingDailyRecords.map((item) => item.date),
    ...balingRecords.map((item) => item.date),
    ...silageRecords.map((item) => item.date),
  ]
    .filter(Boolean)
    .sort()
  const fallbackFrom = allActivityDates[0] ?? new Date().toISOString().slice(0, 10)
  const fallbackTo = allActivityDates[allActivityDates.length - 1] ?? fallbackFrom
  const dateFrom = searchParams.get('from') || fallbackFrom
  const dateTo = searchParams.get('to') || fallbackTo
  const selectedRoleView = searchParams.get('role') || ''
  const isWithinRange = (date) => date >= dateFrom && date <= dateTo

  const harvestAsHarvester = records.filter(
    (item) => item.harvesterId === employee.id && isWithinRange(item.harvestedOn),
  )
  const harvestAsRecorder = records.filter(
    (item) => item.recordedById === employee.id && isWithinRange(item.harvestedOn),
  )
  const haulageAsDriver = haulageTrips.filter(
    (item) => item.driverId === employee.id && isWithinRange(item.date),
  )
  const haulageAsLoader = haulageTrips.filter(
    (item) => item.loaderIds?.includes(employee.id) && isWithinRange(item.date),
  )
  const decorticationAsSupervisor = decorticationAssignments.filter(
    (item) => item.supervisorId === employee.id && isWithinRange(item.date),
  )
  const decorticationAsOperator = decorticationAssignments.filter((item) =>
    item.operatorIds?.includes(employee.id) && isWithinRange(item.date),
  )
  const dryingAsDryer = dryingRecords.filter(
    (item) => item.dryerId === employee.id && isWithinRange(item.weighedDate),
  )
  const brushingStockAsRecorder = brushingStockMovements.filter(
    (item) => item.recordedById === employee.id && isWithinRange(item.date),
  )
  const brushingAsSupervisor = brushingDailyRecords.filter((item) =>
    item.supervisorIds?.includes(employee.id) && isWithinRange(item.date),
  )
  const brushingAsBrusher = brushingDailyRecords.filter((item) =>
    item.brusherIds?.includes(employee.id) && isWithinRange(item.date),
  )
  const balingAsSupervisor = balingRecords.filter(
    (item) => item.supervisorIds?.includes(employee.id) && isWithinRange(item.date),
  )
  const balingAsBaler = balingRecords.filter(
    (item) => item.balerIds?.includes(employee.id) && isWithinRange(item.date),
  )
  const silageAsSupervisor = silageRecords.filter(
    (item) => item.supervisorId === employee.id && isWithinRange(item.date),
  )
  const silageAsOperator = silageRecords.filter(
    (item) => item.operatorIds?.includes(employee.id) && isWithinRange(item.date),
  )

  const totalHarvestedKg = harvestAsHarvester.reduce((sum, item) => sum + (item.kg ?? 0), 0)
  const totalBaledKg = balingAsBaler.reduce((sum, item) => sum + (item.baleWeightKg ?? 0), 0)
  const totalSilageKg = silageAsOperator.reduce((sum, item) => sum + (item.massKg ?? 0), 0)
  const totalDecorticationShifts =
    decorticationAsSupervisor.length + decorticationAsOperator.length + dryingAsDryer.length
  const roleRows = [
    { key: 'harvest-harvester', area: 'Harvesting', role: 'Harvester', records: harvestAsHarvester.length },
    { key: 'harvest-recorder', area: 'Harvesting', role: 'Supervisor / Recorder', records: harvestAsRecorder.length },
    { key: 'haulage-driver', area: 'Haulage', role: 'Driver', records: haulageAsDriver.length },
    { key: 'haulage-loader', area: 'Haulage', role: 'Loader', records: haulageAsLoader.length },
    { key: 'decortication-supervisor', area: 'Decortication', role: 'Supervisor', records: decorticationAsSupervisor.length },
    { key: 'decortication-operator', area: 'Decortication', role: 'Operator', records: decorticationAsOperator.length },
    { key: 'drying-dryer', area: 'Drying', role: 'Dryer', records: dryingAsDryer.length },
    { key: 'brushing-stock-recorder', area: 'Brushing', role: 'Stock recorder', records: brushingStockAsRecorder.length },
    { key: 'brushing-supervisor', area: 'Brushing', role: 'Supervisor', records: brushingAsSupervisor.length },
    { key: 'brushing-brusher', area: 'Brushing', role: 'Brusher', records: brushingAsBrusher.length },
    { key: 'baling-supervisor', area: 'Baling', role: 'Supervisor', records: balingAsSupervisor.length },
    { key: 'baling-baler', area: 'Baling', role: 'Baler', records: balingAsBaler.length },
    { key: 'silage-supervisor', area: 'Silage', role: 'Supervisor', records: silageAsSupervisor.length },
    { key: 'silage-operator', area: 'Silage', role: 'Operator', records: silageAsOperator.length },
  ]
  const averageHarvestKg =
    harvestAsHarvester.length > 0
      ? Number(
          (
            harvestAsHarvester.reduce((sum, item) => sum + Number(item.kg ?? 0), 0) /
            harvestAsHarvester.length
          ).toFixed(1),
        )
      : 0
  const averageHarvestIncentiveKes =
    harvestAsHarvester.length > 0
      ? Number(
          (
            harvestAsHarvester.reduce((sum, item) => sum + Number(item.incentiveKes ?? 0), 0) /
            harvestAsHarvester.length
          ).toFixed(1),
        )
      : 0
  const recorderDailyRows = Object.values(
    harvestAsRecorder.reduce((map, item) => {
      if (!map[item.harvestedOn]) {
        map[item.harvestedOn] = { date: item.harvestedOn, count: 0, kg: 0, batches: new Set() }
      }
      map[item.harvestedOn].count += 1
      map[item.harvestedOn].kg += item.kg
      map[item.harvestedOn].batches.add(item.batchNumber)
      return map
    }, {}),
  ).sort((a, b) => b.date.localeCompare(a.date))
  const averageRecorderEntries =
    recorderDailyRows.length > 0
      ? Number(
          (recorderDailyRows.reduce((sum, row) => sum + row.count, 0) / recorderDailyRows.length).toFixed(1),
        )
      : 0
  const averageRecorderKg =
    recorderDailyRows.length > 0
      ? Number(
          (recorderDailyRows.reduce((sum, row) => sum + row.kg, 0) / recorderDailyRows.length).toFixed(1),
        )
      : 0
  const harvestRankByDateAndHarvester = records.reduce((rankMap, record) => {
    if (!isWithinRange(record.harvestedOn)) {
      return rankMap
    }
    if (!rankMap[record.harvestedOn]) {
      const totalsByHarvester = {}
      records
        .filter((item) => item.harvestedOn === record.harvestedOn)
        .forEach((item) => {
          totalsByHarvester[item.harvesterId] =
            (totalsByHarvester[item.harvesterId] ?? 0) + Number(item.kg ?? 0)
        })
      const ranked = Object.entries(totalsByHarvester)
        .sort((a, b) => b[1] - a[1])
      const ranks = {}
      let currentRank = 1
      let previousTotal = null
      ranked.forEach(([harvesterId, totalKg], index) => {
        if (previousTotal !== null && totalKg < previousTotal) {
          currentRank = index + 1
        }
        ranks[harvesterId] = currentRank
        previousTotal = totalKg
      })
      rankMap[record.harvestedOn] = ranks
    }
    return rankMap
  }, {})
  const averageHarvestRank =
    harvestAsHarvester.length > 0
      ? Number(
          (
            harvestAsHarvester.reduce(
              (sum, item) =>
                sum + Number(harvestRankByDateAndHarvester[item.harvestedOn]?.[item.harvesterId] ?? 0),
              0,
            ) / harvestAsHarvester.length
          ).toFixed(1),
        )
      : 0

  function handleDateFilterSubmit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const from = String(formData.get('from') || fallbackFrom)
    const to = String(formData.get('to') || fallbackTo)
    const nextParams = { from, to }
    if (selectedRoleView) {
      nextParams.role = selectedRoleView
    }
    setSearchParams(nextParams)
  }

  function handleOpenRoleRecord(roleKey) {
    const nextParams = { from: dateFrom, to: dateTo, role: roleKey }
    setSearchParams(nextParams)
    setTimeout(() => {
      const details = document.getElementById('employee-role-record-details')
      if (details) {
        details.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 0)
  }

  function renderRoleDetail() {
    if (selectedRoleView === 'harvest-harvester') {
      return (
        <>
          <h3>Harvesting record: Harvester</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Leaf Mass (kg)</th>
                  <th>Incentive</th>
                  <th>Rank (day)</th>
                  <th>Batch</th>
                  <th>Clock in time</th>
                  <th>Clock out time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Average</strong></td>
                  <td><strong>{averageHarvestKg}</strong></td>
                  <td><strong>{averageHarvestIncentiveKes}</strong></td>
                  <td><strong>{averageHarvestRank}</strong></td>
                  <td>-</td>
                  <td>-</td>
                  <td>-</td>
                </tr>
                {harvestAsHarvester.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDisplayDate(item.harvestedOn)}</td>
                    <td>{item.kg}</td>
                    <td>{item.incentiveKes}</td>
                    <td>{harvestRankByDateAndHarvester[item.harvestedOn]?.[item.harvesterId] ?? '-'}</td>
                    <td>{item.batchNumber}</td>
                    <td>{item.clockInTime}</td>
                    <td>{item.clockOutTime}</td>
                  </tr>
                ))}
                {harvestAsHarvester.length === 0 && (
                  <tr>
                    <td colSpan="7">No harvesting records for this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )
    }
    if (selectedRoleView === 'harvest-recorder') {
      return (
        <>
          <h3>Harvesting record: Supervisor / Recorder</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Records Captured</th>
                  <th>Total KG Captured</th>
                  <th>Batches</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Average</strong></td>
                  <td><strong>{averageRecorderEntries}</strong></td>
                  <td><strong>{averageRecorderKg}</strong></td>
                  <td>-</td>
                </tr>
                {recorderDailyRows.map((row) => (
                    <tr key={row.date}>
                      <td>{formatDisplayDate(row.date)}</td>
                      <td>{row.count}</td>
                      <td>{row.kg}</td>
                      <td>{Array.from(row.batches).join(', ')}</td>
                    </tr>
                  ))}
                {harvestAsRecorder.length === 0 && (
                  <tr>
                    <td colSpan="4">No supervisor recording records for this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )
    }
    return (
      <>
        <h3>Role record details</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Average</strong></td>
                <td>
                  <strong>
                    {
                      (() => {
                        const selectedRecords =
                          selectedRoleView === 'haulage-driver' ? haulageAsDriver
                          : selectedRoleView === 'haulage-loader' ? haulageAsLoader
                          : selectedRoleView === 'decortication-supervisor' ? decorticationAsSupervisor
                          : selectedRoleView === 'decortication-operator' ? decorticationAsOperator
                          : selectedRoleView === 'drying-dryer' ? dryingAsDryer
                          : selectedRoleView === 'brushing-stock-recorder' ? brushingStockAsRecorder
                          : selectedRoleView === 'brushing-supervisor' ? brushingAsSupervisor
                          : selectedRoleView === 'brushing-brusher' ? brushingAsBrusher
                          : selectedRoleView === 'baling-supervisor' ? balingAsSupervisor
                          : selectedRoleView === 'baling-baler' ? balingAsBaler
                          : selectedRoleView === 'silage-supervisor' ? silageAsSupervisor
                          : selectedRoleView === 'silage-operator' ? silageAsOperator
                          : []
                        const uniqueDays = new Set(
                          selectedRecords.map((item) => item.date ?? item.weighedDate).filter(Boolean),
                        ).size
                        if (selectedRecords.length === 0 || uniqueDays === 0) {
                          return '0 records per day'
                        }
                        return `${Number((selectedRecords.length / uniqueDays).toFixed(1))} records per day`
                      })()
                    }
                  </strong>
                </td>
              </tr>
              {(selectedRoleView === 'haulage-driver' ? haulageAsDriver
                : selectedRoleView === 'haulage-loader' ? haulageAsLoader
                : selectedRoleView === 'decortication-supervisor' ? decorticationAsSupervisor
                : selectedRoleView === 'decortication-operator' ? decorticationAsOperator
                : selectedRoleView === 'drying-dryer' ? dryingAsDryer
                : selectedRoleView === 'brushing-stock-recorder' ? brushingStockAsRecorder
                : selectedRoleView === 'brushing-supervisor' ? brushingAsSupervisor
                : selectedRoleView === 'brushing-brusher' ? brushingAsBrusher
                : selectedRoleView === 'baling-supervisor' ? balingAsSupervisor
                : selectedRoleView === 'baling-baler' ? balingAsBaler
                : selectedRoleView === 'silage-supervisor' ? silageAsSupervisor
                : selectedRoleView === 'silage-operator' ? silageAsOperator
                : []
              ).map((item, index) => (
                <tr key={item.id ?? `${selectedRoleView}-${index + 1}`}>
                  <td>{formatDisplayDate(item.date ?? item.weighedDate)}</td>
                  <td>
                    {item.batchNumber
                      ? `Batch ${item.batchNumber}`
                      : item.machine
                        ? `Machine ${item.machine}`
                        : item.sourceStockCode
                          ? `Stock ${item.sourceStockCode}`
                          : item.baleCode
                            ? `Bale ${item.baleCode}`
                            : item.bagCode
                              ? `Bag ${item.bagCode}`
                              : 'Record'}
                  </td>
                </tr>
              ))}
              {(selectedRoleView !== 'harvest-harvester' &&
                selectedRoleView !== 'harvest-recorder' &&
                ((selectedRoleView === 'haulage-driver' && haulageAsDriver.length === 0) ||
                  (selectedRoleView === 'haulage-loader' && haulageAsLoader.length === 0) ||
                  (selectedRoleView === 'decortication-supervisor' && decorticationAsSupervisor.length === 0) ||
                  (selectedRoleView === 'decortication-operator' && decorticationAsOperator.length === 0) ||
                  (selectedRoleView === 'drying-dryer' && dryingAsDryer.length === 0) ||
                  (selectedRoleView === 'brushing-stock-recorder' && brushingStockAsRecorder.length === 0) ||
                  (selectedRoleView === 'brushing-supervisor' && brushingAsSupervisor.length === 0) ||
                  (selectedRoleView === 'brushing-brusher' && brushingAsBrusher.length === 0) ||
                  (selectedRoleView === 'baling-supervisor' && balingAsSupervisor.length === 0) ||
                  (selectedRoleView === 'baling-baler' && balingAsBaler.length === 0) ||
                  (selectedRoleView === 'silage-supervisor' && silageAsSupervisor.length === 0) ||
                  (selectedRoleView === 'silage-operator' && silageAsOperator.length === 0))) && (
                <tr>
                  <td colSpan="2">No records for this role in the selected period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  return (
    <section className="panel">
      <h2>Employee record</h2>
      <p>
        <Link to="/employees">Back to employees</Link>
      </p>
      <p>
        This is a cross-role profile. It includes all assigned work in the selected period,
        even if the employee moved between roles.
      </p>

      <form className="form-grid" onSubmit={handleDateFilterSubmit}>
        <label>
          From
          <input name="from" type="date" defaultValue={dateFrom} min={fallbackFrom} max={fallbackTo} />
        </label>
        <label>
          To
          <input name="to" type="date" defaultValue={dateTo} min={fallbackFrom} max={fallbackTo} />
        </label>
        <button type="submit">Apply Date Filter</button>
      </form>

      <div className="card-grid">
        <article className="card">
          <h3>{employee.name}</h3>
          <p>
            <strong>Work No / scanner ID:</strong> <code>{employee.id}</code>
          </p>
          <p>
            <strong>Role:</strong> {getEmployeeRoleLabel(employee.role)}
          </p>
          <p>
            <strong>Contract:</strong> {getContractTypeLabel(employee.contractType)}
            {employee.contractType === 'seasonal' && employee.seasonalGrade
              ? ` (${getSeasonalGradeLabel(employee.seasonalGrade)})`
              : ''}
          </p>
          {employee.contractType === 'regular' ? (
            <p>
              <strong>Monthly salary:</strong>{' '}
              {employee.monthlySalaryKes
                ? `KES ${Number(employee.monthlySalaryKes).toLocaleString()}`
                : 'Not set'}
            </p>
          ) : (
            <p>
              <strong>Daily rate:</strong>{' '}
              {employee.dailyWageKes
                ? `KES ${Number(employee.dailyWageKes).toLocaleString()}`
                : 'Not set'}
            </p>
          )}
          <p>
            <strong>Status:</strong>{' '}
            <span className={`badge ${clockedInIds.includes(employee.id) ? 'badge-on' : 'badge-off'}`}>
              {clockedInIds.includes(employee.id) ? 'Clocked In' : 'Not Clocked In'}
            </span>
          </p>
          <p>
            <strong>Permissions:</strong> {getEmployeePermissionSummary(employee.role)}
          </p>
          {canEditEmployee && (
            <p>
              <Link to={`/employees/${employee.id}/edit`} className="action-link">
                Edit details
              </Link>
            </p>
          )}
        </article>
        <article className="card">
          <h3>Personal details</h3>
          <p><strong>Date of birth:</strong> {employee.dateOfBirth ? formatDisplayDate(employee.dateOfBirth) : 'Not set'}</p>
          <p><strong>Date of joining:</strong> {employee.dateOfJoining ? formatDisplayDate(employee.dateOfJoining) : 'Not set'}</p>
          <p><strong>Gender:</strong> {formatEmployeeFieldValue(employee.gender)}</p>
          <p><strong>Nationality:</strong> {formatEmployeeFieldValue(employee.nationality)}</p>
          <p><strong>Phone:</strong> {formatEmployeeFieldValue(employee.phone)}</p>
          <p><strong>Email:</strong> {formatEmployeeFieldValue(employee.email)}</p>
        </article>
        <article className="card">
          <h3>Employment & contract</h3>
          <p><strong>Position:</strong> {formatEmployeeFieldValue(employee.position)}</p>
          <p><strong>Department:</strong> {formatEmployeeFieldValue(employee.department)}</p>
          <p><strong>Reporting manager:</strong> {formatEmployeeFieldValue(employee.reportingManager)}</p>
          <p>
            <strong>Contract period:</strong>{' '}
            {employee.contractStartDate && employee.contractEndDate
              ? `${formatDisplayDate(employee.contractStartDate)} – ${formatDisplayDate(employee.contractEndDate)}`
              : 'Not set'}
          </p>
        </article>
        <article className="card">
          <h3>Identification & banking</h3>
          <p><strong>ID number:</strong> {formatEmployeeFieldValue(employee.idNumber)}</p>
          <p><strong>NSSF number:</strong> {formatEmployeeFieldValue(employee.nssfNumber)}</p>
          <p><strong>KRA PIN:</strong> {formatEmployeeFieldValue(employee.pinNumber)}</p>
          <p><strong>Bank:</strong> {formatEmployeeFieldValue(employee.bankName)}</p>
          <p><strong>Bank branch:</strong> {formatEmployeeFieldValue(employee.bankBranch)}</p>
          <p><strong>Account number:</strong> {formatEmployeeFieldValue(employee.bankAccountNumber)}</p>
        </article>
        <article className="card">
          <h3>Qualifications</h3>
          <p><strong>Highest qualification:</strong> {formatEmployeeFieldValue(employee.highestQualification)}</p>
          <p><strong>Relevant qualification:</strong> {formatEmployeeFieldValue(employee.relevantQualification)}</p>
        </article>
        <article className="card">
          <h3>Emergency contact</h3>
          <p><strong>Name:</strong> {formatEmployeeFieldValue(employee.emergencyContactName)}</p>
          <p><strong>Relation:</strong> {formatEmployeeFieldValue(employee.emergencyContactRelation)}</p>
          <p><strong>Phone:</strong> {formatEmployeeFieldValue(employee.emergencyContactNumber)}</p>
        </article>
        <article className="card">
          <h3>Activity totals</h3>
          <p><strong>Harvest entries:</strong> {harvestAsHarvester.length}</p>
          <p><strong>Harvested kg:</strong> {totalHarvestedKg.toLocaleString()}</p>
          <p><strong>Haulage trips:</strong> {haulageAsDriver.length + haulageAsLoader.length}</p>
          <p><strong>Decortication/drying shifts:</strong> {totalDecorticationShifts}</p>
          <p><strong>Bales handled:</strong> {balingAsBaler.length}</p>
          <p><strong>Baled kg:</strong> {totalBaledKg.toLocaleString()}</p>
          <p><strong>Silage bags handled:</strong> {silageAsOperator.length}</p>
          <p><strong>Silage kg:</strong> {totalSilageKg.toLocaleString()}</p>
        </article>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Area</th>
              <th>As role</th>
              <th>Records</th>
              <th>View record</th>
            </tr>
          </thead>
          <tbody>
            {roleRows.map((row) => (
              <tr key={row.key}>
                <td>{row.area}</td>
                <td>{row.role}</td>
                <td>{row.records}</td>
                <td>
                  <button
                    type="button"
                    className="action-link action-link-button"
                    onClick={() => handleOpenRoleRecord(row.key)}
                  >
                    View record
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section id="employee-role-record-details">
        {selectedRoleView ? (
          renderRoleDetail()
        ) : (
          <div className="placeholder">Choose “View record” on a role row to open detailed records.</div>
        )}
      </section>
    </section>
  )
}

function EmployeeProfileEditor({ employee, canEdit, onSubmit, submitLabel = 'Save employee details' }) {
  function handleSubmit(event) {
    event.preventDefault()
    if (!canEdit) {
      return
    }
    onSubmit(parseEmployeeProfileFromForm(new FormData(event.currentTarget)))
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <h4>Personal</h4>
      <label>
        Full name
        <input name="profileName" defaultValue={employee.name ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Date of birth
        <input
          name="profileDateOfBirth"
          type="date"
          defaultValue={employee.dateOfBirth ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Date of joining
        <input
          name="profileDateOfJoining"
          type="date"
          defaultValue={employee.dateOfJoining ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Gender
        <input name="profileGender" defaultValue={employee.gender ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Nationality
        <input name="profileNationality" defaultValue={employee.nationality ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Phone number
        <input name="profilePhone" defaultValue={employee.phone ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Email address
        <input
          name="profileEmail"
          type="email"
          defaultValue={employee.email ?? ''}
          disabled={!canEdit}
        />
      </label>

      <h4>Employment & contract</h4>
      <p className="placeholder">
        Work No / scanner User ID: <code>{employee.id}</code>
      </p>
      <label>
        Position
        <input name="profilePosition" defaultValue={employee.position ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Department
        <input name="profileDepartment" defaultValue={employee.department ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Reporting manager
        <input
          name="profileReportingManager"
          defaultValue={employee.reportingManager ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Contract type
        <select name="contractType" defaultValue={employee.contractType ?? 'regular'} disabled={!canEdit}>
          {CONTRACT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seasonal grade
        <select name="seasonalGrade" defaultValue={employee.seasonalGrade ?? ''} disabled={!canEdit}>
          {SEASONAL_GRADE_OPTIONS.map((option) => (
            <option key={option.value || 'none'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Daily wage (KES)
        <input
          name="dailyWageKes"
          type="number"
          min="0"
          defaultValue={employee.dailyWageKes ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Monthly salary (KES)
        <input
          name="monthlySalaryKes"
          type="number"
          min="0"
          defaultValue={employee.monthlySalaryKes ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Contract start date
        <input
          name="profileContractStartDate"
          type="date"
          defaultValue={employee.contractStartDate ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Contract end date
        <input
          name="profileContractEndDate"
          type="date"
          defaultValue={employee.contractEndDate ?? ''}
          disabled={!canEdit}
        />
      </label>

      <h4>Identification & banking</h4>
      <label>
        ID number
        <input name="profileIdNumber" defaultValue={employee.idNumber ?? ''} disabled={!canEdit} />
      </label>
      <label>
        NSSF number
        <input name="profileNssfNumber" defaultValue={employee.nssfNumber ?? ''} disabled={!canEdit} />
      </label>
      <label>
        KRA PIN
        <input name="profilePinNumber" defaultValue={employee.pinNumber ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Bank name
        <input name="profileBankName" defaultValue={employee.bankName ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Bank branch
        <input name="profileBankBranch" defaultValue={employee.bankBranch ?? ''} disabled={!canEdit} />
      </label>
      <label>
        Bank account number
        <input
          name="profileBankAccountNumber"
          defaultValue={employee.bankAccountNumber ?? ''}
          disabled={!canEdit}
        />
      </label>

      <h4>Qualifications</h4>
      <label>
        Highest qualification
        <input
          name="profileHighestQualification"
          defaultValue={employee.highestQualification ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Relevant qualification
        <input
          name="profileRelevantQualification"
          defaultValue={employee.relevantQualification ?? ''}
          disabled={!canEdit}
        />
      </label>

      <h4>Emergency contact</h4>
      <label>
        Contact name
        <input
          name="profileEmergencyContactName"
          defaultValue={employee.emergencyContactName ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Relation
        <input
          name="profileEmergencyContactRelation"
          defaultValue={employee.emergencyContactRelation ?? ''}
          disabled={!canEdit}
        />
      </label>
      <label>
        Contact phone
        <input
          name="profileEmergencyContactNumber"
          defaultValue={employee.emergencyContactNumber ?? ''}
          disabled={!canEdit}
        />
      </label>

      {canEdit ? <button type="submit">{submitLabel}</button> : null}
    </form>
  )
}

function EmployeeEditPage({
  employees,
  currentUser,
  pagePermissionOverrides,
  dataEntryPermissionOverrides,
  onUpdateEmployeeRole,
  onSaveEmployeePageAccess,
  onSaveEmployeeDataEntryPermissions,
  onUpdateEmployeeProfile,
}) {
  const { employeeId } = useParams()
  const employee = employees.find((item) => item.id === employeeId)
  const canEditEmployeeProfile =
    currentUser?.role === 'admin' || currentUser?.role === 'harvesting-manager'
  const canEditRoleAndPermissions = currentUser?.role === 'admin'
  const [selectedPages, setSelectedPages] = useState(() =>
    employee ? new Set(getBasePageListForEditor(employee.id, pagePermissionOverrides, employees)) : new Set(),
  )
  const [selectedDataEntryPermissions, setSelectedDataEntryPermissions] = useState(() =>
    employee
      ? new Set(
          getBaseDataEntryPermissionsForEditor(employee.id, dataEntryPermissionOverrides, employees),
        )
      : new Set(),
  )

  useEffect(() => {
    if (!employee) {
      return
    }
    setSelectedPages(new Set(getBasePageListForEditor(employee.id, pagePermissionOverrides, employees)))
  }, [employee, pagePermissionOverrides, employees])

  useEffect(() => {
    if (!employee) {
      return
    }
    setSelectedDataEntryPermissions(
      new Set(
        getBaseDataEntryPermissionsForEditor(employee.id, dataEntryPermissionOverrides, employees),
      ),
    )
  }, [employee, dataEntryPermissionOverrides, employees])

  if (!employee) {
    return (
      <section className="panel">
        <h2>Edit employee</h2>
        <div className="placeholder">
          Employee not found. <Link to="/employees">Back to employees list</Link>.
        </div>
      </section>
    )
  }

  function togglePagePermission(pageId) {
    if (!canEditRoleAndPermissions || pageId === 'dashboard') {
      return
    }
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(pageId)) {
        next.delete(pageId)
      } else {
        next.add(pageId)
      }
      next.add('dashboard')
      return next
    })
  }

  function handleSaveRoleAndPermissions(event) {
    event.preventDefault()
    if (!canEditRoleAndPermissions) {
      return
    }
    const formData = new FormData(event.currentTarget)
    const nextRole = String(formData.get('employeeRole') ?? employee.role)
    onUpdateEmployeeRole(employee.id, nextRole)
    onSaveEmployeePageAccess(employee.id, [...selectedPages])
    onSaveEmployeeDataEntryPermissions(employee.id, [...selectedDataEntryPermissions])
  }

  function toggleDataEntryPermission(permissionId) {
    if (!canEditRoleAndPermissions) {
      return
    }
    setSelectedDataEntryPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(permissionId)) {
        next.delete(permissionId)
      } else {
        next.add(permissionId)
      }
      return next
    })
  }

  return (
    <section className="panel">
      <h2>Edit employee</h2>
      <p>
        <Link to={`/employees/${employee.id}`} className="action-link">
          Back to details
        </Link>
      </p>

      <div className="card-grid">
        <article className="card">
          <h3>Role and page permissions</h3>
          {!canEditRoleAndPermissions && (
            <p className="placeholder">Only Admin can edit role and page permissions.</p>
          )}
          <form className="form-grid" onSubmit={handleSaveRoleAndPermissions}>
            <label>
              Role
              <select name="employeeRole" defaultValue={employee.role} disabled={!canEditRoleAndPermissions}>
                {employeeRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="page-access-checkboxes">
              <legend>Visible pages</legend>
              {PAGE_ACCESS_IDS.map((pageId) => (
                <label key={pageId} className="check-item">
                  <input
                    type="checkbox"
                    checked={selectedPages.has(pageId)}
                    disabled={!canEditRoleAndPermissions || pageId === 'dashboard'}
                    onChange={() => togglePagePermission(pageId)}
                  />
                  <span>
                    {PAGE_ACCESS_LABELS[pageId] ?? pageId}
                    {pageId === 'dashboard' ? ' (always on)' : ''}
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="page-access-checkboxes">
              <legend>Data entry permissions</legend>
              {DATA_ENTRY_PERMISSION_IDS.map((permissionId) => (
                <label key={permissionId} className="check-item">
                  <input
                    type="checkbox"
                    checked={selectedDataEntryPermissions.has(permissionId)}
                    disabled={!canEditRoleAndPermissions}
                    onChange={() => toggleDataEntryPermission(permissionId)}
                  />
                  <span>{DATA_ENTRY_PERMISSION_LABELS[permissionId] ?? permissionId}</span>
                </label>
              ))}
            </fieldset>
            {canEditRoleAndPermissions && <button type="submit">Save role and permissions</button>}
          </form>
        </article>
        <article className="card">
          <h3>Employee database details</h3>
          {!canEditEmployeeProfile && (
            <p className="placeholder">Only Admin or Harvesting Manager can edit these fields.</p>
          )}
          <EmployeeProfileEditor
            key={employee.id}
            employee={employee}
            canEdit={canEditEmployeeProfile}
            onSubmit={(profile) => onUpdateEmployeeProfile(employee.id, profile)}
          />
        </article>
      </div>
    </section>
  )
}

function HarvestWeightEntryPage({
  employees,
  currentUser,
  currentUserDataEntryPermissions,
  clockedInIds,
  activeBatchNumber,
  onSubmitRecord,
}) {
  const [selectedHarvesterId, setSelectedHarvesterId] = useState('')
  const [currentBundleWeight, setCurrentBundleWeight] = useState('')
  const [pendingBundleWeights, setPendingBundleWeights] = useState([])
  const [entryStatus, setEntryStatus] = useState('')

  const canEnterHarvestData = currentUserDataEntryPermissions.has('harvesting-entry')
  const availableHarvesters = employees.filter((employee) => {
    if (employee.role !== 'harvester') {
      return false
    }
    if (!clockedInIds.includes(employee.id)) {
      return false
    }
    return true
  })

  const runningTotal = Number(
    pendingBundleWeights.reduce((sum, weight) => sum + weight, 0).toFixed(1),
  )

  function resetEntry(keepHarvester = false) {
    if (!keepHarvester) {
      setSelectedHarvesterId('')
    }
    setCurrentBundleWeight('')
    setPendingBundleWeights([])
  }

  function handleAddBundleWeight() {
    const weight = Number(currentBundleWeight)
    if (Number.isNaN(weight) || weight <= 0) {
      setEntryStatus('Enter a valid positive bundle weight before adding another bundle.')
      return
    }
    setPendingBundleWeights((prev) => [...prev, Number(weight.toFixed(1))])
    setCurrentBundleWeight('')
    setEntryStatus('')
  }

  function handleUndoLastBundle() {
    setPendingBundleWeights((prev) => prev.slice(0, -1))
    setEntryStatus('')
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!canEnterHarvestData || !currentUser) {
      setEntryStatus('You do not have permission to record harvest weights.')
      return
    }
    if (!selectedHarvesterId) {
      setEntryStatus('Select a clocked-in harvester first.')
      return
    }
    const typedWeight = Number(currentBundleWeight)
    const bundleWeights =
      !Number.isNaN(typedWeight) && typedWeight > 0
        ? [...pendingBundleWeights, Number(typedWeight.toFixed(1))]
        : [...pendingBundleWeights]
    if (bundleWeights.length === 0) {
      setEntryStatus('Add at least one valid bundle weight before saving.')
      return
    }
    onSubmitRecord(selectedHarvesterId, bundleWeights, currentUser.id)
    const totalKg = Number(bundleWeights.reduce((sum, weight) => sum + weight, 0).toFixed(1))
    const harvesterName =
      employees.find((employee) => employee.id === selectedHarvesterId)?.name ?? 'Harvester'
    resetEntry(true)
    setEntryStatus(
      `Saved ${totalKg} kg for ${harvesterName} (${bundleWeights.length} bundle${bundleWeights.length === 1 ? '' : 's'}).`,
    )
  }

  return (
    <section className="panel harvest-entry-page">
      <h2>Record Harvest Weights</h2>
      <p className="harvest-entry-lead">
        Weigh each bundle individually. The app adds them up for you.
      </p>
      <p className="harvest-entry-batch">
        Active batch: <strong>{normalizeBatchNumber(activeBatchNumber)}</strong>
      </p>

      {!currentUser && (
        <div className="placeholder">Sign in to record harvest weights.</div>
      )}

      {currentUser && !canEnterHarvestData && (
        <div className="placeholder">
          Only harvesting supervisors and managers can record harvest weights.
        </div>
      )}

      {currentUser && canEnterHarvestData && (
        <form className="harvest-entry-form" onSubmit={handleSubmit}>
          <label className="harvest-entry-field">
            Harvester
            <select
              value={selectedHarvesterId}
              onChange={(event) => {
                setSelectedHarvesterId(event.target.value)
                setEntryStatus('')
              }}
            >
              <option value="">Select harvester</option>
              {availableHarvesters.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} ({employee.id})
                </option>
              ))}
            </select>
          </label>

          {availableHarvesters.length === 0 && (
            <div className="placeholder">
              No harvesters are clocked in right now. Ask harvesters to clock in at the scanner
              first.
            </div>
          )}

          <label className="harvest-entry-field">
            Bundle weight (kg)
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="0.1"
              value={currentBundleWeight}
              onChange={(event) => setCurrentBundleWeight(event.target.value)}
              placeholder="e.g. 12.5"
              disabled={!selectedHarvesterId}
            />
          </label>

          <div className="harvest-entry-actions">
            <button
              type="button"
              className="harvest-entry-button-secondary"
              onClick={handleAddBundleWeight}
              disabled={!selectedHarvesterId}
            >
              Add bundle
            </button>
            <button
              type="button"
              className="harvest-entry-button-secondary"
              onClick={handleUndoLastBundle}
              disabled={pendingBundleWeights.length === 0}
            >
              Undo last
            </button>
          </div>

          <div className="harvest-entry-total" aria-live="polite">
            <span className="harvest-entry-total-label">Total so far</span>
            <span className="harvest-entry-total-value">{runningTotal} kg</span>
            <span className="harvest-entry-total-meta">
              {pendingBundleWeights.length} bundle{pendingBundleWeights.length === 1 ? '' : 's'}
            </span>
          </div>

          {pendingBundleWeights.length > 0 && (
            <ul className="harvest-entry-bundle-list">
              {pendingBundleWeights.map((weight, index) => (
                <li key={`${index}-${weight}`}>
                  Bundle {index + 1}: {weight} kg
                </li>
              ))}
            </ul>
          )}

          <button
            type="submit"
            className="harvest-entry-button-primary"
            disabled={!selectedHarvesterId}
          >
            Save harvest
          </button>
        </form>
      )}

      {entryStatus && <div className="harvest-entry-status">{entryStatus}</div>}

      <Link className="action-link harvest-entry-back" to="/activities/harvesting">
        Back to harvesting summary
      </Link>
    </section>
  )
}

function HarvestingPage({
  employees,
  currentUser,
  currentUserDataEntryPermissions,
  records,
  compensationRules,
  onSaveCompensationRules,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  activeBatchNumber,
  onSetActiveBatchNumber,
}) {
  const [showBatchAssignment, setShowBatchAssignment] = useState(false)
  const [showCompensationSettings, setShowCompensationSettings] = useState(false)
  const [showSupervisors, setShowSupervisors] = useState(false)
  const [showHarvestingSummary, setShowHarvestingSummary] = useState(false)
  const [showHarvesters, setShowHarvesters] = useState(false)
  const dateBounds = useMemo(() => {
    if (records.length === 0) {
      const today = new Date().toISOString().slice(0, 10)
      return { min: today, max: today }
    }
    const dates = records.map((record) => record.harvestedOn)
    return {
      min: [...dates].sort()[0],
      max: [...dates].sort().at(-1),
    }
  }, [records])

  const [incentiveRateInput, setIncentiveRateInput] = useState(
    String(compensationRules.incentiveRateKesPerKg),
  )
  const [batchStartYearInput, setBatchStartYearInput] = useState('2025')
  const [batchFieldInput, setBatchFieldInput] = useState('006')

  useEffect(() => {
    setIncentiveRateInput(String(compensationRules.incentiveRateKesPerKg))
  }, [compensationRules])

  const isAdmin = currentUser?.role === 'admin'
  const canManageBatch = currentUserDataEntryPermissions.has('harvesting-batch')
  const canManageCompensation = currentUserDataEntryPermissions.has('harvesting-compensation')
  const canViewHarvestingSections =
    isAdmin ||
    currentUser?.role === 'harvesting-manager' ||
    currentUser?.role === 'harvesting-supervisor'
  const canEnterHarvestData = currentUserDataEntryPermissions.has('harvesting-entry')
  const supervisors = employees.filter((employee) => employee.role === 'harvesting-supervisor')
  const availableBatches = Array.from(
    new Set(records.map((record) => normalizeBatchNumber(record.batchNumber))),
  ).sort()
  const filteredRecords =
    selectedBatchFilter === 'all'
      ? records.filter((record) => record.harvestedOn >= dateFrom && record.harvestedOn <= dateTo)
      : records.filter((record) => record.batchNumber === selectedBatchFilter)
  const dateSpanDays = getInclusiveDays(dateFrom, dateTo)
  const totalKg = filteredRecords.reduce((sum, record) => sum + record.kg, 0)
  const effectiveDays =
    selectedBatchFilter === 'all'
      ? dateSpanDays
      : Math.max(1, new Set(filteredRecords.map((record) => record.harvestedOn)).size)
  const averageKgPerDay = Math.round(totalKg / effectiveDays)
  const distinctHarvesters = new Set(filteredRecords.map((record) => record.harvesterId)).size
  const averageKgPerHarvesterPerDay =
    distinctHarvesters > 0 ? Math.round(totalKg / (distinctHarvesters * effectiveDays)) : 0

  function handleCompensationSubmit(event) {
    event.preventDefault()
    if (!canManageCompensation) {
      return
    }
    const incentiveRateKesPerKg = Number(incentiveRateInput)
    if (Number.isNaN(incentiveRateKesPerKg)) {
      return
    }
    if (incentiveRateKesPerKg < 0) {
      return
    }
    onSaveCompensationRules({
      incentiveRateKesPerKg,
      incentiveThresholdKg: compensationRules.incentiveThresholdKg,
    })
  }

  function handleBatchSubmit(event) {
    event.preventDefault()
    if (!canManageBatch) {
      return
    }
    const year = Number(batchStartYearInput)
    const field = Number(batchFieldInput)
    if (Number.isNaN(year) || Number.isNaN(field)) {
      return
    }
    if (year < 2000 || year > 2100 || field < 1 || field > 999) {
      return
    }
    onSetActiveBatchNumber(buildBatchNumber(year, field))
  }

  const supervisorsSummary = supervisors.map((supervisor) => {
    const supervisorRecords = filteredRecords.filter(
      (record) => record.recordedById === supervisor.id,
    )
    const dailySummary = Object.values(
      supervisorRecords.reduce((summary, record) => {
        if (!summary[record.harvestedOn]) {
          summary[record.harvestedOn] = {
            harvestedOn: record.harvestedOn,
            supervisorDailyWageKes: record.supervisorDailyWageKes ?? 0,
          }
        }
        return summary
      }, {}),
    )
    const daysWorked = dailySummary.length
    const remuneration = dailySummary.reduce(
      (sum, day) => sum + (day.supervisorDailyWageKes ?? 0),
      0,
    )
    return {
      supervisorId: supervisor.id,
      supervisorName: supervisor.name,
      daysWorked,
      remuneration,
    }
  })

  const harvestersSummary = Object.values(
    filteredRecords.reduce((summary, record) => {
      if (!summary[record.harvesterId]) {
        summary[record.harvesterId] = {
          harvesterId: record.harvesterId,
          name: record.harvesterName,
          daysWorkedSet: new Set(),
          leafMassKg: 0,
          basicWage: 0,
          incentive: 0,
        }
      }
      summary[record.harvesterId].daysWorkedSet.add(record.harvestedOn)
      summary[record.harvesterId].leafMassKg += record.kg
      summary[record.harvesterId].basicWage += record.baseWageKes
      summary[record.harvesterId].incentive += record.incentiveKes
      return summary
    }, {}),
  )
    .map((item) => {
      const daysWorked = item.daysWorkedSet.size
      return {
        harvesterId: item.harvesterId,
        name: item.name,
        daysWorked,
        leafMassKg: item.leafMassKg,
        basicWage: item.basicWage,
        incentive: item.incentive,
        averageLeafMassPerDay: daysWorked > 0 ? Math.round(item.leafMassKg / daysWorked) : 0,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const summaryPeriodFrom =
    selectedBatchFilter === 'all'
      ? dateFrom
      : (filteredRecords.map((record) => record.harvestedOn).sort()[0] ?? dateFrom)
  const summaryPeriodTo =
    selectedBatchFilter === 'all'
      ? dateTo
      : (filteredRecords.map((record) => record.harvestedOn).sort().at(-1) ?? dateTo)
  const monSatWorkDaysInPeriod = countMondaySaturdayWorkDays(summaryPeriodFrom, summaryPeriodTo)
  const harvestingSummaryAverages =
    harvestersSummary.length > 0
      ? {
          daysWorked: Math.round(
            harvestersSummary.reduce((sum, item) => sum + item.daysWorked, 0) /
              harvestersSummary.length,
          ),
          totalKg: Math.round(
            harvestersSummary.reduce((sum, item) => sum + item.leafMassKg, 0) /
              harvestersSummary.length,
          ),
          averageKgPerDay: Math.round(
            harvestersSummary.reduce((sum, item) => sum + item.averageLeafMassPerDay, 0) /
              harvestersSummary.length,
          ),
        }
      : null

  return (
    <section className="panel">
      <h2>Harvesting</h2>
      <p>
        Date-filtered harvesting summary with supervisor remuneration and harvester output
        analytics.
      </p>

      <h3>Date Filter</h3>
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
            min={dateBounds.min}
            max={dateBounds.max}
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            disabled={selectedBatchFilter !== 'all'}
          />
        </label>
        <label>
          To
          <input
            type="date"
            min={dateBounds.min}
            max={dateBounds.max}
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            disabled={selectedBatchFilter !== 'all'}
          />
        </label>
      </div>
      {selectedBatchFilter !== 'all' && (
        <div className="placeholder">
          Batch filter is active. Date filter is ignored until you switch back to `Date
          filtered records`.
        </div>
      )}

      <h3>
        Summary{' '}
        {selectedBatchFilter === 'all'
          ? `(${formatDisplayDate(dateFrom)} - ${formatDisplayDate(dateTo)})`
          : `(Batch ${selectedBatchFilter})`}
      </h3>
      <div className="kpi-grid">
        <article className="card">
          <h3>Total kg of leaves harvested</h3>
          <p>{totalKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average kg of leaves per day</h3>
          <p>{averageKgPerDay.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average kg per harvester per day</h3>
          <p>{averageKgPerHarvesterPerDay.toLocaleString()} kg</p>
        </article>
      </div>

      <div className="rules-box">
        <strong>Pay Rule:</strong> Each harvester&apos;s daily base rate from their employee record +
        KES {compensationRules.incentiveRateKesPerKg} per kg above{' '}
        {compensationRules.incentiveThresholdKg} kg. Supervisors are paid their own daily rate for
        each day worked.
      </div>
      <div className="rules-box">
        <strong>Active Batch Number:</strong> {activeBatchNumber}
      </div>

      <CollapsibleSection
        title="Batch Assignment"
        isOpen={showBatchAssignment}
        onToggle={() => setShowBatchAssignment((prev) => !prev)}
        canExpand={canManageBatch}
        deniedMessage="You do not have batch allocation permission."
      >
        <form className="form-grid" onSubmit={handleBatchSubmit}>
          <label>
            Start Year
            <input
              type="number"
              min="2000"
              max="2100"
              value={batchStartYearInput}
              onChange={(event) => setBatchStartYearInput(event.target.value)}
              disabled={!canManageBatch}
            />
          </label>
          <label>
            Field Number
            <input
              type="number"
              min="1"
              max="999"
              value={batchFieldInput}
              onChange={(event) => setBatchFieldInput(event.target.value)}
              disabled={!canManageBatch}
            />
          </label>
          <button type="submit" disabled={!canManageBatch}>
            Set Active Batch
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="Compensation Settings"
        isOpen={showCompensationSettings}
        onToggle={() => setShowCompensationSettings((prev) => !prev)}
        canExpand={canManageCompensation}
        deniedMessage="You do not have compensation settings permission."
      >
        <form className="form-grid" onSubmit={handleCompensationSubmit}>
          <label>
            Incentive (KES per kg above {compensationRules.incentiveThresholdKg} kg)
            <input
              type="number"
              min="0"
              value={incentiveRateInput}
              onChange={(event) => setIncentiveRateInput(event.target.value)}
              disabled={!canManageCompensation}
            />
          </label>
          <button type="submit" disabled={!canManageCompensation}>
            Save incentive rule
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="Harvesting Supervisors"
        isOpen={showSupervisors}
        onToggle={() => setShowSupervisors((prev) => !prev)}
        canExpand={canViewHarvestingSections}
        deniedMessage="Only Admin, Harvesting Manager, or Harvesting Supervisor can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supervisor Name</th>
              <th>Batch</th>
                <th>Days Worked</th>
                <th>Remuneration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {supervisorsSummary.map((item) => (
                <tr key={item.supervisorId}>
                  <td>{item.supervisorName}</td>
                  <td>{selectedBatchFilter === 'all' ? 'Multiple' : selectedBatchFilter}</td>
                  <td>{item.daysWorked}</td>
                  <td>KES {item.remuneration.toLocaleString()}</td>
                  <td>
                    <Link
                      className="action-link"
                      to={`/activities/harvesting/records/${item.supervisorId}?from=${dateFrom}&to=${dateTo}&batch=${selectedBatchFilter}`}
                    >
                      View Record
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Harvesting Summary"
        isOpen={showHarvestingSummary}
        onToggle={() => setShowHarvestingSummary((prev) => !prev)}
        canExpand={canViewHarvestingSections}
        deniedMessage="Only Admin, Harvesting Manager, or Harvesting Supervisor can open this section."
      >
        <p className="harvesting-summary-period">
          Period: {formatDisplayDate(summaryPeriodFrom)} – {formatDisplayDate(summaryPeriodTo)}
          {selectedBatchFilter !== 'all' ? ` | Batch ${selectedBatchFilter}` : ''}
        </p>
        <div className="table-wrap">
          <table className="harvesting-summary-table">
            <thead>
              <tr>
                <th colSpan="2">Work days in period</th>
                <th colSpan="2">
                  Number of work days (Monday–Saturday) in the defined period:{' '}
                  {monSatWorkDaysInPeriod}
                </th>
              </tr>
              <tr>
                <th>Harvester</th>
                <th>Days worked</th>
                <th>Total kg</th>
                <th>Average kg per day</th>
              </tr>
            </thead>
            <tbody>
              {harvestersSummary.length === 0 && (
                <tr>
                  <td colSpan="4">No harvesters worked during this period.</td>
                </tr>
              )}
              {harvestersSummary.map((item) => (
                <tr key={item.harvesterId}>
                  <td>
                    <span className="harvesting-summary-name">{item.name}</span>{' '}
                    <Link
                      className="harvesting-day-record-link"
                      to={`/activities/harvesting/records/${item.harvesterId}?from=${summaryPeriodFrom}&to=${summaryPeriodTo}&batch=${selectedBatchFilter}`}
                    >
                      Day record
                    </Link>
                  </td>
                  <td>{item.daysWorked}</td>
                  <td>{item.leafMassKg.toLocaleString()}</td>
                  <td>{item.averageLeafMassPerDay.toLocaleString()}</td>
                </tr>
              ))}
              {harvestingSummaryAverages && (
                <tr className="harvesting-summary-averages">
                  <td>
                    <strong>Averages</strong>
                  </td>
                  <td>{harvestingSummaryAverages.daysWorked.toLocaleString()}</td>
                  <td>{harvestingSummaryAverages.totalKg.toLocaleString()}</td>
                  <td>{harvestingSummaryAverages.averageKgPerDay.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Harvesters"
        isOpen={showHarvesters}
        onToggle={() => setShowHarvesters((prev) => !prev)}
        canExpand={canViewHarvestingSections}
        deniedMessage="Only Admin, Harvesting Manager, or Harvesting Supervisor can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
              <th>Batch</th>
                <th>Days Worked</th>
                <th>Leaf Mass (kg)</th>
                <th>Basic Wage</th>
                <th>Incentive</th>
                <th>Average Leaf Mass Per Day</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {harvestersSummary.map((item) => (
                <tr key={item.harvesterId}>
                  <td>{item.name}</td>
                  <td>{selectedBatchFilter === 'all' ? 'Multiple' : selectedBatchFilter}</td>
                  <td>{item.daysWorked}</td>
                  <td>{item.leafMassKg.toLocaleString()}</td>
                  <td>KES {item.basicWage.toLocaleString()}</td>
                  <td>KES {item.incentive.toLocaleString()}</td>
                  <td>{item.averageLeafMassPerDay.toLocaleString()} kg</td>
                  <td>
                    <Link
                      className="action-link"
                      to={`/activities/harvesting/records/${item.harvesterId}?from=${dateFrom}&to=${dateTo}&batch=${selectedBatchFilter}`}
                    >
                      View Record
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {canEnterHarvestData && (
        <div className="harvest-entry-promo">
          <p>Supervisors record leaf mass on a separate mobile-friendly screen — one bundle at a time.</p>
          <Link className="harvest-entry-promo-link" to="/activities/harvesting/entry">
            Open harvest weight entry
          </Link>
        </div>
      )}
    </section>
  )
}

function HarvestingDailyPage({ employees, records }) {
  const { date } = useParams()
  const [searchParams] = useSearchParams()
  const selectedBatch = searchParams.get('batch') || 'all'
  const dayRecords = records.filter(
    (record) =>
      record.harvestedOn === date &&
      (selectedBatch === 'all' ? true : record.batchNumber === selectedBatch),
  )
  const sortedDayRecords = [...dayRecords].sort((a, b) =>
    b.harvesterName.localeCompare(a.harvesterName),
  )
  const supervisorMap = employees.reduce((map, employee) => {
    map[employee.id] = employee
    return map
  }, {})
  const harvestersPresent = new Set(dayRecords.map((record) => record.harvesterId)).size
  const supervisorsPresent = new Set(dayRecords.map((record) => record.recordedById)).size
  const totalLeafMass = dayRecords.reduce((sum, record) => sum + record.kg, 0)
  const averagePerHarvester = harvestersPresent > 0 ? Math.round(totalLeafMass / harvestersPresent) : 0

  return (
    <section className="panel">
      <h2>Leaf Mass Detail - {formatDisplayDate(date)}</h2>
      {selectedBatch !== 'all' && <p>Batch: {selectedBatch}</p>}
      <div className="kpi-grid">
        <article className="card">
          <h3>Harvesters present</h3>
          <p>{harvestersPresent}</p>
        </article>
        <article className="card">
          <h3>Supervisors present</h3>
          <p>{supervisorsPresent}</p>
        </article>
        <article className="card">
          <h3>Total leaf mass</h3>
          <p>{totalLeafMass.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average per harvester</h3>
          <p>{averagePerHarvester.toLocaleString()} kg</p>
        </article>
      </div>
      <Link className="action-link" to="/activities/harvesting">
        Back to Harvesting Summary
      </Link>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Harvester</th>
              <th>Bundles</th>
              <th>Leaf Mass (kg)</th>
              <th>Incentive</th>
              <th>Supervisor</th>
              <th>Batch</th>
              <th>Clock In</th>
              <th>Clock Out</th>
            </tr>
          </thead>
          <tbody>
            {sortedDayRecords.length === 0 && (
              <tr>
                <td colSpan="8">No records for this date.</td>
              </tr>
            )}
            {sortedDayRecords.map((record) => (
              <tr key={record.id}>
                <td>{record.harvesterName}</td>
                <td>{record.bundleWeights?.length ?? '—'}</td>
                <td>{record.kg}</td>
                <td>{record.incentiveKes}</td>
                <td>{supervisorMap[record.recordedById]?.name ?? record.recordedByName}</td>
                <td>{record.batchNumber}</td>
                <td>{record.clockInTime}</td>
                <td>{record.clockOutTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DecorticationPage({
  currentUser,
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  decorticationAssignments,
  decorticationRecords,
  dryingRecords,
  onCreateDecorticationShift,
  onUpdateDecorticationProduction,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const [showAssignment, setShowAssignment] = useState(false)
  const [showProductionRecords, setShowProductionRecords] = useState(false)
  const [showMachineSummary, setShowMachineSummary] = useState(false)
  const [showAttendanceSummary, setShowAttendanceSummary] = useState(false)
  const canManageDecortication = currentUserDataEntryPermissions.has('decortication-entry')
  const canViewDecortication =
    canManageDecortication || currentUser?.role === 'decortication-supervisor'
  const machines = ['D2', 'D3', 'D4']
  const [machine, setMachine] = useState('D2')
  const [shiftDate, setShiftDate] = useState(dateTo)
  const [shiftNumber, setShiftNumber] = useState('1')
  const [batchNumber, setBatchNumber] = useState(availableBatches[0] ?? '')
  const [supervisorId, setSupervisorId] = useState('')
  const [selectedOperatorIds, setSelectedOperatorIds] = useState([])
  const [editingRecordId, setEditingRecordId] = useState('')
  const [editWaterM3, setEditWaterM3] = useState('')
  const [editRuntimeHours, setEditRuntimeHours] = useState('')
  const [viewingRecordId, setViewingRecordId] = useState('')
  const [attendanceViewingEmployeeId, setAttendanceViewingEmployeeId] = useState('')
  const [assignmentStatus, setAssignmentStatus] = useState('')

  const clockedInSupervisors = employees.filter(
    (employee) =>
      employee.role === 'decortication-supervisor' && clockedInIds.includes(employee.id),
  )
  const clockedInOperators = employees.filter(
    (employee) =>
      employee.role === 'decorticator-operator' && clockedInIds.includes(employee.id),
  )

  const filteredRecords =
    selectedBatchFilter === 'all'
      ? decorticationRecords.filter(
          (record) => record.date >= dateFrom && record.date <= dateTo,
        )
      : decorticationRecords.filter((record) => record.batchNumber === selectedBatchFilter)
  const dryingByDecorticationRecordId = dryingRecords.reduce((map, record) => {
    map[record.decorticationRecordId] = (map[record.decorticationRecordId] ?? 0) + record.totalDriedKg
    return map
  }, {})
  const recordsWithDrying = filteredRecords.map((record) => ({
    ...record,
    driedFibreKg: Number((dryingByDecorticationRecordId[record.id] ?? 0).toFixed(1)),
  }))
  const sortedDecorticationRecords = [...recordsWithDrying].sort((a, b) =>
    a.date === b.date ? b.shiftNumber - a.shiftNumber : b.date.localeCompare(a.date),
  )
  const filteredAssignments =
    selectedBatchFilter === 'all'
      ? decorticationAssignments.filter(
          (assignment) => assignment.date >= dateFrom && assignment.date <= dateTo,
        )
      : decorticationAssignments.filter(
          (assignment) => assignment.batchNumber === selectedBatchFilter,
        )
  const supervisorAttendance = Object.values(
    filteredAssignments.reduce((map, assignment) => {
      if (!map[assignment.supervisorId]) {
        map[assignment.supervisorId] = {
          id: assignment.supervisorId,
          name: assignment.supervisorName,
          days: new Set(),
        }
      }
      map[assignment.supervisorId].days.add(assignment.date)
      return map
    }, {}),
  )
    .map((item) => ({
      id: item.id,
      name: item.name,
      daysWorked: item.days.size,
    }))
    .sort((a, b) => b.daysWorked - a.daysWorked)
  const operatorAttendance = Object.values(
    filteredAssignments.reduce((map, assignment) => {
      assignment.operatorIds.forEach((operatorId, index) => {
        if (!map[operatorId]) {
          map[operatorId] = {
            id: operatorId,
            name: assignment.operatorNames[index] ?? operatorId,
            days: new Set(),
          }
        }
        map[operatorId].days.add(assignment.date)
      })
      return map
    }, {}),
  )
    .map((item) => ({
      id: item.id,
      name: item.name,
      daysWorked: item.days.size,
    }))
    .sort((a, b) => b.daysWorked - a.daysWorked)
  const totalSupervisorAttendanceDays = supervisorAttendance.reduce(
    (sum, item) => sum + item.daysWorked,
    0,
  )
  const totalOperatorAttendanceDays = operatorAttendance.reduce(
    (sum, item) => sum + item.daysWorked,
    0,
  )
  const attendanceRows = [
    ...supervisorAttendance.map((item) => ({
      id: item.id,
      name: item.name,
      role: 'Decortication Supervisor',
      daysWorked: item.daysWorked,
    })),
    ...operatorAttendance.map((item) => ({
      id: item.id,
      name: item.name,
      role: 'Decorticator Operator',
      daysWorked: item.daysWorked,
    })),
  ].sort((a, b) => b.daysWorked - a.daysWorked)
  const totalFibreKg = recordsWithDrying.reduce((sum, record) => sum + record.driedFibreKg, 0)
  const totalWaterM3 = filteredRecords.reduce((sum, record) => sum + record.waterM3, 0)
  const totalRuntimeHours = filteredRecords.reduce((sum, record) => sum + record.runtimeHours, 0)
  const machineShiftCount = filteredRecords.length
  const averageFibrePerMachinePerShift =
    machineShiftCount > 0 ? Number((totalFibreKg / machineShiftCount).toFixed(1)) : 0
  const machineSummary = machines.map((machineCode) => {
    const records = recordsWithDrying.filter((record) => record.machine === machineCode)
    return {
      machine: machineCode,
      shifts: records.length,
      fibreKg: Number(records.reduce((sum, record) => sum + record.driedFibreKg, 0).toFixed(1)),
      waterM3: Number(records.reduce((sum, record) => sum + record.waterM3, 0).toFixed(1)),
      runtimeHours: Number(records.reduce((sum, record) => sum + record.runtimeHours, 0).toFixed(1)),
    }
  })

  function handleOperatorToggle(operatorId) {
    setSelectedOperatorIds((prev) =>
      prev.includes(operatorId)
        ? prev.filter((id) => id !== operatorId)
        : [...prev, operatorId],
    )
  }

  function handleCreateAssignment(event) {
    event.preventDefault()
    const shift = Number(shiftNumber)
    if (!canManageDecortication) {
      setAssignmentStatus('You do not have permission to assign decortication teams.')
      return
    }
    if (!supervisorId) {
      setAssignmentStatus('Select a clocked-in supervisor before saving the team assignment.')
      return
    }
    if (selectedOperatorIds.length !== 7) {
      setAssignmentStatus('Select exactly 7 clocked-in operators for this shift.')
      return
    }
    if (!shiftDate || !batchNumber) {
      setAssignmentStatus('Date and batch number are required.')
      return
    }
    if (Number.isNaN(shift) || shift <= 0) {
      setAssignmentStatus('Shift number must be greater than zero.')
      return
    }
    const supervisor = employees.find((employee) => employee.id === supervisorId)
    if (!supervisor) {
      setAssignmentStatus('Selected supervisor could not be found.')
      return
    }
    const assignmentId = `ASG-${Date.now()}`
    onCreateDecorticationShift({
      assignmentId,
      date: shiftDate,
      machine,
      shiftNumber: shift,
      batchNumber,
      supervisorId: supervisor.id,
      supervisorName: supervisor.name,
      operatorIds: selectedOperatorIds,
      operatorNames: selectedOperatorIds
        .map((id) => employees.find((employee) => employee.id === id)?.name)
        .filter(Boolean),
      fibreKg: 0,
      waterM3: 0,
      runtimeHours: 0,
      leafInputKg: 0,
    })
    setSelectedOperatorIds([])
    setAssignmentStatus('Team assignment saved. It is now visible in Decortication Records.')
    setShowProductionRecords(true)
  }

  function startEditingRecord(record) {
    setEditingRecordId(record.id)
    setViewingRecordId(record.id)
    setEditWaterM3(String(record.waterM3))
    setEditRuntimeHours(String(record.runtimeHours))
  }

  function handleUpdateProduction(event) {
    if (event?.preventDefault) {
      event.preventDefault()
    }
    if (!canManageDecortication || !editingRecordId) {
      return
    }
    const water = Number(editWaterM3)
    const runtime = Number(editRuntimeHours)
    if ([water, runtime].some((value) => Number.isNaN(value) || value <= 0)) {
      return
    }
    onUpdateDecorticationProduction(editingRecordId, {
      waterM3: water,
      runtimeHours: runtime,
    })
    setEditingRecordId('')
    setEditWaterM3('')
    setEditRuntimeHours('')
  }

  return (
    <section className="panel">
      <h2>Decortication</h2>
      <p>
        Track machine staffing, water consumption, runtime, and batch assignment for D2, D3, and
        D4. Fibre output is synced from Drying records after weighing.
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
          <h3>Total Shifts</h3>
          <p>{filteredRecords.length}</p>
        </article>
        <article className="card">
          <h3>Total Fibre</h3>
          <p>{totalFibreKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Total Water</h3>
          <p>{totalWaterM3.toLocaleString()} m3</p>
        </article>
        <article className="card">
          <h3>Total Runtime</h3>
          <p>{totalRuntimeHours.toLocaleString()} hrs</p>
        </article>
        <article className="card">
          <h3>Average Fibre per Machine per Shift</h3>
          <p>{averageFibrePerMachinePerShift.toLocaleString()} kg</p>
        </article>
      </div>

      <CollapsibleSection
        title="Assign Team"
        isOpen={showAssignment}
        onToggle={() => setShowAssignment((prev) => !prev)}
        canExpand={canManageDecortication}
        deniedMessage="Only Admin or Production Manager can open this section."
      >
        <form className="form-grid" onSubmit={handleCreateAssignment}>
          <label>
            Machine
            <select value={machine} onChange={(event) => setMachine(event.target.value)}>
              {machines.map((machineCode) => (
                <option key={machineCode} value={machineCode}>
                  {machineCode}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={shiftDate}
              onChange={(event) => setShiftDate(event.target.value)}
            />
          </label>
          <label>
            Shift Number
            <input
              type="number"
              min="1"
              value={shiftNumber}
              onChange={(event) => setShiftNumber(event.target.value)}
            />
          </label>
          <label>
            Batch Number
            <select value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)}>
              {availableBatches.map((batch) => (
                <option key={batch} value={batch}>
                  {batch}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supervisor (clocked in)
            <select value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)}>
              <option value="">Select supervisor</option>
              {clockedInSupervisors.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Operators (clocked in, select 7)
            <div className="checklist">
              {clockedInOperators.map((operator) => (
                <label key={operator.id} className="check-item">
                  <span>{operator.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedOperatorIds.includes(operator.id)}
                    onChange={() => handleOperatorToggle(operator.id)}
                  />
                </label>
              ))}
            </div>
          </label>
          <button type="submit" disabled={!canManageDecortication}>
            Save Team Assignment
          </button>
        </form>
        <div className="placeholder">
          Each machine must have 8 staff total per shift: 1 supervisor + 7 operators.
        </div>
        {assignmentStatus && <div className="placeholder">{assignmentStatus}</div>}
      </CollapsibleSection>

      <CollapsibleSection
        title="Machine Summary"
        isOpen={showMachineSummary}
        onToggle={() => setShowMachineSummary((prev) => !prev)}
        canExpand={canViewDecortication}
        deniedMessage="Only Admin, Production Manager, or Decortication Supervisor can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Shifts</th>
                <th>Fibre (kg)</th>
                <th>Water (m3)</th>
                <th>Runtime (hrs)</th>
              </tr>
            </thead>
            <tbody>
              {machineSummary.map((item) => (
                <tr key={item.machine}>
                  <td>{item.machine}</td>
                  <td>{item.shifts}</td>
                  <td>{item.fibreKg}</td>
                  <td>{item.waterM3}</td>
                  <td>{item.runtimeHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Decortication Records"
        isOpen={showProductionRecords}
        onToggle={() => setShowProductionRecords((prev) => !prev)}
        canExpand={canViewDecortication}
        deniedMessage="Only Admin, Production Manager, or Decortication Supervisor can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Machine</th>
                <th>Shift</th>
                <th>Batch</th>
                <th>Traceability Code</th>
                <th>Supervisor</th>
                <th>Operators</th>
                <th>Fibre (kg)</th>
                <th>Water (m3)</th>
                <th>Runtime (hrs)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedDecorticationRecords.map((record) => (
                <Fragment key={record.id}>
                  <tr key={record.id}>
                    <td>{formatDisplayDate(record.date)}</td>
                    <td>{record.machine}</td>
                    <td>{record.shiftNumber}</td>
                    <td>{normalizeBatchNumber(record.batchNumber)}</td>
                    <td>{buildTraceabilityCode(record.batchNumber, record.machine)}</td>
                    <td>{record.supervisorName}</td>
                    <td>{record.operatorIds.length}</td>
                    <td>
                      {record.driedFibreKg > 0 ? (
                        record.driedFibreKg
                      ) : (
                        'Pending'
                      )}
                    </td>
                    <td>
                      {editingRecordId === record.id ? (
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={editWaterM3}
                          onChange={(event) => setEditWaterM3(event.target.value)}
                        />
                      ) : record.waterM3 > 0 ? (
                        record.waterM3
                      ) : (
                        'Pending'
                      )}
                    </td>
                    <td>
                      {editingRecordId === record.id ? (
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={editRuntimeHours}
                          onChange={(event) => setEditRuntimeHours(event.target.value)}
                        />
                      ) : record.runtimeHours > 0 ? (
                        record.runtimeHours
                      ) : (
                        'Pending'
                      )}
                    </td>
                    <td>
                      {editingRecordId === record.id ? (
                        <>
                          <button type="button" onClick={handleUpdateProduction}>
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingRecordId('')}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditingRecord(record)}
                          disabled={!canManageDecortication}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setViewingRecordId((prev) => (prev === record.id ? '' : record.id))
                        }
                      >
                        {viewingRecordId === record.id ? 'Hide Record' : 'View Record'}
                      </button>
                    </td>
                  </tr>
                  {viewingRecordId === record.id && (
                    <tr key={`${record.id}-detail`}>
                      <td colSpan="11">
                        <div className="placeholder">
                          <strong>
                            {record.machine} | Shift {record.shiftNumber} |{' '}
                            {formatDisplayDate(record.date)}
                          </strong>
                          <div>Supervisor: {record.supervisorName}</div>
                          <div>Operators: {record.operatorNames.join(', ')}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Employee Attendance Summary"
        isOpen={showAttendanceSummary}
        onToggle={() => setShowAttendanceSummary((prev) => !prev)}
        canExpand={canViewDecortication}
        deniedMessage="Only Admin, Production Manager, or Decortication Supervisor can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Days Worked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.name}</td>
                    <td>{row.role}</td>
                    <td>{row.daysWorked}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setAttendanceViewingEmployeeId((prev) =>
                            prev === row.id ? '' : row.id,
                          )
                        }
                      >
                        {attendanceViewingEmployeeId === row.id ? 'Hide Record' : 'View Record'}
                      </button>
                    </td>
                  </tr>
                  {attendanceViewingEmployeeId === row.id && (
                    <tr>
                      <td colSpan="4">
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Machine</th>
                                <th>Shift</th>
                                <th>Batch</th>
                                <th>Role In Shift</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...filteredAssignments]
                                .filter(
                                  (assignment) =>
                                    assignment.supervisorId === row.id ||
                                    assignment.operatorIds.includes(row.id),
                                )
                                .sort((a, b) =>
                                  a.date === b.date
                                    ? b.shiftNumber - a.shiftNumber
                                    : b.date.localeCompare(a.date),
                                )
                                .map((assignment) => (
                                  <tr key={`${row.id}-${assignment.id}`}>
                                    <td>{formatDisplayDate(assignment.date)}</td>
                                    <td>{assignment.machine}</td>
                                    <td>{assignment.shiftNumber}</td>
                                    <td>{assignment.batchNumber}</td>
                                    <td>
                                      {assignment.supervisorId === row.id
                                        ? 'Supervisor'
                                        : 'Operator'}
                                    </td>
                                  </tr>
                                ))}
                              {!filteredAssignments.some(
                                (assignment) =>
                                  assignment.supervisorId === row.id ||
                                  assignment.operatorIds.includes(row.id),
                              ) && (
                                <tr>
                                  <td colSpan="5">
                                    No shift attendance records found for this employee in the
                                    current filter.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </section>
  )
}

function DryingPage({
  currentUser,
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  decorticationRecords,
  dryingRecords,
  onAddDryingRecord,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const [showDryingEntry, setShowDryingEntry] = useState(false)
  const [showDryingRecords, setShowDryingRecords] = useState(false)
  const [showAttendanceSummary, setShowAttendanceSummary] = useState(false)
  const [selectedDecorticationRecordId, setSelectedDecorticationRecordId] = useState('')
  const [weighedDate, setWeighedDate] = useState(dateTo)
  const [currentBundleWeight, setCurrentBundleWeight] = useState('')
  const [pendingBundleWeights, setPendingBundleWeights] = useState([])
  const [entryStatus, setEntryStatus] = useState('')
  const [attendanceViewingEmployeeId, setAttendanceViewingEmployeeId] = useState('')

  const canManageDrying = currentUserDataEntryPermissions.has('drying-entry')
  const canViewDrying =
    canManageDrying || currentUser?.role === 'decortication-supervisor'
  const canSubmitDryingEntry = canManageDrying

  const filteredDryingRecords =
    selectedBatchFilter === 'all'
      ? dryingRecords.filter((record) => record.weighedDate >= dateFrom && record.weighedDate <= dateTo)
      : dryingRecords.filter((record) => record.batchNumber === selectedBatchFilter)
  const sortedDryingRecords = [...filteredDryingRecords].sort((a, b) =>
    a.weighedDate === b.weighedDate
      ? b.shiftNumber - a.shiftNumber
      : b.weighedDate.localeCompare(a.weighedDate),
  )
  const distinctDryingDates = new Set(filteredDryingRecords.map((record) => record.weighedDate)).size
  const totalDriedKg = filteredDryingRecords.reduce((sum, record) => sum + record.totalDriedKg, 0)
  const totalDryingTimeDays = filteredDryingRecords.reduce((sum, record) => sum + record.dryingTimeDays, 0)
  const averageKgPerDay =
    distinctDryingDates > 0 ? Number((totalDriedKg / distinctDryingDates).toFixed(1)) : 0
  const averageDryingTimeDays =
    filteredDryingRecords.length > 0
      ? Number((totalDryingTimeDays / filteredDryingRecords.length).toFixed(2))
      : 0

  const dryingRecordByDecorticationId = dryingRecords.reduce((map, record) => {
    map[record.decorticationRecordId] = record
    return map
  }, {})
  const availableShiftOptions = decorticationRecords
    .filter((record) => !dryingRecordByDecorticationId[record.id])
    .sort((a, b) => (a.date === b.date ? b.shiftNumber - a.shiftNumber : b.date.localeCompare(a.date)))

  const employeeAttendance = Object.values(
    filteredDryingRecords.reduce((map, record) => {
      if (!map[record.dryerId]) {
        map[record.dryerId] = {
          id: record.dryerId,
          name: record.dryerName,
          role: 'Dryer',
          days: new Set(),
          shifts: 0,
        }
      }
      map[record.dryerId].days.add(record.weighedDate)
      map[record.dryerId].shifts += 1
      return map
    }, {}),
  )
    .map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      daysWorked: item.days.size,
      shiftsHandled: item.shifts,
    }))
    .sort((a, b) => b.daysWorked - a.daysWorked)

  const activeDryers = employees.filter(
    (employee) => employee.role === 'dryer' && clockedInIds.includes(employee.id),
  )
  const selectedAttendanceEmployee = employeeAttendance.find(
    (item) => item.id === attendanceViewingEmployeeId,
  )

  function handleAddBundleWeight() {
    const weight = Number(currentBundleWeight)
    if (Number.isNaN(weight) || weight <= 0) {
      setEntryStatus('Enter a valid positive bundle weight before adding another bundle.')
      return
    }
    setPendingBundleWeights((prev) => [...prev, Number(weight.toFixed(1))])
    setCurrentBundleWeight('')
    setEntryStatus('')
  }

  function handleSubmitDryingEntry(event) {
    event.preventDefault()
    if (!canSubmitDryingEntry) {
      setEntryStatus('Only Admin, Production Manager, or a clocked-in Dryer can record drying output.')
      return
    }
    if (!selectedDecorticationRecordId || !weighedDate) {
      setEntryStatus('Select a decortication shift and weighing date.')
      return
    }
    const sourceRecord = decorticationRecords.find((record) => record.id === selectedDecorticationRecordId)
    if (!sourceRecord) {
      setEntryStatus('Selected decortication shift could not be found.')
      return
    }
    if (dryingRecordByDecorticationId[selectedDecorticationRecordId]) {
      setEntryStatus('This decorticator shift already has drying output recorded.')
      return
    }
    const typedWeight = Number(currentBundleWeight)
    const bundleWeights =
      !Number.isNaN(typedWeight) && typedWeight > 0
        ? [...pendingBundleWeights, Number(typedWeight.toFixed(1))]
        : [...pendingBundleWeights]
    if (bundleWeights.length === 0) {
      setEntryStatus('Add at least one valid positive bundle weight before completing.')
      return
    }
    const total = Number(bundleWeights.reduce((sum, weight) => sum + weight, 0).toFixed(1))
    const dryingTimeDays = Math.max(
      0,
      Math.floor((new Date(weighedDate).getTime() - new Date(sourceRecord.date).getTime()) / (1000 * 60 * 60 * 24)),
    )
    onAddDryingRecord({
      decorticationRecordId: sourceRecord.id,
      decorticationDate: sourceRecord.date,
      weighedDate,
      machine: sourceRecord.machine,
      shiftNumber: sourceRecord.shiftNumber,
      batchNumber: sourceRecord.batchNumber,
      bundleWeights,
      totalDriedKg: total,
      dryingTimeDays,
      dryerId: currentUser?.id ?? 'SYSTEM',
      dryerName: currentUser?.name ?? 'System',
    })
    setSelectedDecorticationRecordId('')
    setCurrentBundleWeight('')
    setPendingBundleWeights([])
    setEntryStatus('Drying output saved and synced to Decortication.')
    setShowDryingRecords(true)
  }

  return (
    <section className="panel">
      <h2>Drying</h2>
      <p>
        Record weighed fibre bundles per decorticator shift. Total dried fibre and drying time are
        synced back to Decortication.
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
          <h3>Shifts Weighed</h3>
          <p>{filteredDryingRecords.length}</p>
        </article>
        <article className="card">
          <h3>Total Dried Fibre</h3>
          <p>{totalDriedKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average Dried kg per Day</h3>
          <p>{averageKgPerDay.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average Drying Time</h3>
          <p>{averageDryingTimeDays} days</p>
        </article>
      </div>

      <CollapsibleSection
        title="Record Drying Output"
        isOpen={showDryingEntry}
        onToggle={() => setShowDryingEntry((prev) => !prev)}
        canExpand={canManageDrying}
        deniedMessage="Only Admin, Production Manager, or Dryer can open this section."
      >
        <form className="form-grid" onSubmit={handleSubmitDryingEntry}>
          <label>
            Decorticator Shift
            <select
              value={selectedDecorticationRecordId}
              onChange={(event) => setSelectedDecorticationRecordId(event.target.value)}
              disabled={!canSubmitDryingEntry}
            >
              <option value="">Select shift</option>
              {availableShiftOptions.map((record) => (
                <option key={record.id} value={record.id}>
                  {formatDisplayDate(record.date)} | {record.machine} | Shift {record.shiftNumber} | Batch{' '}
                  {normalizeBatchNumber(record.batchNumber)} | {buildTraceabilityCode(record.batchNumber, record.machine)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Weighing Date
            <input
              type="date"
              value={weighedDate}
              onChange={(event) => setWeighedDate(event.target.value)}
              disabled={!canSubmitDryingEntry}
            />
          </label>
          <label>
            Bundle Weight (kg)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={currentBundleWeight}
              onChange={(event) => setCurrentBundleWeight(event.target.value)}
              placeholder="10.0"
              disabled={!canSubmitDryingEntry}
            />
          </label>
          <button type="button" onClick={handleAddBundleWeight} disabled={!canSubmitDryingEntry}>
            Add Another Bundle
          </button>
          <button type="submit" disabled={!canSubmitDryingEntry}>
            Complete
          </button>
        </form>
        <div className="placeholder">
          Bundles added: {pendingBundleWeights.length}
          {pendingBundleWeights.length > 0
            ? ` | Total so far: ${pendingBundleWeights.reduce((sum, weight) => sum + weight, 0).toFixed(1)} kg`
            : ''}
        </div>
        {!canSubmitDryingEntry && (
          <div className="placeholder">
            A Dryer must be clocked in to record drying output. Managers and Admin can always record.
          </div>
        )}
        {entryStatus && <div className="placeholder">{entryStatus}</div>}
      </CollapsibleSection>

      <CollapsibleSection
        title="Drying Records"
        isOpen={showDryingRecords}
        onToggle={() => setShowDryingRecords((prev) => !prev)}
        canExpand={canViewDrying}
        deniedMessage="Only Admin, Production Manager, Decortication Supervisor, or Dryer can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Weighed Date</th>
                <th>Decortication Date</th>
                <th>Machine</th>
                <th>Shift</th>
                <th>Batch</th>
                <th>Traceability Code</th>
                <th>Bundles</th>
                <th>Dried Fibre (kg)</th>
                <th>Drying Time (days)</th>
              </tr>
            </thead>
            <tbody>
              {sortedDryingRecords.map((record) => (
                <tr key={record.id}>
                  <td>{formatDisplayDate(record.weighedDate)}</td>
                  <td>{formatDisplayDate(record.decorticationDate)}</td>
                  <td>{record.machine}</td>
                  <td>{record.shiftNumber}</td>
                  <td>{normalizeBatchNumber(record.batchNumber)}</td>
                  <td>{buildTraceabilityCode(record.batchNumber, record.machine)}</td>
                  <td>{record.bundleWeights.length}</td>
                  <td>{record.totalDriedKg}</td>
                  <td>{record.dryingTimeDays}</td>
                </tr>
              ))}
              {sortedDryingRecords.length === 0 && (
                <tr>
                  <td colSpan="9">No drying records found for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Employee Attendance Summary"
        isOpen={showAttendanceSummary}
        onToggle={() => setShowAttendanceSummary((prev) => !prev)}
        canExpand={canViewDrying}
        deniedMessage="Only Admin, Production Manager, Decortication Supervisor, or Dryer can open this section."
      >
        <div className="placeholder">
          Clocked-in Dryers today: {activeDryers.length > 0 ? activeDryers.map((item) => item.name).join(', ') : 'None'}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Days Worked</th>
                <th>Shifts Weighed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employeeAttendance.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.name}</td>
                    <td>{row.role}</td>
                    <td>{row.daysWorked}</td>
                    <td>{row.shiftsHandled}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setAttendanceViewingEmployeeId((prev) => (prev === row.id ? '' : row.id))
                        }
                      >
                        {attendanceViewingEmployeeId === row.id ? 'Hide Record' : 'View Record'}
                      </button>
                    </td>
                  </tr>
                  {attendanceViewingEmployeeId === row.id && (
                    <tr>
                      <td colSpan="5">
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Weighed Date</th>
                                <th>Decortication Date</th>
                                <th>Machine</th>
                                <th>Shift</th>
                                <th>Batch</th>
                                <th>Traceability Code</th>
                                <th>Dried Fibre (kg)</th>
                                <th>Drying Time (days)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedDryingRecords
                                .filter((record) => record.dryerId === row.id)
                                .map((record) => (
                                  <tr key={`${row.id}-${record.id}`}>
                                    <td>{formatDisplayDate(record.weighedDate)}</td>
                                    <td>{formatDisplayDate(record.decorticationDate)}</td>
                                    <td>{record.machine}</td>
                                    <td>{record.shiftNumber}</td>
                                    <td>{normalizeBatchNumber(record.batchNumber)}</td>
                                    <td>{buildTraceabilityCode(record.batchNumber, record.machine)}</td>
                                    <td>{record.totalDriedKg}</td>
                                    <td>{record.dryingTimeDays}</td>
                                  </tr>
                                ))}
                              {selectedAttendanceEmployee && selectedAttendanceEmployee.id === row.id && !sortedDryingRecords.some((record) => record.dryerId === row.id) && (
                                <tr>
                                  <td colSpan="8">No drying attendance records found for this employee in the current filter.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {employeeAttendance.length === 0 && (
                <tr>
                  <td colSpan="5">No drying attendance records for this date range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </section>
  )
}

function BrushingPage({
  currentUser,
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  dryingRecords,
  brushingStockMovements,
  brushingDailyRecords,
  onAddBrushingStockMovement,
  onAddBrushingDailyRecord,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const [showStockMovementEntry, setShowStockMovementEntry] = useState(false)
  const [showDailyOutputEntry, setShowDailyOutputEntry] = useState(false)
  const [showDailySummary, setShowDailySummary] = useState(false)
  const [showAttendanceSummary, setShowAttendanceSummary] = useState(false)
  const [movementDate, setMovementDate] = useState(dateTo)
  const [movementStockCode, setMovementStockCode] = useState('')
  const [movementType, setMovementType] = useState('issue')
  const [movementKg, setMovementKg] = useState('')
  const [outputDate, setOutputDate] = useState(dateTo)
  const [outputStockCode, setOutputStockCode] = useState('')
  const [brsKgInput, setBrsKgInput] = useState('')
  const [towKgInput, setTowKgInput] = useState('')
  const [selectedSupervisorIds, setSelectedSupervisorIds] = useState([])
  const [selectedBrusherIds, setSelectedBrusherIds] = useState([])
  const [entryStatus, setEntryStatus] = useState('')
  const [attendanceViewingEmployeeId, setAttendanceViewingEmployeeId] = useState('')

  const canManageBrushing = currentUserDataEntryPermissions.has('brushing-entry')
  const canViewBrushing = canManageBrushing || currentUser?.role === 'brusher'

  const clockedInBrushingSupervisors = employees.filter(
    (employee) =>
      employee.role === 'brushing-supervisor' && clockedInIds.includes(employee.id),
  )
  const clockedInBrushers = employees.filter(
    (employee) => employee.role === 'brusher' && clockedInIds.includes(employee.id),
  )
  const availableUbrStockCodes = useMemo(
    () =>
      Array.from(
        new Set(
          dryingRecords
            .filter((record) =>
              selectedBatchFilter === 'all'
                ? true
                : normalizeBatchNumber(record.batchNumber) === selectedBatchFilter,
            )
            .map((record) => buildStockCode(record.batchNumber, record.machine, 'UBR')),
        ),
      ).sort(),
    [dryingRecords, selectedBatchFilter],
  )

  const filteredMovements =
    selectedBatchFilter === 'all'
      ? brushingStockMovements.filter((item) => item.date >= dateFrom && item.date <= dateTo)
      : brushingStockMovements.filter(
          (item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter,
        )
  const sortedMovements = [...filteredMovements].sort((a, b) => b.date.localeCompare(a.date))

  const filteredDailyRecords =
    selectedBatchFilter === 'all'
      ? brushingDailyRecords.filter((item) => item.date >= dateFrom && item.date <= dateTo)
      : brushingDailyRecords.filter(
          (item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter,
        )
  const sortedDailyRecords = [...filteredDailyRecords].sort((a, b) => b.date.localeCompare(a.date))

  const totalUbrUsedKg = filteredDailyRecords.reduce((sum, item) => sum + item.ubrUsedKg, 0)
  const totalBrsKg = filteredDailyRecords.reduce((sum, item) => sum + item.brsKg, 0)
  const totalTowKg = filteredDailyRecords.reduce((sum, item) => sum + item.towKg, 0)
  const averageEfficiency =
    filteredDailyRecords.length > 0
      ? Number(
          (
            filteredDailyRecords.reduce((sum, item) => sum + item.efficiency, 0) /
            filteredDailyRecords.length
          ).toFixed(3),
        )
      : 0
  const uniqueDays = new Set(filteredDailyRecords.map((item) => item.date)).size
  const avgBrsPerDay = uniqueDays > 0 ? Number((totalBrsKg / uniqueDays).toFixed(1)) : 0

  const attendanceRows = Object.values(
    filteredDailyRecords.reduce((map, record) => {
      record.supervisorIds.forEach((id, index) => {
        if (!map[id]) {
          map[id] = {
            id,
            name: record.supervisorNames[index] ?? id,
            role: 'Brushing Supervisor',
            dates: new Set(),
            shifts: 0,
          }
        }
        map[id].dates.add(record.date)
        map[id].shifts += 1
      })
      record.brusherIds.forEach((id, index) => {
        if (!map[id]) {
          map[id] = {
            id,
            name: record.brusherNames[index] ?? id,
            role: 'Brusher',
            dates: new Set(),
            shifts: 0,
          }
        }
        map[id].dates.add(record.date)
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
      shiftsWorked: item.shifts,
    }))
    .sort((a, b) => b.daysWorked - a.daysWorked)

  function calculateUbrUsedForDayStockCode(date, sourceStockCode) {
    return Number(
      brushingStockMovements
        .filter((item) => item.date === date && item.sourceStockCode === sourceStockCode)
        .reduce((sum, item) => sum + (item.type === 'issue' ? item.quantityKg : -item.quantityKg), 0)
        .toFixed(1),
    )
  }

  function handleSupervisorToggle(employeeId) {
    setSelectedSupervisorIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
    )
  }

  function handleBrusherToggle(employeeId) {
    setSelectedBrusherIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
    )
  }

  function handleAddStockMovement(event) {
    event.preventDefault()
    if (!canManageBrushing) {
      setEntryStatus('Only Admin, Production Manager, or Brushing Supervisor can record stock movement.')
      return
    }
    const quantityKg = Number(movementKg)
    if (!movementDate || !movementStockCode || Number.isNaN(quantityKg) || quantityKg <= 0) {
      setEntryStatus('Enter valid date, UBR stock code, and quantity for stock movement.')
      return
    }
    const movementBatch = movementStockCode.split('-').slice(0, 2).join('-')
    onAddBrushingStockMovement({
      date: movementDate,
      batchNumber: normalizeBatchNumber(movementBatch),
      sourceStockCode: movementStockCode,
      machine: getMachineFromStockCode(movementStockCode),
      type: movementType,
      quantityKg: Number(quantityKg.toFixed(1)),
      recordedById: currentUser?.id ?? 'SYSTEM',
      recordedByName: currentUser?.name ?? 'System',
    })
    setMovementKg('')
    setEntryStatus('Brushing stock movement saved.')
  }

  function handleAddDailyOutput(event) {
    event.preventDefault()
    if (!canManageBrushing) {
      setEntryStatus('Only Admin, Production Manager, or Brushing Supervisor can record daily output.')
      return
    }
    const brsKg = Number(brsKgInput)
    const towKg = Number(towKgInput)
    if (!outputDate || !outputStockCode || Number.isNaN(brsKg) || Number.isNaN(towKg) || brsKg < 0 || towKg < 0) {
      setEntryStatus('Enter valid date, UBR stock code, and non-negative BRS/TOW quantities.')
      return
    }
    if (selectedSupervisorIds.length === 0 || selectedBrusherIds.length === 0) {
      setEntryStatus('Select at least one brushing supervisor and one brusher.')
      return
    }
    const ubrUsedKg = calculateUbrUsedForDayStockCode(outputDate, outputStockCode)
    if (ubrUsedKg <= 0) {
      setEntryStatus('Record UBR stock issue first before logging output for this day and stock code.')
      return
    }
    const outputBatch = outputStockCode.split('-').slice(0, 2).join('-')
    const efficiency = Number((brsKg / ubrUsedKg).toFixed(3))
    const dustLossKg = Number((ubrUsedKg - (brsKg + towKg)).toFixed(1))
    onAddBrushingDailyRecord({
      date: outputDate,
      batchNumber: normalizeBatchNumber(outputBatch),
      sourceStockCode: outputStockCode,
      machine: getMachineFromStockCode(outputStockCode),
      supervisorIds: selectedSupervisorIds,
      supervisorNames: selectedSupervisorIds
        .map((id) => employees.find((employee) => employee.id === id)?.name)
        .filter(Boolean),
      brusherIds: selectedBrusherIds,
      brusherNames: selectedBrusherIds
        .map((id) => employees.find((employee) => employee.id === id)?.name)
        .filter(Boolean),
      ubrUsedKg,
      brsKg: Number(brsKg.toFixed(1)),
      towKg: Number(towKg.toFixed(1)),
      efficiency,
      dustLossKg,
    })
    setBrsKgInput('')
    setTowKgInput('')
    setSelectedSupervisorIds([])
    setSelectedBrusherIds([])
    setEntryStatus('Brushing daily output saved and stock updated for BRS/TOW.')
    setShowDailySummary(true)
  }

  return (
    <section className="panel">
      <h2>Brushing</h2>
      <p>
        Track UBR stock usage and returns during brushing, then record daily BRS/TOW output and
        efficiency.
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
          <h3>Brushing Days</h3>
          <p>{uniqueDays}</p>
        </article>
        <article className="card">
          <h3>UBR Used</h3>
          <p>{totalUbrUsedKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>BRS Produced</h3>
          <p>{totalBrsKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>TOW Produced</h3>
          <p>{totalTowKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Avg BRS per Day</h3>
          <p>{avgBrsPerDay.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average Brushing Efficiency</h3>
          <p>{averageEfficiency}</p>
        </article>
      </div>

      <CollapsibleSection
        title="UBR Stock Movement"
        isOpen={showStockMovementEntry}
        onToggle={() => setShowStockMovementEntry((prev) => !prev)}
        canExpand={canManageBrushing}
        deniedMessage="Only Admin, Production Manager, or Brushing Supervisor can open this section."
      >
        <form className="form-grid" onSubmit={handleAddStockMovement}>
          <label>
            Date
            <input
              type="date"
              value={movementDate}
              onChange={(event) => setMovementDate(event.target.value)}
              disabled={!canManageBrushing}
            />
          </label>
          <label>
            UBR Stock Code
            <select
              value={movementStockCode}
              onChange={(event) => setMovementStockCode(event.target.value)}
              disabled={!canManageBrushing}
            >
              <option value="">Select UBR stock code</option>
              {availableUbrStockCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Movement Type
            <select
              value={movementType}
              onChange={(event) => setMovementType(event.target.value)}
              disabled={!canManageBrushing}
            >
              <option value="issue">Issue to Brushing Line</option>
              <option value="return">Return to Store</option>
            </select>
          </label>
          <label>
            Quantity (kg)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={movementKg}
              onChange={(event) => setMovementKg(event.target.value)}
              disabled={!canManageBrushing}
            />
          </label>
          <button type="submit" disabled={!canManageBrushing}>
            Save Movement
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>UBR Stock Code</th>
                <th>Type</th>
                <th>Quantity (kg)</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {sortedMovements.map((item) => (
                <tr key={item.id}>
                  <td>{formatDisplayDate(item.date)}</td>
                  <td>{item.sourceStockCode}</td>
                  <td>{item.type === 'issue' ? 'Issue' : 'Return'}</td>
                  <td>{item.quantityKg}</td>
                  <td>{item.recordedByName}</td>
                </tr>
              ))}
              {sortedMovements.length === 0 && (
                <tr>
                  <td colSpan="5">No brushing stock movements for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Record Daily Output"
        isOpen={showDailyOutputEntry}
        onToggle={() => setShowDailyOutputEntry((prev) => !prev)}
        canExpand={canManageBrushing}
        deniedMessage="Only Admin, Production Manager, or Brushing Supervisor can open this section."
      >
        <form className="form-grid" onSubmit={handleAddDailyOutput}>
          <label>
            Date
            <input
              type="date"
              value={outputDate}
              onChange={(event) => setOutputDate(event.target.value)}
              disabled={!canManageBrushing}
            />
          </label>
          <label>
            UBR Stock Code
            <select
              value={outputStockCode}
              onChange={(event) => setOutputStockCode(event.target.value)}
              disabled={!canManageBrushing}
            >
              <option value="">Select UBR stock code</option>
              {availableUbrStockCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            BRS Produced (kg)
            <input
              type="number"
              min="0"
              step="0.1"
              value={brsKgInput}
              onChange={(event) => setBrsKgInput(event.target.value)}
              disabled={!canManageBrushing}
            />
          </label>
          <label>
            TOW Produced (kg)
            <input
              type="number"
              min="0"
              step="0.1"
              value={towKgInput}
              onChange={(event) => setTowKgInput(event.target.value)}
              disabled={!canManageBrushing}
            />
          </label>
          <label>
            Brushing Supervisors (clocked in)
            <div className="checklist">
              {clockedInBrushingSupervisors.map((person) => (
                <label key={person.id} className="check-item">
                  <span>{person.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedSupervisorIds.includes(person.id)}
                    onChange={() => handleSupervisorToggle(person.id)}
                    disabled={!canManageBrushing}
                  />
                </label>
              ))}
            </div>
          </label>
          <label>
            Brushers (clocked in)
            <div className="checklist">
              {clockedInBrushers.map((person) => (
                <label key={person.id} className="check-item">
                  <span>{person.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedBrusherIds.includes(person.id)}
                    onChange={() => handleBrusherToggle(person.id)}
                    disabled={!canManageBrushing}
                  />
                </label>
              ))}
            </div>
          </label>
          <button type="submit" disabled={!canManageBrushing}>
            Save Daily Output
          </button>
        </form>
      </CollapsibleSection>

      {entryStatus && <div className="placeholder">{entryStatus}</div>}

      <CollapsibleSection
        title="Daily Brushing Summary"
        isOpen={showDailySummary}
        onToggle={() => setShowDailySummary((prev) => !prev)}
        canExpand={canViewBrushing}
        deniedMessage="Only Admin, Production Manager, Brushing Supervisor, or Brusher can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Batch</th>
                <th>UBR Stock Code</th>
                <th>Brushers</th>
                <th>Supervisors</th>
                <th>UBR Used (kg)</th>
                <th>BRS Produced (kg)</th>
                <th>TOW Produced (kg)</th>
                <th>Dust Loss (kg)</th>
                <th>Efficiency (BRS/UBR)</th>
              </tr>
            </thead>
            <tbody>
              {sortedDailyRecords.map((item) => (
                <tr key={item.id}>
                  <td>{formatDisplayDate(item.date)}</td>
                  <td>{normalizeBatchNumber(item.batchNumber)}</td>
                  <td>{item.sourceStockCode}</td>
                  <td>{item.brusherIds.length}</td>
                  <td>{item.supervisorIds.length}</td>
                  <td>{item.ubrUsedKg}</td>
                  <td>{item.brsKg}</td>
                  <td>{item.towKg}</td>
                  <td>{item.dustLossKg}</td>
                  <td>{item.efficiency}</td>
                </tr>
              ))}
              {sortedDailyRecords.length === 0 && (
                <tr>
                  <td colSpan="10">No brushing daily records found for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Employee Attendance Summary"
        isOpen={showAttendanceSummary}
        onToggle={() => setShowAttendanceSummary((prev) => !prev)}
        canExpand={canViewBrushing}
        deniedMessage="Only Admin, Production Manager, Brushing Supervisor, or Brusher can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Days Worked</th>
                <th>Shifts Worked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.name}</td>
                    <td>{row.role}</td>
                    <td>{row.daysWorked}</td>
                    <td>{row.shiftsWorked}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setAttendanceViewingEmployeeId((prev) => (prev === row.id ? '' : row.id))
                        }
                      >
                        {attendanceViewingEmployeeId === row.id ? 'Hide Record' : 'View Record'}
                      </button>
                    </td>
                  </tr>
                  {attendanceViewingEmployeeId === row.id && (
                    <tr>
                      <td colSpan="5">
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Batch</th>
                                <th>UBR Stock Code</th>
                                <th>Role In Shift</th>
                                <th>UBR Used (kg)</th>
                                <th>BRS (kg)</th>
                                <th>TOW (kg)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedDailyRecords
                                .filter(
                                  (item) =>
                                    item.supervisorIds.includes(row.id) || item.brusherIds.includes(row.id),
                                )
                                .map((item) => (
                                  <tr key={`${row.id}-${item.id}`}>
                                    <td>{formatDisplayDate(item.date)}</td>
                                    <td>{normalizeBatchNumber(item.batchNumber)}</td>
                                    <td>{item.sourceStockCode}</td>
                                    <td>
                                      {item.supervisorIds.includes(row.id) ? 'Supervisor' : 'Brusher'}
                                    </td>
                                    <td>{item.ubrUsedKg}</td>
                                    <td>{item.brsKg}</td>
                                    <td>{item.towKg}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {attendanceRows.length === 0 && (
                <tr>
                  <td colSpan="5">No brushing attendance records found for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </section>
  )
}

function BaleLabel({ baleCode, baleWeightKg }) {
  const bits = buildBarcodeBits(baleCode)
  const barWidth = 2
  const height = 72
  return (
    <div className="placeholder">
      <strong>Bale Label</strong>
      <div>Code: {baleCode}</div>
      <div>Weight: {baleWeightKg} kg</div>
      <svg width={bits.length * barWidth} height={height} role="img" aria-label={`Barcode ${baleCode}`}>
        {bits.split('').map((bit, index) =>
          bit === '1' ? (
            <rect
              key={`${baleCode}-${index}`}
              x={index * barWidth}
              y="0"
              width={barWidth}
              height={height}
              fill="#000"
            />
          ) : null,
        )}
      </svg>
    </div>
  )
}

function BalingPage({
  currentUser,
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  availableLooseStockOptions,
  balingRecords,
  onCreateBales,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const [showBaleEntry, setShowBaleEntry] = useState(false)
  const [showBaleRecords, setShowBaleRecords] = useState(false)
  const [showAttendanceSummary, setShowAttendanceSummary] = useState(false)
  const [balingDate, setBalingDate] = useState(dateTo)
  const [sourceStockCode, setSourceStockCode] = useState('')
  const [baleWeightKg, setBaleWeightKg] = useState('100')
  const [baleCount, setBaleCount] = useState('1')
  const [selectedBalerIds, setSelectedBalerIds] = useState([])
  const [entryStatus, setEntryStatus] = useState('')
  const [lastCreatedBaleCode, setLastCreatedBaleCode] = useState('')
  const [attendanceViewingEmployeeId, setAttendanceViewingEmployeeId] = useState('')
  const [selectedBaleIds, setSelectedBaleIds] = useState([])

  const canManageBaling = currentUserDataEntryPermissions.has('baling-entry')
  const canViewBaling = canManageBaling || currentUser?.role === 'baler'

  const clockedInBalers = employees.filter(
    (employee) => employee.role === 'baler' && clockedInIds.includes(employee.id),
  )

  const visibleLooseStockOptions =
    selectedBatchFilter === 'all'
      ? availableLooseStockOptions
      : availableLooseStockOptions.filter(
          (item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter,
        )
  const availableBaleSeriesFilters = useMemo(
    () => Array.from(new Set(balingRecords.map((record) => record.baleSeriesCode))).sort(),
    [balingRecords],
  )
  const filterOptions = useMemo(
    () => [...new Set([...availableBatches, ...availableBaleSeriesFilters])].sort(),
    [availableBatches, availableBaleSeriesFilters],
  )

  const filteredRecords =
    selectedBatchFilter === 'all'
      ? balingRecords.filter((record) => record.date >= dateFrom && record.date <= dateTo)
      : balingRecords.filter((record) =>
          selectedBatchFilter.includes('-BRS-') ||
          selectedBatchFilter.includes('-TOW-') ||
          selectedBatchFilter.includes('-UBR-')
            ? record.baleSeriesCode === selectedBatchFilter
            : normalizeBatchNumber(record.batchNumber) === selectedBatchFilter,
        )
  const sortedRecords = [...filteredRecords].sort((a, b) =>
    a.date === b.date ? b.baleCode.localeCompare(a.baleCode) : b.date.localeCompare(a.date),
  )

  const totalBales = sortedRecords.length
  const totalBaledKg = sortedRecords.reduce((sum, record) => sum + record.baleWeightKg, 0)

  const attendanceRows = Object.values(
    filteredRecords.reduce((map, record) => {
      record.supervisorIds.forEach((id, index) => {
        if (!map[id]) {
          map[id] = { id, name: record.supervisorNames[index] ?? id, role: 'Baling Supervisor', dates: new Set(), bales: 0 }
        }
        map[id].dates.add(record.date)
        map[id].bales += 1
      })
      record.balerIds.forEach((id, index) => {
        if (!map[id]) {
          map[id] = { id, name: record.balerNames[index] ?? id, role: 'Baler', dates: new Set(), bales: 0 }
        }
        map[id].dates.add(record.date)
        map[id].bales += 1
      })
      return map
    }, {}),
  )
    .map((item) => ({ id: item.id, name: item.name, role: item.role, daysWorked: item.dates.size, balesHandled: item.bales }))
    .sort((a, b) => b.balesHandled - a.balesHandled)

  function handleBalerToggle(employeeId) {
    setSelectedBalerIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
    )
  }

  function handleCreateBales(event) {
    event.preventDefault()
    if (!canManageBaling) {
      setEntryStatus('You do not have permission to create bales.')
      return
    }
    if (!clockedInIds.includes(currentUser.id)) {
      setEntryStatus('You must be clocked in before creating bales.')
      return
    }
    const weight = Number(baleWeightKg)
    const count = Number(baleCount)
    if (!balingDate || !sourceStockCode || Number.isNaN(weight) || Number.isNaN(count) || weight <= 0 || count <= 0) {
      setEntryStatus('Enter a valid date, source stock code, bale weight, and bale count.')
      return
    }
    if (selectedBalerIds.length === 0) {
      setEntryStatus('Select at least one baler assisting with this bale.')
      return
    }
    const sourceBatchNumber = sourceStockCode.split('-').slice(0, 2).join('-')
    const seriesCode = buildBaleSeriesCode(sourceStockCode, weight)
    const existingSerials = balingRecords
      .filter((record) => record.baleSeriesCode === seriesCode)
      .map((record) => Number(record.baleCode.split('-').slice(-1)[0]))
      .filter((value) => !Number.isNaN(value))
    let nextSerial = existingSerials.length > 0 ? Math.max(...existingSerials) + 1 : 1
    const nextRecords = Array.from({ length: count }, () => {
      const baleCode = buildBaleCode(sourceStockCode, weight, nextSerial)
      nextSerial += 1
      return {
        date: balingDate,
        batchNumber: normalizeBatchNumber(sourceBatchNumber),
        machine: getMachineFromStockCode(sourceStockCode),
        sourceStockCode,
        baleWeightKg: Number(weight.toFixed(1)),
        baleSeriesCode: seriesCode,
        baleCode,
        supervisorIds: [currentUser.id],
        supervisorNames: [currentUser.name],
        balerIds: selectedBalerIds,
        balerNames: selectedBalerIds
          .map((id) => employees.find((employee) => employee.id === id)?.name)
          .filter(Boolean),
      }
    })
    onCreateBales(nextRecords)
    setLastCreatedBaleCode(nextRecords[nextRecords.length - 1]?.baleCode ?? '')
    setEntryStatus(`${nextRecords.length} bale(s) created successfully by ${currentUser.name}.`)
    setShowBaleRecords(true)
  }

  function handleToggleBaleSelection(baleId) {
    setSelectedBaleIds((prev) =>
      prev.includes(baleId) ? prev.filter((id) => id !== baleId) : [...prev, baleId],
    )
  }

  function handlePrintSelectedLabels() {
    const selectedRecords = sortedRecords.filter((record) => selectedBaleIds.includes(record.id))
    if (selectedRecords.length === 0) {
      setEntryStatus('Select at least one bale before printing labels.')
      return
    }
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const marginX = 10
    const marginY = 10
    const gapX = 6
    const gapY = 6
    const columns = 2
    const labelWidth = (pageWidth - marginX * 2 - gapX) / columns
    const labelHeight = 52
    const rowsPerPage = Math.floor((pageHeight - marginY * 2 + gapY) / (labelHeight + gapY))
    const maxPerPage = rowsPerPage * columns

    selectedRecords.forEach((record, index) => {
      if (index > 0 && index % maxPerPage === 0) {
        pdf.addPage()
      }
      const pageIndex = index % maxPerPage
      const row = Math.floor(pageIndex / columns)
      const col = pageIndex % columns
      const labelX = marginX + col * (labelWidth + gapX)
      const labelY = marginY + row * (labelHeight + gapY)

      pdf.setDrawColor(0)
      pdf.setLineWidth(0.6)
      pdf.rect(labelX, labelY, labelWidth, labelHeight)

      const bits = buildBarcodeBits(record.baleCode)
      const barcodeAreaWidth = labelWidth - 12
      const barcodeAreaHeight = 24
      const barWidth = barcodeAreaWidth / bits.length
      const barcodeStartX = labelX + 6
      const barcodeStartY = labelY + 10

      pdf.setFillColor(0, 0, 0)
      bits.split('').forEach((bit, bitIndex) => {
        if (bit === '1') {
          pdf.rect(
            barcodeStartX + bitIndex * barWidth,
            barcodeStartY,
            Math.max(0.2, barWidth),
            barcodeAreaHeight,
            'F',
          )
        }
      })

      pdf.setTextColor(0, 0, 0)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.text(record.baleCode, labelX + labelWidth / 2, labelY + 42, { align: 'center' })
    })

    pdf.save(`bale-labels-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <section className="panel">
      <h2>Baling</h2>
      <p>
        Convert brushed fibre stock into coded bales with barcode-ready bale labels and attendance
        tracking for baling teams.
      </p>

      <div className="form-grid">
        <label>
          Batch Filter
          <select
            value={selectedBatchFilter}
            onChange={(event) => onSelectedBatchFilterChange(event.target.value)}
          >
            <option value="all">Date filtered records</option>
            {filterOptions.map((option) => (
              <option key={option} value={option}>
                {option}
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
          <h3>Total Bales</h3>
          <p>{totalBales}</p>
        </article>
        <article className="card">
          <h3>Total Baled Fibre</h3>
          <p>{totalBaledKg.toLocaleString()} kg</p>
        </article>
      </div>

      <CollapsibleSection
        title="Create Bales"
        isOpen={showBaleEntry}
        onToggle={() => setShowBaleEntry((prev) => !prev)}
        canExpand={canManageBaling}
        deniedMessage="Only Admin, Production Manager, or Baling Supervisor can open this section."
      >
        <form className="form-grid" onSubmit={handleCreateBales}>
          <label>
            Date
            <input type="date" value={balingDate} onChange={(event) => setBalingDate(event.target.value)} />
          </label>
          <label>
            Source Loose Fibre Stock Code
            <select value={sourceStockCode} onChange={(event) => setSourceStockCode(event.target.value)}>
              <option value="">Select source stock code</option>
              {visibleLooseStockOptions.map((item) => (
                <option key={item.stockCode} value={item.stockCode}>
                  {item.stockCode} ({item.totalKg} kg available)
                </option>
              ))}
            </select>
          </label>
          <label>
            Bale Weight (kg)
            <input
              type="number"
              min="1"
              step="0.1"
              value={baleWeightKg}
              onChange={(event) => setBaleWeightKg(event.target.value)}
            />
          </label>
          <label>
            Number of Bales
            <input
              type="number"
              min="1"
              step="1"
              value={baleCount}
              onChange={(event) => setBaleCount(event.target.value)}
            />
          </label>
          <label>
            Entered By (Supervisor)
            <input
              value={
                currentUser?.role === 'baling-supervisor'
                  ? `${currentUser.name} (${currentUser.id})`
                  : 'Only Baling Supervisor can create bales'
              }
              disabled
            />
          </label>
          <label>
            Balers (clocked in)
            <div className="checklist">
              {clockedInBalers.map((person) => (
                <label key={person.id} className="check-item">
                  <span>{person.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedBalerIds.includes(person.id)}
                    onChange={() => handleBalerToggle(person.id)}
                  />
                </label>
              ))}
            </div>
          </label>
          <button type="submit">Create Bale(s)</button>
        </form>
        {entryStatus && <div className="placeholder">{entryStatus}</div>}
        {lastCreatedBaleCode && <BaleLabel baleCode={lastCreatedBaleCode} baleWeightKg={Number(baleWeightKg) || 0} />}
      </CollapsibleSection>

      <CollapsibleSection
        title="Bale Records"
        isOpen={showBaleRecords}
        onToggle={() => setShowBaleRecords((prev) => !prev)}
        canExpand={canViewBaling}
        deniedMessage="Only Admin, Production Manager, Baling Supervisor, or Baler can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Batch</th>
                <th>Source Stock Code</th>
                <th>Bale Code</th>
                <th>Weight (kg)</th>
                <th>Supervisors</th>
                <th>Balers</th>
                <th>
                  <button type="button" onClick={handlePrintSelectedLabels} disabled={selectedBaleIds.length === 0}>
                    Print Labels
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.map((record) => (
                <tr key={record.id}>
                  <td>{formatDisplayDate(record.date)}</td>
                  <td>{normalizeBatchNumber(record.batchNumber)}</td>
                  <td>{record.sourceStockCode}</td>
                  <td>{record.baleCode}</td>
                  <td>{record.baleWeightKg}</td>
                  <td>{record.supervisorIds.length}</td>
                  <td>{record.balerIds.length}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedBaleIds.includes(record.id)}
                      onChange={() => handleToggleBaleSelection(record.id)}
                      aria-label={`Select ${record.baleCode}`}
                    />
                  </td>
                </tr>
              ))}
              {sortedRecords.length === 0 && (
                <tr>
                  <td colSpan="8">No baling records found for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Employee Attendance Summary"
        isOpen={showAttendanceSummary}
        onToggle={() => setShowAttendanceSummary((prev) => !prev)}
        canExpand={canViewBaling}
        deniedMessage="Only Admin, Production Manager, Baling Supervisor, or Baler can open this section."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Days Worked</th>
                <th>Bales Handled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.name}</td>
                    <td>{row.role}</td>
                    <td>{row.daysWorked}</td>
                    <td>{row.balesHandled}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setAttendanceViewingEmployeeId((prev) => (prev === row.id ? '' : row.id))
                        }
                      >
                        {attendanceViewingEmployeeId === row.id ? 'Hide Record' : 'View Record'}
                      </button>
                    </td>
                  </tr>
                  {attendanceViewingEmployeeId === row.id && (
                    <tr>
                      <td colSpan="5">
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Bale Code</th>
                                <th>Source Stock</th>
                                <th>Role In Shift</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedRecords
                                .filter(
                                  (record) =>
                                    record.supervisorIds.includes(row.id) || record.balerIds.includes(row.id),
                                )
                                .map((record) => (
                                  <tr key={`${row.id}-${record.id}`}>
                                    <td>{formatDisplayDate(record.date)}</td>
                                    <td>{record.baleCode}</td>
                                    <td>{record.sourceStockCode}</td>
                                    <td>
                                      {record.supervisorIds.includes(row.id) ? 'Supervisor' : 'Baler'}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {attendanceRows.length === 0 && (
                <tr>
                  <td colSpan="5">No baling attendance records found for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </section>
  )
}

function SilageProductionPage({
  currentUser,
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  silageRecords,
  onCreateSilageStock,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const [showCreateStock, setShowCreateStock] = useState(false)
  const [showAttendanceRecords, setShowAttendanceRecords] = useState(false)
  const [showBagRecords, setShowBagRecords] = useState(false)
  const [entryStatus, setEntryStatus] = useState('')
  const [silageLabelStatus, setSilageLabelStatus] = useState('')
  const [silageDate, setSilageDate] = useState(dateTo)
  const [batchNumber, setBatchNumber] = useState(availableBatches[0] ?? '')
  const [bagMassKg, setBagMassKg] = useState('75')
  const [bagCount, setBagCount] = useState('')
  const [selectedSilageBagIds, setSelectedSilageBagIds] = useState([])

  const canManageSilage = currentUserDataEntryPermissions.has('silage-entry')

  const filteredSilageRecords =
    selectedBatchFilter === 'all'
      ? silageRecords.filter((record) => record.date >= dateFrom && record.date <= dateTo)
      : silageRecords.filter((record) => normalizeBatchNumber(record.batchNumber) === selectedBatchFilter)
  const sortedRecords = [...filteredSilageRecords].sort((a, b) =>
    a.date === b.date ? b.bagCode.localeCompare(a.bagCode) : b.date.localeCompare(a.date),
  )
  const totalBags = sortedRecords.length
  const totalSilageKg = sortedRecords.reduce((sum, record) => sum + record.massKg, 0)
  const averageBagMassKg = totalBags > 0 ? Number((totalSilageKg / totalBags).toFixed(1)) : 0

  const silageAttendanceRows = Object.values(
    sortedRecords.reduce((map, record) => {
      if (!map[record.supervisorId]) {
        map[record.supervisorId] = {
          id: record.supervisorId,
          name: record.supervisorName,
          role: 'Silage Supervisor',
          dates: new Set(),
          bagsHandled: 0,
        }
      }
      map[record.supervisorId].dates.add(record.date)
      map[record.supervisorId].bagsHandled += 1

      record.operatorIds.forEach((operatorId, index) => {
        if (!map[operatorId]) {
          map[operatorId] = {
            id: operatorId,
            name: record.operatorNames[index] ?? operatorId,
            role: 'Silage Operator',
            dates: new Set(),
            bagsHandled: 0,
          }
        }
        map[operatorId].dates.add(record.date)
        map[operatorId].bagsHandled += 1
      })
      return map
    }, {}),
  )
    .map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      daysWorked: item.dates.size,
      bagsHandled: item.bagsHandled,
      isClockedIn: clockedInIds.includes(item.id),
    }))
    .sort((a, b) => b.bagsHandled - a.bagsHandled)

  function handleCreateSilageBags(event) {
    event.preventDefault()
    if (!canManageSilage) {
      setEntryStatus('You do not have permission to create silage stock.')
      return
    }
    if (!clockedInIds.includes(currentUser.id)) {
      setEntryStatus('You must be clocked in before creating stock.')
      return
    }
    const mass = Number(bagMassKg)
    const count = Number(bagCount)
    if (!silageDate || !batchNumber || Number.isNaN(mass) || Number.isNaN(count) || mass <= 0 || count <= 0) {
      setEntryStatus('Enter a valid date, batch number, bag mass, and bag count.')
      return
    }
    const existingSerials = silageRecords
      .filter(
        (record) =>
          normalizeBatchNumber(record.batchNumber) === normalizeBatchNumber(batchNumber) &&
          record.date === silageDate &&
          Math.round(record.massKg) === Math.round(mass),
      )
      .map((record) => Number(String(record.bagCode).split('-').slice(-2)[0]))
      .filter((value) => !Number.isNaN(value))
    let nextSerial = existingSerials.length > 0 ? Math.max(...existingSerials) + 1 : 1
    const operatorIds = employees
      .filter(
        (employee) =>
          employee.role === 'silage-operator' && clockedInIds.includes(employee.id),
      )
      .map((employee) => employee.id)
    const operatorNames = operatorIds
      .map((id) => employees.find((employee) => employee.id === id)?.name)
      .filter(Boolean)
    const normalizedBatch = normalizeBatchNumber(batchNumber)
    const nextRecords = Array.from({ length: count }, () => {
      const bagCode = buildSilageBagCode(normalizedBatch, silageDate, mass, nextSerial)
      nextSerial += 1
      return {
        date: silageDate,
        batchNumber: normalizedBatch,
        massKg: Number(mass.toFixed(1)),
        bagCode,
        supervisorId: currentUser.id,
        supervisorName: currentUser.name,
        operatorIds,
        operatorNames,
      }
    })
    onCreateSilageStock(nextRecords)
    setEntryStatus(
      `${nextRecords.length} silage bag label(s) created successfully. Add another entry if a second bag size was produced today.`,
    )
    setBagCount('')
  }

  function handleToggleSilageLabelSelection(silageRecordId) {
    setSelectedSilageBagIds((prev) =>
      prev.includes(silageRecordId)
        ? prev.filter((id) => id !== silageRecordId)
        : [...prev, silageRecordId],
    )
  }

  function handlePrintSelectedSilageLabels() {
    const selectedRecords = sortedRecords.filter((record) => selectedSilageBagIds.includes(record.id))
    if (selectedRecords.length === 0) {
      setSilageLabelStatus('Select at least one silage bag before printing labels.')
      return
    }
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const marginX = 10
    const marginY = 10
    const gapX = 6
    const gapY = 6
    const columns = 2
    const labelWidth = (pageWidth - marginX * 2 - gapX) / columns
    const labelHeight = 52
    const rowsPerPage = Math.floor((pageHeight - marginY * 2 + gapY) / (labelHeight + gapY))
    const maxPerPage = rowsPerPage * columns

    selectedRecords.forEach((record, index) => {
      if (index > 0 && index % maxPerPage === 0) {
        pdf.addPage()
      }
      const pageIndex = index % maxPerPage
      const row = Math.floor(pageIndex / columns)
      const col = pageIndex % columns
      const labelX = marginX + col * (labelWidth + gapX)
      const labelY = marginY + row * (labelHeight + gapY)

      pdf.setDrawColor(0)
      pdf.setLineWidth(0.6)
      pdf.rect(labelX, labelY, labelWidth, labelHeight)

      const bits = buildBarcodeBits(record.bagCode)
      const barcodeAreaWidth = labelWidth - 12
      const barcodeAreaHeight = 24
      const barWidth = barcodeAreaWidth / bits.length
      const barcodeStartX = labelX + 6
      const barcodeStartY = labelY + 10

      pdf.setFillColor(0, 0, 0)
      bits.split('').forEach((bit, bitIndex) => {
        if (bit === '1') {
          pdf.rect(
            barcodeStartX + bitIndex * barWidth,
            barcodeStartY,
            Math.max(0.2, barWidth),
            barcodeAreaHeight,
            'F',
          )
        }
      })

      pdf.setTextColor(0, 0, 0)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.text(record.bagCode, labelX + labelWidth / 2, labelY + 42, { align: 'center' })
    })

    pdf.save(`silage-labels-${new Date().toISOString().slice(0, 10)}.pdf`)
    setSilageLabelStatus(`${selectedRecords.length} silage label(s) sent to print.`)
  }

  return (
    <section className="panel">
      <h2>Silage Production</h2>
      <p>
        Register silage bagging output after dewatering and sun-drying. Bag codes follow format:
        Batch-Date-Mass-BagNumber-SLG (e.g. 2025-006-042926-75-001-SLG).
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
          <h3>Total Silage Bags</h3>
          <p>{totalBags}</p>
        </article>
        <article className="card">
          <h3>Total Silage Stock</h3>
          <p>{totalSilageKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average Bag Mass</h3>
          <p>{averageBagMassKg.toLocaleString()} kg</p>
        </article>
      </div>

      <CollapsibleSection
        title="Create Silage Stock"
        isOpen={showCreateStock}
        onToggle={() => setShowCreateStock((prev) => !prev)}
        canExpand={canManageSilage}
        deniedMessage="Only Admin, Production Manager, or Silage Supervisor can open this section."
      >
        <form className="form-grid" onSubmit={handleCreateSilageBags}>
          <label>
            Date of Bagging
            <input type="date" value={silageDate} onChange={(event) => setSilageDate(event.target.value)} />
          </label>
          <label>
            Leaf Batch Number
            <select value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)}>
              <option value="">Select batch</option>
              {availableBatches.map((batch) => (
                <option key={batch} value={batch}>
                  {batch}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bag Mass (kg)
            <input
              type="number"
              min="1"
              step="0.1"
              value={bagMassKg}
              onChange={(event) => setBagMassKg(event.target.value)}
            />
          </label>
          <label>
            Number of Bags
            <input
              type="number"
              min="1"
              step="1"
              value={bagCount}
              onChange={(event) => setBagCount(event.target.value)}
              placeholder="e.g. 20"
            />
          </label>
          <label>
            Entered By (Silage Supervisor)
            <input
              value={
                currentUser?.role === 'silage-supervisor'
                  ? `${currentUser.name} (${currentUser.id})`
                  : 'Only Silage Supervisor can create silage stock'
              }
              disabled
            />
          </label>
          <button type="submit">Create Silage Stock</button>
        </form>
        <p className="helper-text">
          If two bag sizes are produced on the same day, save the first size, then submit a second
          entry for the other size.
        </p>
        {entryStatus && <div className="placeholder">{entryStatus}</div>}
      </CollapsibleSection>

      <CollapsibleSection
        title="Silage Attendance Records"
        isOpen={showAttendanceRecords}
        onToggle={() => setShowAttendanceRecords((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Attendance Status</th>
                <th>Days Worked</th>
                <th>Bags Handled</th>
              </tr>
            </thead>
            <tbody>
              {silageAttendanceRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.role}</td>
                  <td>{row.isClockedIn ? 'Present (Clocked In)' : 'Not Clocked In'}</td>
                  <td>{row.daysWorked}</td>
                  <td>{row.bagsHandled}</td>
                </tr>
              ))}
              {silageAttendanceRows.length === 0 && (
                <tr>
                  <td colSpan="5">No silage attendance records found for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Silage Bag Records"
        isOpen={showBagRecords}
        onToggle={() => setShowBagRecords((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Date</th>
                <th>Bag Code</th>
                <th>Batch</th>
                <th>Mass (kg)</th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedSilageBagIds.includes(record.id)}
                      onChange={() => handleToggleSilageLabelSelection(record.id)}
                    />
                  </td>
                  <td>{formatDisplayDate(record.date)}</td>
                  <td>{record.bagCode}</td>
                  <td>{record.batchNumber}</td>
                  <td>{record.massKg}</td>
                </tr>
              ))}
              {sortedRecords.length === 0 && (
                <tr>
                  <td colSpan="5">No silage bag records for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={handlePrintSelectedSilageLabels}>
          Print Selected Silage Labels
        </button>
        {silageLabelStatus && <div className="placeholder">{silageLabelStatus}</div>}
      </CollapsibleSection>
    </section>
  )
}

function StockPage({
  dryingRecords,
  brushingStockMovements,
  brushingDailyRecords,
  balingRecords,
  silageRecords,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const [showStockByCode, setShowStockByCode] = useState(false)
  const [showStockInwardMovements, setShowStockInwardMovements] = useState(false)
  const [showBaleInventory, setShowBaleInventory] = useState(false)
  const [showSilageInventory, setShowSilageInventory] = useState(false)
  const showAbsoluteStock = selectedBatchFilter === 'absolute'
  const filteredDryingRecords =
    showAbsoluteStock
      ? dryingRecords
      : selectedBatchFilter === 'all'
      ? dryingRecords.filter((record) => record.weighedDate >= dateFrom && record.weighedDate <= dateTo)
      : dryingRecords.filter(
          (record) => normalizeBatchNumber(record.batchNumber) === selectedBatchFilter,
        )
  const filteredBrushingMovements =
    showAbsoluteStock
      ? brushingStockMovements
      : selectedBatchFilter === 'all'
      ? brushingStockMovements.filter((item) => item.date >= dateFrom && item.date <= dateTo)
      : brushingStockMovements.filter(
          (item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter,
        )
  const filteredBrushingDailyRecords =
    showAbsoluteStock
      ? brushingDailyRecords
      : selectedBatchFilter === 'all'
      ? brushingDailyRecords.filter((item) => item.date >= dateFrom && item.date <= dateTo)
      : brushingDailyRecords.filter(
          (item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter,
        )
  const filteredBalingRecords =
    showAbsoluteStock
      ? balingRecords
      : selectedBatchFilter === 'all'
      ? balingRecords.filter((item) => item.date >= dateFrom && item.date <= dateTo)
      : balingRecords.filter((item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter)
  const filteredSilageRecords =
    showAbsoluteStock
      ? silageRecords
      : selectedBatchFilter === 'all'
      ? silageRecords.filter((item) => item.date >= dateFrom && item.date <= dateTo)
      : silageRecords.filter((item) => normalizeBatchNumber(item.batchNumber) === selectedBatchFilter)

  const stockMap = {}
  filteredDryingRecords.forEach((record) => {
    const code = buildStockCode(record.batchNumber, record.machine, 'UBR')
    if (!stockMap[code]) {
      stockMap[code] = { stockCode: code, batchNumber: normalizeBatchNumber(record.batchNumber), totalKg: 0, movements: 0 }
    }
    stockMap[code].totalKg += record.totalDriedKg
    stockMap[code].movements += 1
  })
  filteredBrushingMovements.forEach((item) => {
    const code = item.sourceStockCode
    if (!stockMap[code]) {
      stockMap[code] = { stockCode: code, batchNumber: normalizeBatchNumber(item.batchNumber), totalKg: 0, movements: 0 }
    }
    stockMap[code].totalKg += item.type === 'issue' ? -item.quantityKg : item.quantityKg
    stockMap[code].movements += 1
  })
  filteredBrushingDailyRecords.forEach((item) => {
    const traceabilityRoot = String(item.sourceStockCode ?? '').replace(/-UBR$/, '')
    const brsCode = `${traceabilityRoot}-BRS`
    const towCode = `${traceabilityRoot}-TOW`
    if (!stockMap[brsCode]) {
      stockMap[brsCode] = { stockCode: brsCode, batchNumber: normalizeBatchNumber(item.batchNumber), totalKg: 0, movements: 0 }
    }
    if (!stockMap[towCode]) {
      stockMap[towCode] = { stockCode: towCode, batchNumber: normalizeBatchNumber(item.batchNumber), totalKg: 0, movements: 0 }
    }
    stockMap[brsCode].totalKg += item.brsKg
    stockMap[brsCode].movements += 1
    stockMap[towCode].totalKg += item.towKg
    stockMap[towCode].movements += 1
  })
  filteredBalingRecords.forEach((item) => {
    const sourceCode = item.sourceStockCode
    if (!stockMap[sourceCode]) {
      stockMap[sourceCode] = {
        stockCode: sourceCode,
        batchNumber: normalizeBatchNumber(item.batchNumber),
        totalKg: 0,
        movements: 0,
      }
    }
    stockMap[sourceCode].totalKg -= item.baleWeightKg
    stockMap[sourceCode].movements += 1
  })

  const stockRows = Object.values(stockMap)
    .map((item) => ({ ...item, totalKg: Number(item.totalKg.toFixed(1)) }))
    .filter((item) => item.totalKg > 0)
    .sort((a, b) => b.totalKg - a.totalKg)
  const totalAvailableKg = Number(stockRows.reduce((sum, row) => sum + row.totalKg, 0).toFixed(1))

  const stockMovements = [...filteredDryingRecords]
    .map((record) => ({
      id: record.id,
      weighedDate: record.weighedDate,
      stockCode: buildStockCode(record.batchNumber, record.machine, 'UBR'),
      quantityKg: record.totalDriedKg,
      batchNumber: normalizeBatchNumber(record.batchNumber),
      machine: record.machine,
    }))
    .concat(
      filteredBrushingMovements.map((item) => ({
        id: item.id,
        weighedDate: item.date,
        stockCode: item.sourceStockCode,
        quantityKg: item.type === 'issue' ? -item.quantityKg : item.quantityKg,
        batchNumber: normalizeBatchNumber(item.batchNumber),
        machine: item.machine ?? getMachineFromStockCode(item.sourceStockCode),
      })),
    )
    .concat(
      filteredBrushingDailyRecords.flatMap((item) => [
        {
          id: `${item.id}-BRS`,
          weighedDate: item.date,
          stockCode: `${String(item.sourceStockCode ?? '').replace(/-UBR$/, '')}-BRS`,
          quantityKg: item.brsKg,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          machine: item.machine ?? getMachineFromStockCode(item.sourceStockCode),
        },
        {
          id: `${item.id}-TOW`,
          weighedDate: item.date,
          stockCode: `${String(item.sourceStockCode ?? '').replace(/-UBR$/, '')}-TOW`,
          quantityKg: item.towKg,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          machine: item.machine ?? getMachineFromStockCode(item.sourceStockCode),
        },
      ]),
    )
    .concat(
      filteredBalingRecords.map((item) => ({
        id: `${item.id}-BALING-CONSUME`,
        weighedDate: item.date,
        stockCode: item.sourceStockCode,
        quantityKg: -item.baleWeightKg,
        batchNumber: normalizeBatchNumber(item.batchNumber),
        machine: item.machine ?? getMachineFromStockCode(item.sourceStockCode),
      })),
    )
    .sort((a, b) => b.weighedDate.localeCompare(a.weighedDate))
  const baleInventoryRows = Object.values(
    filteredBalingRecords.reduce((map, item) => {
      if (!map[item.baleSeriesCode]) {
        map[item.baleSeriesCode] = {
          baleSeriesCode: item.baleSeriesCode,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          sourceStockCode: item.sourceStockCode,
          baleWeightKg: item.baleWeightKg,
          baleCount: 0,
        }
      }
      map[item.baleSeriesCode].baleCount += 1
      return map
    }, {}),
  ).sort((a, b) => b.baleCount - a.baleCount)
  const silageInventoryRows = Object.values(
    filteredSilageRecords.reduce((map, item) => {
      const bagSeriesCode = `${normalizeBatchNumber(item.batchNumber)}-${String(item.bagCode).split('-')[2]}-${Math.round(item.massKg)}-SLG`
      if (!map[bagSeriesCode]) {
        map[bagSeriesCode] = {
          bagSeriesCode,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          bagDateCode: String(item.bagCode).split('-')[2],
          bagMassKg: item.massKg,
          bagCount: 0,
        }
      }
      map[bagSeriesCode].bagCount += 1
      return map
    }, {}),
  ).sort((a, b) => b.bagCount - a.bagCount)

  return (
    <section className="panel">
      <h2>Stock</h2>
      <p>
        Weighed fibre from Drying is added to stores as un-brushed fibre stock (`UBR`). Stock code
        format: Batch-Decorticator-Grade (e.g. 2025-006-03-UBR).
      </p>

      <div className="form-grid">
        <label>
          Batch Filter
          <select
            value={selectedBatchFilter}
            onChange={(event) => onSelectedBatchFilterChange(event.target.value)}
          >
            <option value="absolute">Absolute stock (all-time)</option>
            <option value="all">Date filtered stock</option>
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
          <h3>Total Fibre Available</h3>
          <p>{totalAvailableKg.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Active Stock Codes</h3>
          <p>{stockRows.length}</p>
        </article>
      </div>

      <CollapsibleSection
        title="Stock by Code"
        isOpen={showStockByCode}
        onToggle={() => setShowStockByCode((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stock Code</th>
                <th>Batch</th>
                <th>Decorticator</th>
                <th>Total Available (kg)</th>
                <th>Movement Events</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((row) => (
                <tr key={row.stockCode}>
                  <td>{row.stockCode}</td>
                  <td>{row.batchNumber}</td>
                  <td>{getMachineFromStockCode(row.stockCode)}</td>
                  <td>{row.totalKg}</td>
                  <td>{row.movements}</td>
                </tr>
              ))}
              {stockRows.length === 0 && (
                <tr>
                  <td colSpan="5">No stock generated for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Stock Inward Movements"
        isOpen={showStockInwardMovements}
        onToggle={() => setShowStockInwardMovements((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Weighed Date</th>
                <th>Stock Code</th>
                <th>Batch</th>
                <th>Decorticator</th>
                <th>Quantity Added (kg)</th>
              </tr>
            </thead>
            <tbody>
              {stockMovements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDisplayDate(movement.weighedDate)}</td>
                  <td>{movement.stockCode}</td>
                  <td>{movement.batchNumber}</td>
                  <td>{movement.machine}</td>
                  <td>{movement.quantityKg}</td>
                </tr>
              ))}
              {stockMovements.length === 0 && (
                <tr>
                  <td colSpan="5">No stock inward movements for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Bale Inventory"
        isOpen={showBaleInventory}
        onToggle={() => setShowBaleInventory((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bale Number Series</th>
                <th>Batch</th>
                <th>Source Stock Code</th>
                <th>Bale Weight (kg)</th>
                <th>Quantity of Bales</th>
              </tr>
            </thead>
            <tbody>
              {baleInventoryRows.map((row) => (
                <tr key={row.baleSeriesCode}>
                  <td>{row.baleSeriesCode}</td>
                  <td>{row.batchNumber}</td>
                  <td>{row.sourceStockCode}</td>
                  <td>{row.baleWeightKg}</td>
                  <td>{row.baleCount}</td>
                </tr>
              ))}
              {baleInventoryRows.length === 0 && (
                <tr>
                  <td colSpan="5">No bale inventory records for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Silage Inventory"
        isOpen={showSilageInventory}
        onToggle={() => setShowSilageInventory((prev) => !prev)}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label Series</th>
                <th>Batch</th>
                <th>Date Code</th>
                <th>Bag Mass (kg)</th>
                <th>Quantity of Bags</th>
              </tr>
            </thead>
            <tbody>
              {silageInventoryRows.map((row) => (
                <tr key={row.bagSeriesCode}>
                  <td>{row.bagSeriesCode}</td>
                  <td>{row.batchNumber}</td>
                  <td>{row.bagDateCode}</td>
                  <td>{row.bagMassKg}</td>
                  <td>{row.bagCount}</td>
                </tr>
              ))}
              {silageInventoryRows.length === 0 && (
                <tr>
                  <td colSpan="5">No silage inventory records for the current filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

    </section>
  )
}

function HaulagePage({
  currentUser,
  currentUserDataEntryPermissions,
  employees,
  clockedInIds,
  haulageTrips,
  onCreateTrip,
  mileageByDate,
  onSetMileageForDate,
  fuelEntries,
  onAddFuelEntry,
  maintenanceEntries,
  onAddMaintenanceEntry,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBatchFilter,
  onSelectedBatchFilterChange,
  availableBatches,
}) {
  const canCreateTrip = currentUserDataEntryPermissions.has('haulage-trip')
  const canManageMileage = currentUserDataEntryPermissions.has('haulage-mileage')
  const canViewHaulageRecords = canManageMileage || canCreateTrip
  const [showCreateTrip, setShowCreateTrip] = useState(false)
  const [showMileage, setShowMileage] = useState(false)
  const [showFuelEntry, setShowFuelEntry] = useState(false)
  const [showMaintenanceEntry, setShowMaintenanceEntry] = useState(false)
  const [showFuelHistory, setShowFuelHistory] = useState(false)
  const [showMaintenanceHistory, setShowMaintenanceHistory] = useState(false)
  const [showTripRecords, setShowTripRecords] = useState(false)
  const [tripDate, setTripDate] = useState(dateTo)
  const [tripBatch, setTripBatch] = useState(availableBatches[0] ?? '')
  const [officialWeightKg, setOfficialWeightKg] = useState('')
  const [weighbridgeWeightKg, setWeighbridgeWeightKg] = useState('')
  const [selectedLoaderIds, setSelectedLoaderIds] = useState([])
  const [mileageDate, setMileageDate] = useState(dateTo)
  const [mileageKm, setMileageKm] = useState('')
  const [fuelDate, setFuelDate] = useState(dateTo)
  const [fuelLitres, setFuelLitres] = useState('')
  const [fuelCostKes, setFuelCostKes] = useState('')
  const [maintenanceDate, setMaintenanceDate] = useState(dateTo)
  const [maintenanceType, setMaintenanceType] = useState('service')
  const [maintenanceCostKes, setMaintenanceCostKes] = useState('')

  const clockedInLoaders = employees.filter(
    (employee) => employee.role === 'loader' && clockedInIds.includes(employee.id),
  )
  const filteredTrips =
    selectedBatchFilter === 'all'
      ? haulageTrips.filter((trip) => trip.date >= dateFrom && trip.date <= dateTo)
      : haulageTrips.filter((trip) => trip.batchNumber === selectedBatchFilter)
  const byDateCounts = filteredTrips.reduce((map, trip) => {
    map[trip.date] = (map[trip.date] ?? 0) + 1
    return map
  }, {})
  const tripsWithDistance = filteredTrips.map((trip) => ({
    ...trip,
    tripDistanceKm:
      mileageByDate[trip.date] && byDateCounts[trip.date]
        ? Number((mileageByDate[trip.date] / byDateCounts[trip.date]).toFixed(2))
        : (trip.tripDistanceKm ?? 0),
  }))
  const sortedTripsWithDistance = [...tripsWithDistance].sort((a, b) =>
    a.date === b.date ? b.tripNumber - a.tripNumber : b.date.localeCompare(a.date),
  )
  const visibleTripDates = new Set(tripsWithDistance.map((trip) => trip.date))
  const filteredFuelEntries =
    selectedBatchFilter === 'all'
      ? fuelEntries.filter((entry) => entry.date >= dateFrom && entry.date <= dateTo)
      : fuelEntries.filter((entry) => visibleTripDates.has(entry.date))
  const filteredMaintenanceEntries =
    selectedBatchFilter === 'all'
      ? maintenanceEntries.filter((entry) => entry.date >= dateFrom && entry.date <= dateTo)
      : maintenanceEntries.filter((entry) => visibleTripDates.has(entry.date))
  const sortedFuelEntries = [...filteredFuelEntries].sort((a, b) => b.date.localeCompare(a.date))
  const sortedMaintenanceEntries = [...filteredMaintenanceEntries].sort((a, b) =>
    b.date.localeCompare(a.date),
  )
  const totalOfficialWeight = sortedTripsWithDistance.reduce((sum, trip) => sum + trip.officialWeightKg, 0)
  const totalDistance = sortedTripsWithDistance.reduce((sum, trip) => sum + trip.tripDistanceKm, 0)
  const avgWeightPerTrip =
    sortedTripsWithDistance.length > 0 ? Math.round(totalOfficialWeight / sortedTripsWithDistance.length) : 0
  const avgLoadersPerTrip =
    sortedTripsWithDistance.length > 0
      ? Number(
          (
            sortedTripsWithDistance.reduce((sum, trip) => sum + trip.loaderIds.length, 0) /
            sortedTripsWithDistance.length
          ).toFixed(1),
        )
      : 0
  const totalFuelLitres = sortedFuelEntries.reduce((sum, entry) => sum + entry.litres, 0)
  const totalFuelCostKes = sortedFuelEntries.reduce((sum, entry) => sum + entry.costKes, 0)
  const totalMaintenanceCostKes = sortedMaintenanceEntries.reduce(
    (sum, entry) => sum + entry.costKes,
    0,
  )
  const kmPerLitre = totalFuelLitres > 0 ? Number((totalDistance / totalFuelLitres).toFixed(2)) : 0

  function handleLoaderToggle(loaderId) {
    setSelectedLoaderIds((prev) =>
      prev.includes(loaderId) ? prev.filter((id) => id !== loaderId) : [...prev, loaderId],
    )
  }

  function handleCreateTrip(event) {
    event.preventDefault()
    const official = Number(officialWeightKg)
    const bridge = Number(weighbridgeWeightKg)
    if (!canCreateTrip || !currentUser || !clockedInIds.includes(currentUser.id)) {
      return
    }
    if (!tripDate || !tripBatch || Number.isNaN(official) || official <= 0) {
      return
    }
    onCreateTrip({
      date: tripDate,
      batchNumber: tripBatch,
      officialWeightKg: official,
      weighbridgeWeightKg: Number.isNaN(bridge) ? null : bridge,
      driverId: currentUser.id,
      driverName: currentUser.name,
      loaderIds: selectedLoaderIds,
      loaderNames: selectedLoaderIds
        .map((id) => employees.find((employee) => employee.id === id)?.name)
        .filter(Boolean),
    })
    setOfficialWeightKg('')
    setWeighbridgeWeightKg('')
    setSelectedLoaderIds([])
  }

  function handleMileageSubmit(event) {
    event.preventDefault()
    if (!canManageMileage) {
      return
    }
    const mileage = Number(mileageKm)
    if (!mileageDate || Number.isNaN(mileage) || mileage < 0) {
      return
    }
    onSetMileageForDate(mileageDate, mileage)
    setMileageKm('')
  }

  function handleFuelSubmit(event) {
    event.preventDefault()
    if (!canManageMileage) {
      return
    }
    const litres = Number(fuelLitres)
    const costKes = Number(fuelCostKes)
    if (!fuelDate || Number.isNaN(litres) || Number.isNaN(costKes) || litres <= 0 || costKes < 0) {
      return
    }
    onAddFuelEntry({ date: fuelDate, litres, costKes })
    setFuelLitres('')
    setFuelCostKes('')
  }

  function handleMaintenanceSubmit(event) {
    event.preventDefault()
    if (!canManageMileage) {
      return
    }
    const costKes = Number(maintenanceCostKes)
    if (!maintenanceDate || Number.isNaN(costKes) || costKes < 0) {
      return
    }
    onAddMaintenanceEntry({
      date: maintenanceDate,
      type: maintenanceType,
      costKes,
    })
    setMaintenanceCostKes('')
  }

  return (
    <section className="panel">
      <h2>Haulage</h2>
      <p>
        Capture trip-level loaded leaf mass from supervisor records, sanity check with weighbridge
        mass, and track distance per day.
      </p>

      <h3>Trip Filters</h3>
      <div className="form-grid">
        <label>
          Batch Filter
          <select
            value={selectedBatchFilter}
            onChange={(event) => onSelectedBatchFilterChange(event.target.value)}
          >
            <option value="all">Date filtered trips</option>
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
          <h3>Total Trips</h3>
          <p>{tripsWithDistance.length}</p>
        </article>
        <article className="card">
          <h3>Total Leaf Mass</h3>
          <p>{totalOfficialWeight.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Average Mass per Trip</h3>
          <p>{avgWeightPerTrip.toLocaleString()} kg</p>
        </article>
        <article className="card">
          <h3>Total Distance</h3>
          <p>{totalDistance.toLocaleString()} km</p>
        </article>
        <article className="card">
          <h3>Average Loaders per Trip</h3>
          <p>{avgLoadersPerTrip}</p>
        </article>
        <article className="card">
          <h3>Total Fuel</h3>
          <p>{totalFuelLitres.toLocaleString()} L</p>
        </article>
        <article className="card">
          <h3>Fuel Efficiency</h3>
          <p>{kmPerLitre} km/L</p>
        </article>
        <article className="card">
          <h3>Total Fuel Cost</h3>
          <p>KES {totalFuelCostKes.toLocaleString()}</p>
        </article>
        <article className="card">
          <h3>Total Maintenance Cost</h3>
          <p>KES {totalMaintenanceCostKes.toLocaleString()}</p>
        </article>
      </div>

      <CollapsibleSection
        title="Create Trip"
        isOpen={showCreateTrip}
        onToggle={() => setShowCreateTrip((prev) => !prev)}
        canExpand={canCreateTrip}
        deniedMessage="You do not have haulage trip entry permission."
      >
        <form className="form-grid" onSubmit={handleCreateTrip}>
          <label>
            Trip Date
            <input type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} />
          </label>
          <label>
            Batch
            <select value={tripBatch} onChange={(event) => setTripBatch(event.target.value)}>
              {availableBatches.map((batch) => (
                <option key={batch} value={batch}>
                  {batch}
                </option>
              ))}
            </select>
          </label>
          <label>
            Official Weight (kg)
            <input
              type="number"
              min="1"
              value={officialWeightKg}
              onChange={(event) => setOfficialWeightKg(event.target.value)}
            />
          </label>
          <label>
            Weighbridge Weight (kg) - sanity check
            <input
              type="number"
              min="0"
              value={weighbridgeWeightKg}
              onChange={(event) => setWeighbridgeWeightKg(event.target.value)}
            />
          </label>
          <label>
            Clocked-in Loaders
            <div className="checklist">
              {clockedInLoaders.map((loader) => (
                <label key={loader.id} className="check-item">
                  <span>{loader.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedLoaderIds.includes(loader.id)}
                    onChange={() => handleLoaderToggle(loader.id)}
                  />
                </label>
              ))}
            </div>
          </label>
          <button type="submit" disabled={!canCreateTrip || !clockedInIds.includes(currentUser?.id ?? '')}>
            Save Trip
          </button>
        </form>
        {(!canCreateTrip || !clockedInIds.includes(currentUser?.id ?? '')) && (
          <div className="placeholder">
            You must be clocked in and have haulage trip entry permission to create trips.
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Daily Mileage Allocation (Manager)"
        isOpen={showMileage}
        onToggle={() => setShowMileage((prev) => !prev)}
        canExpand={canManageMileage}
        deniedMessage="Only Admin or Harvesting Manager can open this section."
      >
        <form className="form-grid" onSubmit={handleMileageSubmit}>
          <label>
            Date
            <input
              type="date"
              value={mileageDate}
              onChange={(event) => setMileageDate(event.target.value)}
              disabled={!canManageMileage}
            />
          </label>
          <label>
            Total Daily Mileage (km)
            <input
              type="number"
              min="0"
              value={mileageKm}
              onChange={(event) => setMileageKm(event.target.value)}
              disabled={!canManageMileage}
            />
          </label>
          <button type="submit" disabled={!canManageMileage}>
            Save Mileage
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="Fuel Entry (Manager)"
        isOpen={showFuelEntry}
        onToggle={() => setShowFuelEntry((prev) => !prev)}
        canExpand={canManageMileage}
        deniedMessage="Only Admin or Harvesting Manager can open this section."
      >
        <form className="form-grid" onSubmit={handleFuelSubmit}>
          <label>
            Date
            <input
              type="date"
              value={fuelDate}
              onChange={(event) => setFuelDate(event.target.value)}
              disabled={!canManageMileage}
            />
          </label>
          <label>
            Litres
            <input
              type="number"
              min="0"
              step="0.1"
              value={fuelLitres}
              onChange={(event) => setFuelLitres(event.target.value)}
              disabled={!canManageMileage}
            />
          </label>
          <label>
            Cost (KES)
            <input
              type="number"
              min="0"
              value={fuelCostKes}
              onChange={(event) => setFuelCostKes(event.target.value)}
              disabled={!canManageMileage}
            />
          </label>
          <button type="submit" disabled={!canManageMileage}>
            Save Fuel Entry
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="Maintenance / Repair Entry (Manager)"
        isOpen={showMaintenanceEntry}
        onToggle={() => setShowMaintenanceEntry((prev) => !prev)}
        canExpand={canManageMileage}
        deniedMessage="Only Admin or Harvesting Manager can open this section."
      >
        <form className="form-grid" onSubmit={handleMaintenanceSubmit}>
          <label>
            Date
            <input
              type="date"
              value={maintenanceDate}
              onChange={(event) => setMaintenanceDate(event.target.value)}
              disabled={!canManageMileage}
            />
          </label>
          <label>
            Type
            <select
              value={maintenanceType}
              onChange={(event) => setMaintenanceType(event.target.value)}
              disabled={!canManageMileage}
            >
              <option value="service">Service</option>
              <option value="repair">Repair</option>
            </select>
          </label>
          <label>
            Cost (KES)
            <input
              type="number"
              min="0"
              value={maintenanceCostKes}
              onChange={(event) => setMaintenanceCostKes(event.target.value)}
              disabled={!canManageMileage}
            />
          </label>
          <button type="submit" disabled={!canManageMileage}>
            Save Maintenance Entry
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        title="Fuel History"
        isOpen={showFuelHistory}
        onToggle={() => setShowFuelHistory((prev) => !prev)}
        canExpand={canViewHaulageRecords}
        deniedMessage="You do not have haulage mileage permission."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Litres</th>
                <th>Cost (KES)</th>
              </tr>
            </thead>
            <tbody>
              {sortedFuelEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDisplayDate(entry.date)}</td>
                  <td>{entry.litres}</td>
                  <td>{entry.costKes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Maintenance History"
        isOpen={showMaintenanceHistory}
        onToggle={() => setShowMaintenanceHistory((prev) => !prev)}
        canExpand={canViewHaulageRecords}
        deniedMessage="You do not have haulage mileage permission."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Cost (KES)</th>
              </tr>
            </thead>
            <tbody>
              {sortedMaintenanceEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDisplayDate(entry.date)}</td>
                  <td>{entry.type}</td>
                  <td>{entry.costKes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Trip Records"
        isOpen={showTripRecords}
        onToggle={() => setShowTripRecords((prev) => !prev)}
        canExpand={canViewHaulageRecords}
        deniedMessage="You do not have haulage mileage permission."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Trip Number</th>
                <th>Batch</th>
                <th>Driver</th>
                <th>Number of Loaders</th>
                <th>Weight of Leaves (kg)</th>
                <th>Weighbridge (kg)</th>
                <th>Trip Distance (km)</th>
              </tr>
            </thead>
            <tbody>
            {sortedTripsWithDistance.map((trip) => (
                <tr key={trip.id}>
                  <td>{formatDisplayDate(trip.date)}</td>
                  <td>{trip.tripNumber}</td>
                  <td>{trip.batchNumber}</td>
                  <td>{trip.driverName}</td>
                  <td>{trip.loaderIds.length}</td>
                  <td>{trip.officialWeightKg.toLocaleString()}</td>
                  <td>{trip.weighbridgeWeightKg ?? 'NA'}</td>
                  <td>{trip.tripDistanceKm.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </section>
  )
}

function HarvestingRecordPage({ employees, records }) {
  const { personId } = useParams()
  const [searchParams] = useSearchParams()
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const selectedBatch = searchParams.get('batch') || 'all'
  const allDates = records.map((record) => record.harvestedOn).sort()
  const fallbackFrom = allDates[0]
  const fallbackTo = allDates[allDates.length - 1]
  const dateFrom = fromParam || fallbackFrom
  const dateTo = toParam || fallbackTo
  const periodDates = listDatesInRange(dateFrom, dateTo)
  const periodDatesDesc = [...periodDates].reverse()
  const selectedPerson = employees.find((employee) => employee.id === personId)

  if (!selectedPerson) {
    return (
      <section className="panel">
        <h2>Record not found</h2>
        <Link className="action-link" to="/activities/harvesting">
          Back to Harvesting Summary
        </Link>
      </section>
    )
  }

  const filteredRecords =
    selectedBatch === 'all'
      ? records.filter((record) => record.harvestedOn >= dateFrom && record.harvestedOn <= dateTo)
      : records.filter((record) => record.batchNumber === selectedBatch)

  if (selectedPerson.role === 'harvester') {
    const harvesterRecords = [...filteredRecords.filter((record) => record.harvesterId === personId)].sort(
      (a, b) => a.harvestedOn.localeCompare(b.harvestedOn),
    )
    const daysWorked = harvesterRecords.length
    const totalKg = harvesterRecords.reduce((sum, record) => sum + record.kg, 0)
    const averageKg = daysWorked > 0 ? Math.round(totalKg / daysWorked) : 0

    return (
      <section className="panel">
        <h2>{selectedPerson.name}</h2>
        <p className="harvesting-summary-period">
          Period: {formatDisplayDate(dateFrom)} – {formatDisplayDate(dateTo)}
          {selectedBatch !== 'all' ? ` | Batch ${selectedBatch}` : ''}
        </p>
        <Link className="action-link" to="/activities/harvesting">
          Back to Harvesting Summary
        </Link>
        <div className="table-wrap">
          <table className="harvesting-day-record-table">
            <thead>
              <tr>
                <th colSpan="2">Days worked in period</th>
              </tr>
              <tr>
                <th></th>
                <th>Leaves (kg)</th>
              </tr>
            </thead>
            <tbody>
              {harvesterRecords.length === 0 && (
                <tr>
                  <td colSpan="2">No harvest records for this period.</td>
                </tr>
              )}
              {harvesterRecords.map((record) => (
                <tr key={record.id}>
                  <td>{formatDisplayDate(record.harvestedOn)}</td>
                  <td>{record.kg.toLocaleString()}</td>
                </tr>
              ))}
              {harvesterRecords.length > 0 && (
                <tr className="harvesting-summary-averages">
                  <td></td>
                  <td>
                    <strong>{averageKg.toLocaleString()}</strong>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {daysWorked > 0 && (
          <p className="harvesting-day-record-footnote">
            Average of above ({daysWorked} day{daysWorked === 1 ? '' : 's'} worked)
          </p>
        )}
      </section>
    )
  }

  const supervisorDayMap = filteredRecords.reduce((map, record) => {
    if (record.recordedById !== personId) {
      return map
    }
    if (!map[record.harvestedOn]) {
      map[record.harvestedOn] = {
        harvestedOn: record.harvestedOn,
        recordsCaptured: 0,
        totalKg: 0,
        supervisorDailyWageKes: record.supervisorDailyWageKes ?? 0,
        batches: new Set(),
        clockInTime: record.clockInTime,
        clockOutTime: record.clockOutTime,
      }
    }
    map[record.harvestedOn].recordsCaptured += 1
    map[record.harvestedOn].totalKg += record.kg
    map[record.harvestedOn].batches.add(record.batchNumber)
    return map
  }, {})
  const timeline = periodDatesDesc.map((date) => supervisorDayMap[date] || { harvestedOn: date, isAbsent: true })
  const daysWorked = timeline.filter((day) => !day.isAbsent).length

  return (
    <section className="panel">
      <h2>{selectedPerson.name}</h2>
      <p>
        Days worked: <strong>{daysWorked}</strong>
      </p>
      {selectedBatch !== 'all' && <p>Batch: {selectedBatch}</p>}
      <Link className="action-link" to="/activities/harvesting">
        Back to Harvesting Summary
      </Link>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Batch</th>
              <th>Records Captured</th>
              <th>Total KG Captured</th>
              <th>Daily Remuneration</th>
              <th>Clock in time</th>
              <th>Clock out time</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((day) => (
              <tr key={`${selectedPerson.id}-${day.harvestedOn}`}>
                <td>{formatDisplayDate(day.harvestedOn)}</td>
                <td>
                  {day.isAbsent
                    ? 'NA'
                    : Array.from(day.batches ?? []).sort().join(', ')}
                </td>
                <td>{day.isAbsent ? 'Absent' : day.recordsCaptured}</td>
                <td>{day.isAbsent ? 'Absent' : day.totalKg}</td>
                <td>
                  {day.isAbsent
                    ? 'NA'
                    : `KES ${(day.supervisorDailyWageKes ?? 0).toLocaleString()}`}
                </td>
                <td>{day.isAbsent ? 'NA' : day.clockInTime}</td>
                <td>{day.isAbsent ? 'NA' : day.clockOutTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function hydrateAppState(data, setters) {
  if (!data) {
    return
  }
  if (Array.isArray(data.employees)) {
    const employees = employeeRecordsNeedSeedMerge(data.employees)
      ? mergeEmployeesWithSeed(data.employees, mananasiStaffEmployees)
      : data.employees
    setters.setEmployees(employees)
  }
  if (Array.isArray(data.customers)) setters.setCustomers(data.customers)
  if (typeof data.activeBatchNumber === 'string') setters.setActiveBatchNumber(data.activeBatchNumber)
  if (Array.isArray(data.clockedInIds)) setters.setClockedInIds(data.clockedInIds)
  if (Array.isArray(data.records)) setters.setRecords(data.records)
  if (data.compensationRules) {
    setters.setCompensationRules({
      incentiveThresholdKg: data.compensationRules.incentiveThresholdKg ?? 250,
      incentiveRateKesPerKg: data.compensationRules.incentiveRateKesPerKg ?? 1,
    })
  }
  if (data.pagePermissionOverrides) setters.setPagePermissionOverrides(data.pagePermissionOverrides)
  if (data.dataEntryPermissionOverrides) {
    setters.setDataEntryPermissionOverrides(data.dataEntryPermissionOverrides)
  }
  if (Array.isArray(data.haulageTrips)) setters.setHaulageTrips(data.haulageTrips)
  if (data.mileageByDate) setters.setMileageByDate(data.mileageByDate)
  if (Array.isArray(data.fuelEntries)) setters.setFuelEntries(data.fuelEntries)
  if (Array.isArray(data.maintenanceEntries)) setters.setMaintenanceEntries(data.maintenanceEntries)
  if (Array.isArray(data.decorticationAssignments)) {
    setters.setDecorticationAssignments(data.decorticationAssignments)
  }
  if (Array.isArray(data.decorticationRecords)) setters.setDecorticationRecords(data.decorticationRecords)
  if (Array.isArray(data.dryingRecords)) setters.setDryingRecords(data.dryingRecords)
  if (Array.isArray(data.brushingStockMovements)) {
    setters.setBrushingStockMovements(data.brushingStockMovements)
  }
  if (Array.isArray(data.brushingDailyRecords)) {
    setters.setBrushingDailyRecords(data.brushingDailyRecords)
  }
  if (Array.isArray(data.balingRecords)) setters.setBalingRecords(data.balingRecords)
  if (Array.isArray(data.silageRecords)) setters.setSilageRecords(data.silageRecords)
  if (Array.isArray(data.invoiceDocuments)) setters.setInvoiceDocuments(data.invoiceDocuments)
  if (data.payrollAdjustments) setters.setPayrollAdjustments(data.payrollAdjustments)
  if (data.salaryPayrollAdjustments) setters.setSalaryPayrollAdjustments(data.salaryPayrollAdjustments)
  if (data.payrollApprovals) setters.setPayrollApprovals(data.payrollApprovals)
}

function App() {
  const { ready, initialData, persist, syncError, syncing, lastSavedAt } = useBackendSync()
  const hydratedRef = useRef(false)
  const [employees, setEmployees] = useState(() => [...mananasiStaffEmployees])
  const [customers, setCustomers] = useState(initialCustomers)
  const [activeBatchNumber, setActiveBatchNumber] = useState('2025-006')
  const [clockedInIds, setClockedInIds] = useState(() => [...initialDemoClockedInIds])
  const [records, setRecords] = useState(() =>
    buildSeedRecords(
      seedHarvesters,
      seedHarvestSupervisors,
      defaultCompensationRules,
      '2025-006',
    ),
  )
  const recordDates = records.map((record) => record.harvestedOn).sort()
  const defaultFrom = recordDates[0] ?? new Date().toISOString().slice(0, 10)
  const defaultTo = recordDates[recordDates.length - 1] ?? new Date().toISOString().slice(0, 10)
  const [harvestingDateFrom, setHarvestingDateFrom] = useState(defaultFrom)
  const [harvestingDateTo, setHarvestingDateTo] = useState(defaultTo)
  const [harvestingBatchFilter, setHarvestingBatchFilter] = useState('all')
  const [haulageDateFrom, setHaulageDateFrom] = useState(defaultFrom)
  const [haulageDateTo, setHaulageDateTo] = useState(defaultTo)
  const [haulageBatchFilter, setHaulageBatchFilter] = useState('all')
  const [decorticationDateFrom, setDecorticationDateFrom] = useState(defaultFrom)
  const [decorticationDateTo, setDecorticationDateTo] = useState(defaultTo)
  const [decorticationBatchFilter, setDecorticationBatchFilter] = useState('all')
  const [dryingDateFrom, setDryingDateFrom] = useState(defaultFrom)
  const [dryingDateTo, setDryingDateTo] = useState(defaultTo)
  const [dryingBatchFilter, setDryingBatchFilter] = useState('all')
  const [brushingDateFrom, setBrushingDateFrom] = useState(defaultFrom)
  const [brushingDateTo, setBrushingDateTo] = useState(defaultTo)
  const [brushingBatchFilter, setBrushingBatchFilter] = useState('all')
  const [balingDateFrom, setBalingDateFrom] = useState(defaultFrom)
  const [balingDateTo, setBalingDateTo] = useState(defaultTo)
  const [balingBatchFilter, setBalingBatchFilter] = useState('all')
  const [silageDateFrom, setSilageDateFrom] = useState(defaultFrom)
  const [silageDateTo, setSilageDateTo] = useState(defaultTo)
  const [silageBatchFilter, setSilageBatchFilter] = useState('all')
  const [stockDateFrom, setStockDateFrom] = useState(defaultFrom)
  const [stockDateTo, setStockDateTo] = useState(defaultTo)
  const [stockBatchFilter, setStockBatchFilter] = useState('all')
  const [compensationRules, setCompensationRules] = useState(defaultCompensationRules)
  const [authLeadershipId, setAuthLeadershipId] = useState(() =>
    readValidAuthLeadershipId(mananasiStaffEmployees),
  )
  const [pagePermissionOverrides, setPagePermissionOverrides] = useState(readPagePermissionOverrides)
  const [dataEntryPermissionOverrides, setDataEntryPermissionOverrides] = useState(
    readDataEntryPermissionOverrides,
  )
  const [attendanceRefreshing, setAttendanceRefreshing] = useState(false)
  const [payrollAdjustments, setPayrollAdjustments] = useState({})
  const [salaryPayrollAdjustments, setSalaryPayrollAdjustments] = useState({})
  const [payrollApprovals, setPayrollApprovals] = useState({})
  const [haulageTrips, setHaulageTrips] = useState(() =>
    buildSeedHaulageTrips(
      buildSeedRecords(
        seedHarvesters,
        seedHarvestSupervisors,
        defaultCompensationRules,
        '2025-006',
      ),
      mananasiStaffEmployees,
    ),
  )
  const [mileageByDate, setMileageByDate] = useState({})
  const [fuelEntries, setFuelEntries] = useState(() =>
    buildSeedFuelAndMaintenance(
      buildSeedHaulageTrips(
        buildSeedRecords(
          seedHarvesters,
          seedHarvestSupervisors,
          defaultCompensationRules,
          '2025-006',
        ),
        mananasiStaffEmployees,
      ),
    ).fuelEntries,
  )
  const [maintenanceEntries, setMaintenanceEntries] = useState(() =>
    buildSeedFuelAndMaintenance(
      buildSeedHaulageTrips(
        buildSeedRecords(
          seedHarvesters,
          seedHarvestSupervisors,
          defaultCompensationRules,
          '2025-006',
        ),
        mananasiStaffEmployees,
      ),
    ).maintenanceEntries,
  )
  const [decorticationAssignments, setDecorticationAssignments] = useState(() =>
    buildDecorticationAssignmentsFromRecords(
      buildSeedDecorticationRecords(
        buildSeedHaulageTrips(
          buildSeedRecords(
            seedHarvesters,
            seedHarvestSupervisors,
            defaultCompensationRules,
            '2025-006',
          ),
          mananasiStaffEmployees,
        ),
        mananasiStaffEmployees,
      ),
    ),
  )
  const [decorticationRecords, setDecorticationRecords] = useState(() =>
    buildSeedDecorticationRecords(
      buildSeedHaulageTrips(
        buildSeedRecords(
          seedHarvesters,
          seedHarvestSupervisors,
          defaultCompensationRules,
          '2025-006',
        ),
        mananasiStaffEmployees,
      ),
      mananasiStaffEmployees,
    ),
  )
  const [dryingRecords, setDryingRecords] = useState(() =>
    buildSeedDryingRecords(
      buildSeedDecorticationRecords(
        buildSeedHaulageTrips(
          buildSeedRecords(
            seedHarvesters,
            seedHarvestSupervisors,
            defaultCompensationRules,
            '2025-006',
          ),
          mananasiStaffEmployees,
        ),
        mananasiStaffEmployees,
      ),
      mananasiStaffEmployees,
    ),
  )
  const seededBrushingData = useMemo(
    () => buildSeedBrushingData(dryingRecords, mananasiStaffEmployees),
    [dryingRecords],
  )
  const [brushingStockMovements, setBrushingStockMovements] = useState(
    seededBrushingData.brushingStockMovements,
  )
  const [brushingDailyRecords, setBrushingDailyRecords] = useState(
    seededBrushingData.brushingDailyRecords,
  )
  const [balingRecords, setBalingRecords] = useState(() =>
    buildSeedBalingRecords(seededBrushingData.brushingDailyRecords, mananasiStaffEmployees),
  )
  const [silageRecords, setSilageRecords] = useState(() =>
    buildSeedSilageRecords(dryingRecords, mananasiStaffEmployees),
  )
  const [attendanceEvents, setAttendanceEvents] = useState([])
  const [invoiceDocuments, setInvoiceDocuments] = useState([
    {
      id: 'INV-SEED-1087',
      documentType: 'invoice',
      documentNumber: '1087',
      invoiceDate: '2026-03-27',
      origin: 'Kenya',
      currency: 'USD',
      customerName: 'Ita Francia Linen Knitting Company Limited',
      customerAddress:
        '4th floor 3th building, 26th Zhenxing Road, Chancheng District, Foshan City, China',
      customerRegistration: '91440605L082304604',
      items: [
        {
          product: 'PALF',
          description: 'Brushed Pineapple Leaf Fibre',
          quantityKg: 8400,
          rate: 3.06,
          amount: 25704,
        },
      ],
      totalAmount: 25704,
      hsCode: '53050090',
      paymentTerms: '30% deposit, balance upon arrival at port',
      shippingTerms: 'CIF Nansha',
      status: 'confirmed',
      createdAt: '2026-03-27T10:00:00.000Z',
      sourceProformaId: null,
    },
  ])

  const currentUser = employees.find((employee) => employee.id === authLeadershipId) ?? null

  useEffect(() => {
    if (!ready || hydratedRef.current) {
      return
    }
    hydrateAppState(initialData, {
      setEmployees,
      setCustomers,
      setActiveBatchNumber,
      setClockedInIds,
      setRecords,
      setCompensationRules,
      setPagePermissionOverrides,
      setDataEntryPermissionOverrides,
      setHaulageTrips,
      setMileageByDate,
      setFuelEntries,
      setMaintenanceEntries,
      setDecorticationAssignments,
      setDecorticationRecords,
      setDryingRecords,
      setBrushingStockMovements,
      setBrushingDailyRecords,
      setBalingRecords,
      setSilageRecords,
      setInvoiceDocuments,
      setPayrollAdjustments,
      setSalaryPayrollAdjustments,
      setPayrollApprovals,
    })
    hydratedRef.current = true
  }, [ready, initialData])

  const persistedSnapshot = useMemo(
    () => ({
      version: 1,
      employees,
      customers,
      activeBatchNumber,
      clockedInIds,
      records,
      compensationRules,
      pagePermissionOverrides,
      dataEntryPermissionOverrides,
      haulageTrips,
      mileageByDate,
      fuelEntries,
      maintenanceEntries,
      decorticationAssignments,
      decorticationRecords,
      dryingRecords,
      brushingStockMovements,
      brushingDailyRecords,
      balingRecords,
      silageRecords,
      invoiceDocuments,
      payrollAdjustments,
      salaryPayrollAdjustments,
      payrollApprovals,
    }),
    [
      employees,
      customers,
      activeBatchNumber,
      clockedInIds,
      records,
      compensationRules,
      pagePermissionOverrides,
      dataEntryPermissionOverrides,
      haulageTrips,
      mileageByDate,
      fuelEntries,
      maintenanceEntries,
      decorticationAssignments,
      decorticationRecords,
      dryingRecords,
      brushingStockMovements,
      brushingDailyRecords,
      balingRecords,
      silageRecords,
      invoiceDocuments,
      payrollAdjustments,
      salaryPayrollAdjustments,
      payrollApprovals,
    ],
  )

  useEffect(() => {
    if (!ready || !hydratedRef.current) {
      return
    }
    persist(persistedSnapshot)
  }, [persistedSnapshot, ready, persist])

  useEffect(() => {
    if (!ready) {
      return
    }
    fetchAttendanceEvents(RECENT_CLOCK_EVENTS_LIMIT)
      .then((events) => setAttendanceEvents(events))
      .catch(() => setAttendanceEvents([]))
  }, [ready, clockedInIds])

  const allowedPages = useMemo(
    () =>
      currentUser
        ? getEffectivePagePermissions(currentUser.id, pagePermissionOverrides, employees)
        : new Set(),
    [currentUser, pagePermissionOverrides, employees],
  )
  const currentUserDataEntryPermissions = useMemo(
    () =>
      currentUser
        ? getEffectiveDataEntryPermissions(currentUser.id, dataEntryPermissionOverrides, employees)
        : new Set(),
    [currentUser, dataEntryPermissionOverrides, employees],
  )

  const availableBatchNumbers = useMemo(
    () =>
      Array.from(
        new Set([
          ...records.map((record) => normalizeBatchNumber(record.batchNumber)),
          ...haulageTrips.map((trip) => normalizeBatchNumber(trip.batchNumber)),
          ...decorticationRecords.map((record) => normalizeBatchNumber(record.batchNumber)),
          ...silageRecords.map((record) => normalizeBatchNumber(record.batchNumber)),
        ]),
      ).sort(),
    [records, haulageTrips, decorticationRecords, silageRecords],
  )
  const availableLooseStockOptions = useMemo(() => {
    const stockMap = {}
    dryingRecords.forEach((record) => {
      const code = buildStockCode(record.batchNumber, record.machine, 'UBR')
      if (!stockMap[code]) {
        stockMap[code] = {
          stockCode: code,
          batchNumber: normalizeBatchNumber(record.batchNumber),
          totalKg: 0,
        }
      }
      stockMap[code].totalKg += record.totalDriedKg
    })
    brushingStockMovements.forEach((item) => {
      const code = item.sourceStockCode
      if (!stockMap[code]) {
        stockMap[code] = {
          stockCode: code,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          totalKg: 0,
        }
      }
      stockMap[code].totalKg += item.type === 'issue' ? -item.quantityKg : item.quantityKg
    })
    brushingDailyRecords.forEach((item) => {
      const traceabilityRoot = String(item.sourceStockCode ?? '').replace(/-UBR$/, '')
      const brsCode = `${traceabilityRoot}-BRS`
      const towCode = `${traceabilityRoot}-TOW`
      if (!stockMap[brsCode]) {
        stockMap[brsCode] = {
          stockCode: brsCode,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          totalKg: 0,
        }
      }
      if (!stockMap[towCode]) {
        stockMap[towCode] = {
          stockCode: towCode,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          totalKg: 0,
        }
      }
      stockMap[brsCode].totalKg += item.brsKg
      stockMap[towCode].totalKg += item.towKg
    })
    balingRecords.forEach((item) => {
      const code = item.sourceStockCode
      if (!stockMap[code]) {
        stockMap[code] = {
          stockCode: code,
          batchNumber: normalizeBatchNumber(item.batchNumber),
          totalKg: 0,
        }
      }
      stockMap[code].totalKg -= item.baleWeightKg
    })
    return Object.values(stockMap)
      .map((item) => ({ ...item, totalKg: Number(item.totalKg.toFixed(1)) }))
      .filter((item) => item.totalKg > 0)
      .sort((a, b) => b.totalKg - a.totalKg)
  }, [dryingRecords, brushingStockMovements, brushingDailyRecords, balingRecords])
  function handleAddEmployee(input) {
    const { role = 'harvester', ...profile } = input
    const nextWorkNo = String(nextEmployeeWorkNumber(employees))
    if (!String(profile.name ?? '').trim()) {
      return
    }
    const employee = {
      id: nextWorkNo,
      role,
      ...profile,
      position: profile.position || getEmployeeRoleLabel(role),
    }
    setEmployees((prev) => [...prev, employee])
  }

  function handleUpdateEmployeeRole(employeeId, role) {
    setEmployees((prev) =>
      prev.map((employee) => (employee.id === employeeId ? { ...employee, role } : employee)),
    )
  }

  function handleUpdateEmployeeProfile(employeeId, profile) {
    setEmployees((prev) =>
      prev.map((employee) => (employee.id === employeeId ? { ...employee, ...profile } : employee)),
    )
  }

  function handleLogout() {
    sessionStorage.removeItem(AUTH_SESSION_KEY)
    setAuthLeadershipId('')
  }

  function handleSaveEmployeePageAccess(employeeId, pageIds) {
    const unique = [...new Set(pageIds)].filter((id) => PAGE_ACCESS_IDS.includes(id))
    if (!unique.includes('dashboard')) {
      unique.unshift('dashboard')
    }
    setPagePermissionOverrides((prev) => ({ ...prev, [employeeId]: unique }))
  }

  function handleUpdatePayrollAdjustment(periodId, employeeId, adjustment) {
    if (isPayrollPeriodApproved(payrollApprovals, periodId)) {
      return
    }
    setPayrollAdjustments((prev) => ({
      ...prev,
      [periodId]: {
        ...(prev[periodId] ?? {}),
        [employeeId]: adjustment,
      },
    }))
  }

  function handleUpdateSalaryPayrollAdjustment(periodId, employeeId, adjustment) {
    if (isPayrollPeriodApproved(payrollApprovals, periodId)) {
      return
    }
    setSalaryPayrollAdjustments((prev) => ({
      ...prev,
      [periodId]: {
        ...(prev[periodId] ?? {}),
        [employeeId]: adjustment,
      },
    }))
  }

  function handleApprovePayrollPeriod(periodId) {
    if (!currentUser || !canApprovePayroll(currentUser)) {
      return
    }
    setPayrollApprovals((prev) => ({
      ...prev,
      [periodId]: createPayrollApproval(currentUser),
    }))
  }

  function handleReleasePayrollPeriod(periodId) {
    if (!currentUser || !canApprovePayroll(currentUser)) {
      return
    }
    setPayrollApprovals((prev) => {
      const next = { ...prev }
      delete next[periodId]
      return next
    })
  }

  function handleClearEmployeePageAccessOverride(employeeId) {
    setPagePermissionOverrides((prev) => {
      const next = { ...prev }
      delete next[employeeId]
      return next
    })
  }

  function handleSaveEmployeeDataEntryPermissions(employeeId, permissionIds) {
    const unique = [...new Set(permissionIds)].filter((id) => DATA_ENTRY_PERMISSION_IDS.includes(id))
    setDataEntryPermissionOverrides((prev) => ({ ...prev, [employeeId]: unique }))
  }

  function handleAddCustomer(input) {
    const nextId = `CUST-${String(customers.length + 1).padStart(3, '0')}`
    setCustomers((prev) => [
      ...prev,
      {
        id: nextId,
        name: input.name,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        postCode: input.postCode,
        country: input.country,
        email: input.email,
        phone: input.phone,
        companyRegistration: input.companyRegistration,
      },
    ])
  }

  async function handleRefreshAttendance() {
    setAttendanceRefreshing(true)
    try {
      const [events, state] = await Promise.all([
        fetchAttendanceEvents(RECENT_CLOCK_EVENTS_LIMIT),
        fetchAppState(),
      ])
      setAttendanceEvents(events)
      if (Array.isArray(state?.clockedInIds)) {
        setClockedInIds(state.clockedInIds)
      }
    } finally {
      setAttendanceRefreshing(false)
    }
  }

  function handleSubmitHarvestRecord(harvesterId, bundleWeights, recordedById) {
    const harvester = employees.find((employee) => employee.id === harvesterId)
    const recorder = employees.find((employee) => employee.id === recordedById)
    if (!harvester || !recorder) {
      return
    }
    if (
      recorder.role !== 'harvesting-supervisor' &&
      recorder.role !== 'harvesting-manager' &&
      recorder.role !== 'admin'
    ) {
      return
    }
    if (harvester.role !== 'harvester') {
      return
    }
    if (!clockedInIds.includes(harvester.id)) {
      return
    }
    const weights = Array.isArray(bundleWeights)
      ? bundleWeights.filter((weight) => typeof weight === 'number' && weight > 0)
      : []
    if (weights.length === 0) {
      return
    }
    const kg = Number(weights.reduce((sum, weight) => sum + weight, 0).toFixed(1))

    const wage = calculateHarvestWage(kg, harvester, compensationRules)
    const supervisor = employees.find((employee) => employee.id === recordedById)
    const nextRecord = {
      id: `${harvesterId}-${Date.now()}`,
      harvesterId,
      harvesterName: harvester.name,
      bundleWeights: weights,
      kg,
      harvestedOn: new Date().toISOString().slice(0, 10),
      clockInTime: '7:15',
      clockOutTime: '4:45',
      supervisorDailyWageKes: supervisor ? getEmployeeDailyWageKes(supervisor) : 0,
      batchNumber: normalizeBatchNumber(activeBatchNumber),
      ...wage,
      recordedById,
      recordedByName: recorder.name,
    }
    setRecords((prev) => [nextRecord, ...prev])
  }

  function handleCreateHaulageTrip(input) {
    const sameDateTrips = haulageTrips.filter((trip) => trip.date === input.date)
    const nextTrip = {
      id: `TRIP-${Date.now()}`,
      ...input,
      tripNumber: sameDateTrips.length + 1,
      tripDistanceKm: 45,
    }
    setHaulageTrips((prev) => [nextTrip, ...prev])
  }

  function handleSetMileageForDate(date, mileage) {
    setMileageByDate((prev) => ({
      ...prev,
      [date]: mileage,
    }))
  }

  function handleAddFuelEntry(input) {
    setFuelEntries((prev) => [
      { id: `FUEL-${Date.now()}`, ...input },
      ...prev,
    ])
  }

  function handleAddMaintenanceEntry(input) {
    setMaintenanceEntries((prev) => [
      { id: `MTN-${Date.now()}`, ...input },
      ...prev,
    ])
  }

  function handleCreateDecorticationProduction(input) {
    setDecorticationRecords((prev) => [
      { id: `DEC-${Date.now()}`, ...input },
      ...prev,
    ])
  }

  function handleUpdateDecorticationProduction(recordId, updates) {
    setDecorticationRecords((prev) =>
      prev.map((record) => (record.id === recordId ? { ...record, ...updates } : record)),
    )
  }

  function handleAddDryingRecord(input) {
    setDryingRecords((prev) => [{ id: `DRY-${Date.now()}`, ...input }, ...prev])
  }

  function handleAddBrushingStockMovement(input) {
    setBrushingStockMovements((prev) => [{ id: `BRM-${Date.now()}`, ...input }, ...prev])
  }

  function handleAddBrushingDailyRecord(input) {
    setBrushingDailyRecords((prev) => [{ id: `BRD-${Date.now()}`, ...input }, ...prev])
  }

  function handleCreateBales(inputRecords) {
    setBalingRecords((prev) => [
      ...inputRecords.map((item, index) => ({ id: `BAL-${Date.now()}-${index + 1}`, ...item })),
      ...prev,
    ])
  }

  function handleCreateSilageStock(inputRecords) {
    setSilageRecords((prev) => [
      ...inputRecords.map((item, index) => ({ id: `SLG-${Date.now()}-${index + 1}`, ...item })),
      ...prev,
    ])
  }

  function handleCreateInvoiceDocument(input) {
    const isProforma = input.documentType === 'proforma'
    const prefix = isProforma ? 'PFI' : 'INV'
    const existingNumbers = invoiceDocuments
      .filter((item) => item.documentType === input.documentType)
      .map((item) => Number(String(item.documentNumber).replace(/[^\d]/g, '')))
      .filter((value) => !Number.isNaN(value))
    const nextSequence = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1088
    const documentNumber = isProforma ? `${prefix}-${nextSequence}` : String(nextSequence)
    const nextDocument = {
      id: `${prefix}-${Date.now()}`,
      ...input,
      documentNumber,
      totalAmount: Number(input.items.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
      status: isProforma ? 'draft' : 'confirmed',
      createdAt: new Date().toISOString(),
      sourceProformaId: null,
    }
    setInvoiceDocuments((prev) => [nextDocument, ...prev])
    return nextDocument
  }

  function handleConvertProformaToInvoice(documentId) {
    const source = invoiceDocuments.find((item) => item.id === documentId)
    if (!source || source.documentType !== 'proforma') {
      return
    }
    const existingNumbers = invoiceDocuments
      .filter((item) => item.documentType === 'invoice')
      .map((item) => Number(String(item.documentNumber).replace(/[^\d]/g, '')))
      .filter((value) => !Number.isNaN(value))
    const nextSequence = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1088
    const converted = {
      ...source,
      id: `INV-${Date.now()}`,
      documentType: 'invoice',
      documentNumber: String(nextSequence),
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      sourceProformaId: source.id,
    }
    setInvoiceDocuments((prev) => [converted, ...prev])
  }

  function handleCreateDecorticationAssignment(input) {
    const assignmentId = input.assignmentId ?? `ASG-${Date.now()}`
    const normalizedBatchNumber = normalizeBatchNumber(input.batchNumber)
    const assignment = { ...input, id: assignmentId, batchNumber: normalizedBatchNumber }
    const record = {
      id: `DEC-${Date.now()}`,
      assignmentId,
      date: input.date,
      machine: input.machine,
      shiftNumber: input.shiftNumber,
      batchNumber: normalizedBatchNumber,
      supervisorId: input.supervisorId,
      supervisorName: input.supervisorName,
      operatorIds: input.operatorIds,
      operatorNames: input.operatorNames,
      fibreKg: input.fibreKg ?? 0,
      waterM3: input.waterM3 ?? 0,
      runtimeHours: input.runtimeHours ?? 0,
      leafInputKg: input.leafInputKg ?? 0,
    }
    setDecorticationAssignments((prev) => [assignment, ...prev])
    setDecorticationRecords((prev) => [record, ...prev])
  }

  if (!ready) {
    return (
      <div className="login-layout">
        <section className="panel login-panel">
          <h1>Mananasi Fibre App</h1>
          <p>Loading data from server...</p>
        </section>
      </div>
    )
  }

  if (!authLeadershipId) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <LoginPage
              onLoginSuccess={(id) => {
                setAuthLeadershipId(id)
                sessionStorage.setItem(AUTH_SESSION_KEY, id)
              }}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Mananasi Fibre App</h1>
        <p>Production and logistics modules</p>
        <div className="session-box">
          <button type="button" className="logout-button" onClick={handleLogout}>
            Sign out
          </button>
          <p className="session-signed-name">{currentUser?.name ?? '—'}</p>
          <p className="backend-sync-status">
            {syncError
              ? `Sync error: ${syncError}`
              : syncing
                ? 'Saving to server...'
                : lastSavedAt
                  ? `Saved ${lastSavedAt.toLocaleTimeString()}`
                  : 'Connected to server'}
          </p>
        </div>
        <nav>
          {allowedPages.has('dashboard') ? <NavLink to="/">Dashboard</NavLink> : null}
          {allowedPages.has('employees') ? <NavLink to="/employees">Employees</NavLink> : null}
          {allowedPages.has('payroll') ? <NavLink to="/payroll">Payroll</NavLink> : null}
          {isAppAdmin(currentUser) ? (
            <NavLink to="/admin/sign-in-accounts">Sign-in accounts</NavLink>
          ) : null}
          {allowedPages.has('customers') ? <NavLink to="/customers">Customers</NavLink> : null}
          {allowedPages.has('stock') ? <NavLink to="/stock">Stock</NavLink> : null}
          {allowedPages.has('harvesting') ? (
            <NavLink to="/activities/harvesting">Harvesting</NavLink>
          ) : null}
          {currentUserDataEntryPermissions.has('harvesting-entry') ? (
            <NavLink to="/activities/harvesting/entry">Record harvest weights</NavLink>
          ) : null}
          {activityModules
            .filter((activity) => activity.id !== 'harvesting')
            .filter((activity) => allowedPages.has(activity.id))
            .map((activity) => (
              <NavLink key={activity.id} to={`/activities/${activity.id}`}>
                {activity.name}
              </NavLink>
            ))}
        </nav>
      </aside>
      <main className="content">
        <GatedRoutes allowedPages={allowedPages}>
          <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route
            path="/"
            element={
              <HomePage employees={employees} records={records} clockedInIds={clockedInIds} />
            }
          />
          <Route
            path="/employees"
            element={
              <EmployeesPage
                employees={employees}
                currentUser={currentUser}
                harvestingDateFrom={harvestingDateFrom}
                harvestingDateTo={harvestingDateTo}
                clockedInIds={clockedInIds}
                attendanceEvents={attendanceEvents}
                onRefreshAttendance={handleRefreshAttendance}
                attendanceRefreshing={attendanceRefreshing}
              />
            }
          />
          <Route path="/attendance" element={<Navigate to="/employees" replace />} />
          <Route
            path="/admin/sign-in-accounts"
            element={<LeadershipAccountsPage currentUser={currentUser} />}
          />
          <Route
            path="/employees/new"
            element={
              <AddEmployeePage
                employees={employees}
                currentUser={currentUser}
                onAddEmployee={handleAddEmployee}
                pagePermissionOverrides={pagePermissionOverrides}
                onSaveEmployeePageAccess={handleSaveEmployeePageAccess}
                onClearEmployeePageAccessOverride={handleClearEmployeePageAccessOverride}
              />
            }
          />
          <Route
            path="/employees/:employeeId"
            element={
              <EmployeeRecordPage
                employees={employees}
                currentUser={currentUser}
                clockedInIds={clockedInIds}
                records={records}
                haulageTrips={haulageTrips}
                decorticationAssignments={decorticationAssignments}
                dryingRecords={dryingRecords}
                brushingStockMovements={brushingStockMovements}
                brushingDailyRecords={brushingDailyRecords}
                balingRecords={balingRecords}
                silageRecords={silageRecords}
              />
            }
          />
          <Route
            path="/employees/:employeeId/edit"
            element={
              <EmployeeEditPage
                employees={employees}
                currentUser={currentUser}
                pagePermissionOverrides={pagePermissionOverrides}
                dataEntryPermissionOverrides={dataEntryPermissionOverrides}
                onUpdateEmployeeRole={handleUpdateEmployeeRole}
                onSaveEmployeePageAccess={handleSaveEmployeePageAccess}
                onSaveEmployeeDataEntryPermissions={handleSaveEmployeeDataEntryPermissions}
                onUpdateEmployeeProfile={handleUpdateEmployeeProfile}
              />
            }
          />
          <Route
            path="/customers"
            element={<CustomersPage customers={customers} onAddCustomer={handleAddCustomer} />}
          />
          <Route
            path="/payroll"
            element={
              <PayrollPage
                currentUser={currentUser}
                employees={employees}
                harvestRecords={records}
                compensationRules={compensationRules}
                payrollAdjustments={payrollAdjustments}
                salaryPayrollAdjustments={salaryPayrollAdjustments}
                payrollApprovals={payrollApprovals}
                onUpdatePayrollAdjustment={handleUpdatePayrollAdjustment}
                onUpdateSalaryPayrollAdjustment={handleUpdateSalaryPayrollAdjustment}
                onApprovePayrollPeriod={handleApprovePayrollPeriod}
                onReleasePayrollPeriod={handleReleasePayrollPeriod}
              />
            }
          />
          <Route
            path="/activities/harvesting/entry"
            element={
              <HarvestWeightEntryPage
                employees={employees}
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                clockedInIds={clockedInIds}
                activeBatchNumber={activeBatchNumber}
                onSubmitRecord={handleSubmitHarvestRecord}
              />
            }
          />
          <Route
            path="/activities/harvesting"
            element={
              <HarvestingPage
                employees={employees}
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                records={records}
                compensationRules={compensationRules}
                onSaveCompensationRules={setCompensationRules}
                dateFrom={harvestingDateFrom}
                dateTo={harvestingDateTo}
                onDateFromChange={setHarvestingDateFrom}
                onDateToChange={setHarvestingDateTo}
                selectedBatchFilter={harvestingBatchFilter}
                onSelectedBatchFilterChange={setHarvestingBatchFilter}
                activeBatchNumber={activeBatchNumber}
                onSetActiveBatchNumber={setActiveBatchNumber}
              />
            }
          />
          <Route
            path="/activities/haulage"
            element={
              <HaulagePage
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                employees={employees}
                clockedInIds={clockedInIds}
                haulageTrips={haulageTrips}
                onCreateTrip={handleCreateHaulageTrip}
                mileageByDate={mileageByDate}
                onSetMileageForDate={handleSetMileageForDate}
                fuelEntries={fuelEntries}
                onAddFuelEntry={handleAddFuelEntry}
                maintenanceEntries={maintenanceEntries}
                onAddMaintenanceEntry={handleAddMaintenanceEntry}
                dateFrom={haulageDateFrom}
                dateTo={haulageDateTo}
                onDateFromChange={setHaulageDateFrom}
                onDateToChange={setHaulageDateTo}
                selectedBatchFilter={haulageBatchFilter}
                onSelectedBatchFilterChange={setHaulageBatchFilter}
                availableBatches={availableBatchNumbers}
              />
            }
          />
          <Route
            path="/activities/decortication"
            element={
              <DecorticationPage
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                employees={employees}
                clockedInIds={clockedInIds}
                decorticationAssignments={decorticationAssignments}
                decorticationRecords={decorticationRecords}
                onCreateDecorticationShift={handleCreateDecorticationAssignment}
                onUpdateDecorticationProduction={handleUpdateDecorticationProduction}
                dryingRecords={dryingRecords}
                dateFrom={decorticationDateFrom}
                dateTo={decorticationDateTo}
                onDateFromChange={setDecorticationDateFrom}
                onDateToChange={setDecorticationDateTo}
                selectedBatchFilter={decorticationBatchFilter}
                onSelectedBatchFilterChange={setDecorticationBatchFilter}
                availableBatches={availableBatchNumbers}
              />
            }
          />
          <Route
            path="/activities/drying"
            element={
              <DryingPage
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                employees={employees}
                clockedInIds={clockedInIds}
                decorticationRecords={decorticationRecords}
                dryingRecords={dryingRecords}
                onAddDryingRecord={handleAddDryingRecord}
                dateFrom={dryingDateFrom}
                dateTo={dryingDateTo}
                onDateFromChange={setDryingDateFrom}
                onDateToChange={setDryingDateTo}
                selectedBatchFilter={dryingBatchFilter}
                onSelectedBatchFilterChange={setDryingBatchFilter}
                availableBatches={availableBatchNumbers}
              />
            }
          />
          <Route
            path="/activities/brushing"
            element={
              <BrushingPage
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                employees={employees}
                clockedInIds={clockedInIds}
                dryingRecords={dryingRecords}
                brushingStockMovements={brushingStockMovements}
                brushingDailyRecords={brushingDailyRecords}
                onAddBrushingStockMovement={handleAddBrushingStockMovement}
                onAddBrushingDailyRecord={handleAddBrushingDailyRecord}
                dateFrom={brushingDateFrom}
                dateTo={brushingDateTo}
                onDateFromChange={setBrushingDateFrom}
                onDateToChange={setBrushingDateTo}
                selectedBatchFilter={brushingBatchFilter}
                onSelectedBatchFilterChange={setBrushingBatchFilter}
                availableBatches={availableBatchNumbers}
              />
            }
          />
          <Route
            path="/activities/baling"
            element={
              <BalingPage
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                employees={employees}
                clockedInIds={clockedInIds}
                availableLooseStockOptions={availableLooseStockOptions}
                balingRecords={balingRecords}
                onCreateBales={handleCreateBales}
                dateFrom={balingDateFrom}
                dateTo={balingDateTo}
                onDateFromChange={setBalingDateFrom}
                onDateToChange={setBalingDateTo}
                selectedBatchFilter={balingBatchFilter}
                onSelectedBatchFilterChange={setBalingBatchFilter}
                availableBatches={availableBatchNumbers}
              />
            }
          />
          <Route
            path="/activities/silage-production"
            element={
              <SilageProductionPage
                currentUser={currentUser}
                currentUserDataEntryPermissions={currentUserDataEntryPermissions}
                employees={employees}
                clockedInIds={clockedInIds}
                silageRecords={silageRecords}
                onCreateSilageStock={handleCreateSilageStock}
                dateFrom={silageDateFrom}
                dateTo={silageDateTo}
                onDateFromChange={setSilageDateFrom}
                onDateToChange={setSilageDateTo}
                selectedBatchFilter={silageBatchFilter}
                onSelectedBatchFilterChange={setSilageBatchFilter}
                availableBatches={availableBatchNumbers}
              />
            }
          />
          <Route
            path="/activities/invoicing"
            element={
              <InvoicingPage
                customers={customers}
                invoiceDocuments={invoiceDocuments}
                onCreateDocument={handleCreateInvoiceDocument}
                onConvertToInvoice={handleConvertProformaToInvoice}
              />
            }
          />
          <Route
            path="/activities/harvesting/records/:personId"
            element={<HarvestingRecordPage employees={employees} records={records} />}
          />
          <Route
            path="/activities/harvesting/daily/:date"
            element={<HarvestingDailyPage employees={employees} records={records} />}
          />
          {activityModules
            .filter(
              (activity) =>
                activity.id !== 'harvesting' &&
                activity.id !== 'haulage' &&
                activity.id !== 'decortication' &&
                activity.id !== 'drying' &&
                activity.id !== 'brushing' &&
                activity.id !== 'baling' &&
                activity.id !== 'silage-production' &&
                activity.id !== 'invoicing',
            )
            .map((activity) => (
            <Route
              key={activity.id}
              path={`/activities/${activity.id}`}
              element={<ActivityPage name={activity.name} summary={activity.summary} />}
            />
            ))}
          <Route
            path="/stock"
            element={
              <StockPage
                dryingRecords={dryingRecords}
                brushingStockMovements={brushingStockMovements}
                brushingDailyRecords={brushingDailyRecords}
                balingRecords={balingRecords}
                silageRecords={silageRecords}
                dateFrom={stockDateFrom}
                dateTo={stockDateTo}
                onDateFromChange={setStockDateFrom}
                onDateToChange={setStockDateTo}
                selectedBatchFilter={stockBatchFilter}
                onSelectedBatchFilterChange={setStockBatchFilter}
                availableBatches={availableBatchNumbers}
              />
            }
          />
          <Route
            path="*"
            element={
              <HomePage employees={employees} records={records} clockedInIds={clockedInIds} />
            }
          />
        </Routes>
        </GatedRoutes>
      </main>
    </div>
  )
}

export default App
