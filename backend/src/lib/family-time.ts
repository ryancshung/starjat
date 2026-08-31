export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  date: string;
  time: string;
};

const weekdayMap: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  return {
    year, month, day, hour, minute,
    weekday: weekdayMap[value('weekday')] ?? 0,
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
) {
  let result = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 3; i += 1) {
    const actual = localParts(result, timezone);
    const desiredStamp = Date.UTC(year, month - 1, day, hour, minute);
    const actualStamp = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    result = new Date(result.getTime() + desiredStamp - actualStamp);
  }
  return result;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type ScheduleRule = {
  frequency: string;
  localTime: string;
  weekday: number | null;
  dayOfMonth: number | null;
};

export function nextScheduledRun(rule: ScheduleRule, timezone: string, after: Date) {
  const base = localParts(after, timezone);
  const [hour, minute] = rule.localTime.split(':').map(Number);
  const cursor = new Date(Date.UTC(base.year, base.month - 1, base.day));
  for (let offset = 0; offset < 370; offset += 1) {
    const candidateDay = new Date(cursor.getTime() + offset * 86400000);
    const year = candidateDay.getUTCFullYear();
    const month = candidateDay.getUTCMonth() + 1;
    const day = candidateDay.getUTCDate();
    const weekday = candidateDay.getUTCDay();
    const matches = rule.frequency === 'daily'
      || (rule.frequency === 'weekly' && weekday === (rule.weekday ?? base.weekday))
      || (rule.frequency === 'monthly' && day === Math.min(rule.dayOfMonth ?? base.day, daysInMonth(year, month)));
    if (!matches) continue;
    const utc = zonedTimeToUtc(year, month, day, hour, minute, timezone);
    if (utc.getTime() > after.getTime()) return utc;
  }
  throw new Error('無法計算下一次派發時間');
}

export function monthBounds(month: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('INVALID_MONTH');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('INVALID_MONTH');
  const start = zonedTimeToUtc(year, monthNumber, 1, 0, 0, timezone);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const end = zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, timezone);
  return { start, end };
}
