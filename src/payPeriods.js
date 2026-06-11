const PERIOD_WEEK_PATTERN = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5]

/** First day of the organisation's 4-4-5 year (Saturday 27 Dec 2025 = FY2026). */
export const FISCAL_YEAR_ANCHOR = {
  date: '2025-12-27',
  fiscalYear: 2026,
}

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

export function getFiscalYearForDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const monthDay = month * 100 + day
  if (monthDay >= 1227) {
    return year + 1
  }
  return year
}

export function getFiscalYearStartDate(fiscalYear) {
  const anchorYear = Number(FISCAL_YEAR_ANCHOR.date.slice(0, 4))
  const yearOffset = fiscalYear - FISCAL_YEAR_ANCHOR.fiscalYear
  return `${anchorYear + yearOffset}-12-27`
}

function fridayOfPeriodWeek(periodStartDateStr, weekNumber) {
  const startDay = parseDate(periodStartDateStr).getDay()
  const daysToFirstFriday = (5 - startDay + 7) % 7
  return addDays(periodStartDateStr, daysToFirstFriday + (weekNumber - 1) * 7)
}

export function build445PayPeriods(fiscalYear) {
  let periodStart = getFiscalYearStartDate(fiscalYear)
  const periods = []

  PERIOD_WEEK_PATTERN.forEach((weekCount, index) => {
    const periodEnd = fridayOfPeriodWeek(periodStart, weekCount)
    const paymentDate = addDays(periodEnd, 3)
    const advanceFriday =
      weekCount === 5 ? fridayOfPeriodWeek(periodStart, 3) : fridayOfPeriodWeek(periodStart, 2)

    periods.push({
      id: `FY${fiscalYear}-P${String(index + 1).padStart(2, '0')}`,
      year: fiscalYear,
      periodNumber: index + 1,
      weekCount,
      startDate: periodStart,
      endDate: periodEnd,
      paymentDate,
      advanceFriday,
      label: `FY${fiscalYear} Period ${index + 1} (${weekCount} weeks)`,
    })

    periodStart = addDays(periodStart, weekCount * 7)
  })

  return periods
}

export function getPayPeriodForDate(dateStr) {
  const fiscalYear = getFiscalYearForDate(dateStr)
  const candidates = [
    ...build445PayPeriods(fiscalYear),
    ...build445PayPeriods(fiscalYear - 1),
    ...build445PayPeriods(fiscalYear + 1),
  ]
  return (
    candidates.find((period) => dateStr >= period.startDate && dateStr <= period.endDate) ?? null
  )
}

export function getDefaultPayPeriodId(dateStr = new Date().toISOString().slice(0, 10)) {
  const period = getPayPeriodForDate(dateStr)
  return period?.id ?? `FY${getFiscalYearForDate(dateStr)}-P01`
}
