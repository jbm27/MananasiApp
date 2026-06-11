const PERIOD_WEEK_PATTERN = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5]

function toDateString(date) {
  return date.toISOString().slice(0, 10)
}

function parseDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`)
}

function addDays(dateStr, days) {
  const next = parseDate(dateStr)
  next.setDate(next.getDate() + days)
  return toDateString(next)
}

function firstMondayOnOrAfter(dateStr) {
  const cursor = parseDate(dateStr)
  while (cursor.getDay() !== 1) {
    cursor.setDate(cursor.getDate() + 1)
  }
  return toDateString(cursor)
}

function fridayOfWeekStarting(mondayDateStr, weekIndex) {
  return addDays(mondayDateStr, weekIndex * 7 + 4)
}

export function build445PayPeriods(year) {
  let periodStart = firstMondayOnOrAfter(`${year}-01-01`)
  const periods = []

  PERIOD_WEEK_PATTERN.forEach((weekCount, index) => {
    const periodEnd = fridayOfWeekStarting(periodStart, weekCount - 1)
    const paymentDate = addDays(periodEnd, 3)
    const advanceFriday =
      weekCount === 5
        ? fridayOfWeekStarting(periodStart, 2)
        : fridayOfWeekStarting(periodStart, 1)

    periods.push({
      id: `${year}-P${String(index + 1).padStart(2, '0')}`,
      year,
      periodNumber: index + 1,
      weekCount,
      startDate: periodStart,
      endDate: periodEnd,
      paymentDate,
      advanceFriday,
      label: `${year} Period ${index + 1} (${weekCount} weeks)`,
    })

    periodStart = addDays(periodEnd, 3)
  })

  return periods
}

export function getPayPeriodForDate(dateStr, year = Number(dateStr.slice(0, 4))) {
  const periods = build445PayPeriods(year)
  const match = periods.find(
    (period) => dateStr >= period.startDate && dateStr <= period.endDate,
  )
  if (match) {
    return match
  }
  const previousYearPeriods = build445PayPeriods(year - 1)
  return (
    previousYearPeriods.find(
      (period) => dateStr >= period.startDate && dateStr <= period.endDate,
    ) ??
    periods[0] ??
    null
  )
}

export function getDefaultPayPeriodId(dateStr = new Date().toISOString().slice(0, 10)) {
  const period = getPayPeriodForDate(dateStr)
  return period?.id ?? `${dateStr.slice(0, 4)}-P01`
}
