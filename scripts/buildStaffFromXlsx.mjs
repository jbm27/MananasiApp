import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const xlsxPath = path.join(root, 'EmployeeDataBase.xlsx')
const outPath = path.join(root, 'src', 'mananasiStaffEmployees.js')

const wb = XLSX.readFile(xlsxPath)
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])

function mapRole(r) {
  const k = String(r ?? '')
    .trim()
    .toLowerCase()
  const m = {
    admin: 'admin',
    'harvesting manager': 'harvesting-manager',
    'production manager': 'production-manager',
    'harvesting supervisor': 'harvesting-supervisor',
    harvesting: 'harvester',
    production: 'decorticator-operator',
    'lorry driver': 'truck-driver',
    'bus driver': 'truck-driver',
    'head technician': 'decortication-supervisor',
    'quality control': 'decortication-supervisor',
    hr: 'general-staff',
    'hr and admin': 'general-staff',
    accountant: 'general-staff',
    messenger: 'general-staff',
    'stores manager': 'general-staff',
    technician: 'decorticator-operator',
    electrician: 'general-staff',
    plumber: 'general-staff',
  }
  return m[k] ?? 'general-staff'
}

function esc(s) {
  return JSON.stringify(String(s ?? '').trim()).slice(1, -1)
}

const employees = rows.map((row, i) => {
  const id = `EMP-${String(i + 1).padStart(3, '0')}`
  const name = String(row['EMPLOYEE NAME'] ?? '').trim()
  const role = mapRole(row['Role'])
  const phone = String(row['PHONE NUMBER'] ?? '').trim()
  const idNumber = String(row['ID NUMBER'] ?? '').trim()
  const nssfNumber = String(row['NSSF NUMBER'] ?? '').trim()
  const pinNumber = String(row['KRA PIN NUMBER'] ?? '').trim()
  const bankName = String(row['BANK NAME'] ?? '').trim()
  const bankAccountNumber = String(row['BANK ACCOUNT NUMBER'] ?? '').trim()
  return { id, name, role, phone, idNumber, nssfNumber, pinNumber, bankName, bankAccountNumber }
})

const lines = [
  '/** Mananasi staff imported from EmployeeDataBase.xlsx — run `node scripts/buildStaffFromXlsx.mjs` after updating the spreadsheet. */',
  'export const mananasiStaffEmployees = [',
]

for (const e of employees) {
  lines.push('  {')
  lines.push(`    id: '${esc(e.id)}',`)
  lines.push(`    name: '${esc(e.name)}',`)
  lines.push(`    role: '${e.role}',`)
  lines.push(`    phone: '${esc(e.phone)}',`)
  lines.push(`    idNumber: '${esc(e.idNumber)}',`)
  lines.push(`    nssfNumber: '${esc(e.nssfNumber)}',`)
  lines.push(`    pinNumber: '${esc(e.pinNumber)}',`)
  lines.push(`    bankName: '${esc(e.bankName)}',`)
  lines.push(`    bankAccountNumber: '${esc(e.bankAccountNumber)}',`)
  lines.push('  },')
}

lines.push(']')
lines.push('')

fs.writeFileSync(outPath, lines.join('\n'), 'utf8')
const admin = employees.find((e) => e.role === 'admin')
console.log(`Wrote ${employees.length} employees to ${path.relative(root, outPath)}`)
console.log(`Admin: ${admin?.name} (${admin?.id})`)
