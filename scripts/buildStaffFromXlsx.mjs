import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const xlsxPath = path.join(root, 'Employee Database App - Contract Dates Filled.xlsx')
const outPath = path.join(root, 'src', 'mananasiStaffEmployees.js')

function parseNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseIsoDate(value) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, day, month, year] = slash
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  return raw
}

function normalizeContractType(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
  if (key.startsWith('regular')) {
    return 'regular'
  }
  if (key.startsWith('season')) {
    return 'seasonal'
  }
  if (key.startsWith('suppl')) {
    return 'supplementary'
  }
  return 'regular'
}

function normalizeSeasonalGrade(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  if (key === 'grade1' || key === 'grade-1') {
    return 'grade-1'
  }
  if (key === 'grade2' || key === 'grade-2') {
    return 'grade-2'
  }
  if (key === 'grade3' || key === 'grade-3') {
    return 'grade-3'
  }
  return null
}

function mapPositionToRole(position) {
  const key = String(position ?? '')
    .trim()
    .toLowerCase()

  const exact = {
    'business unit manager': 'admin',
    'harvesting manager': 'harvesting-manager',
    'harvesting supervisor': 'harvesting-supervisor',
    harvester: 'harvester',
    'decortication and brushing manager': 'production-manager',
    'head technician': 'decortication-supervisor',
    'human resource officer': 'general-staff',
    accountant: 'general-staff',
    'rider messenger': 'general-staff',
    'stores attendant': 'general-staff',
    'quality control and operations assistant': 'decortication-supervisor',
    'lorry driver': 'truck-driver',
    'bus driver': 'truck-driver',
    'decorticator attendant': 'decorticator-operator',
    'decorticator operator': 'decorticator-operator',
    'fibre lines attendant': 'decorticator-operator',
    brusher: 'brusher',
    loader: 'loader',
    'silage attendant': 'silage-operator',
    'machine technician': 'decorticator-operator',
    'electrical technician': 'general-staff',
    electrician: 'general-staff',
    plumber: 'general-staff',
    cleaner: 'general-staff',
    sorting: 'decorticator-operator',
    'grounds man': 'general-staff',
  }

  return exact[key] ?? 'general-staff'
}

const wb = XLSX.readFile(xlsxPath)
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })

const employees = rows
  .map((row) => {
    const workNo = String(row['WORK NO.'] ?? '').trim()
    const name = String(row['EMPLOYEE NAME'] ?? '').trim()
    if (!workNo || !name) {
      return null
    }

    const contractType = normalizeContractType(row['Contract type'])
    const dailyWageKes = parseNumber(row['Daily wage'])
    const monthlySalaryKes = parseNumber(row.SALARY)

    return {
      id: workNo,
      name,
      role: mapPositionToRole(row.POSITION),
      contractType,
      seasonalGrade: contractType === 'seasonal' ? normalizeSeasonalGrade(row['Job Grade']) : null,
      dailyWageKes: contractType === 'regular' ? null : dailyWageKes,
      monthlySalaryKes: contractType === 'regular' ? monthlySalaryKes : null,
      position: String(row.POSITION ?? '').trim(),
      department: String(row.DEPARTMENT ?? '').trim(),
      phone: String(row['PHONE NUMBER'] ?? '').trim(),
      email: String(row['EMAIL ADDRESS'] ?? '').trim(),
      idNumber: String(row['ID NUMBER'] ?? '').trim(),
      nssfNumber: String(row['NSSF NUMBER'] ?? '').trim(),
      pinNumber: String(row['KRA PIN'] ?? '').trim(),
      bankName: String(row['BANK NAME'] ?? '').trim(),
      bankAccountNumber: String(row['BANK ACCOUNT NUMBER'] ?? '').trim(),
      contractStartDate: parseIsoDate(row['CONTRACT START DATE']),
      contractEndDate: parseIsoDate(row['CONTRACT END DATE']),
      reportingManager: String(row['REPORTING MANAGER'] ?? '').trim(),
    }
  })
  .filter(Boolean)
  .sort((a, b) => Number(a.id) - Number(b.id))

const fileBody = `/** Mananasi staff imported from Employee Database App - Contract Dates Filled.xlsx — run \`node scripts/buildStaffFromXlsx.mjs\` after updating the spreadsheet. */
export const mananasiStaffEmployees = ${JSON.stringify(employees, null, 2)}
`

fs.writeFileSync(outPath, fileBody, 'utf8')

const admin = employees.find((employee) => employee.role === 'admin')
console.log(`Wrote ${employees.length} employees to ${path.relative(root, outPath)}`)
console.log(`Admin: ${admin?.name} (${admin?.id})`)
console.log(
  'Contracts:',
  employees.reduce((counts, employee) => {
    counts[employee.contractType] = (counts[employee.contractType] ?? 0) + 1
    return counts
  }, {}),
)
