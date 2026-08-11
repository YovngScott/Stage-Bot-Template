export interface TenantSchedule {
  businessDays: number[];
  businessStart: string;
  businessEnd: string;
  quietStart: string;
  quietEnd: string;
  holidays: string[];
  appointmentReminderTime: string;
  dailyReportTime: string;
}

export interface LocalClock {
  date: string;
  weekday: number;
  time: string;
  minutes: number;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function validTime(value: unknown, fallback: string): string {
  const text = String(value ?? "");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return fallback;
  return text;
}

export function normalizeSchedule(raw: any, dailyReportFallback = "20:00"): TenantSchedule {
  const businessDays: number[] = Array.isArray(raw?.businessDays)
    ? [...new Set<number>((raw.businessDays as unknown[]).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [1, 2, 3, 4, 5];
  const holidays: string[] = Array.isArray(raw?.holidays)
    ? [...new Set<string>((raw.holidays as unknown[]).map(String).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
    : [];
  return {
    businessDays,
    businessStart: validTime(raw?.businessStart, "09:00"),
    businessEnd: validTime(raw?.businessEnd, "18:00"),
    quietStart: validTime(raw?.quietStart, "20:00"),
    quietEnd: validTime(raw?.quietEnd, "08:00"),
    holidays,
    appointmentReminderTime: validTime(raw?.appointmentReminderTime, "09:00"),
    dailyReportTime: validTime(raw?.dailyReportTime, dailyReportFallback),
  };
}

export function localClock(date: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: WEEKDAY[value("weekday")] ?? 0,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute,
  };
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function isQuietTime(clock: LocalClock, schedule: TenantSchedule): boolean {
  const start = timeMinutes(schedule.quietStart);
  const end = timeMinutes(schedule.quietEnd);
  if (start === end) return false;
  return start < end
    ? clock.minutes >= start && clock.minutes < end
    : clock.minutes >= start || clock.minutes < end;
}

export function isBusinessDay(clock: LocalClock, schedule: TenantSchedule): boolean {
  return schedule.businessDays.includes(clock.weekday) && !schedule.holidays.includes(clock.date);
}

export function shouldRunAt(clock: LocalClock, expectedTime: string, schedule: TenantSchedule): boolean {
  return clock.time === expectedTime && isBusinessDay(clock, schedule) && !isQuietTime(clock, schedule);
}

export function canContactNow(date: Date, timeZone: string, schedule: TenantSchedule): boolean {
  const clock = localClock(date, timeZone);
  const start = timeMinutes(schedule.businessStart);
  const end = timeMinutes(schedule.businessEnd);
  return isBusinessDay(clock, schedule) && !isQuietTime(clock, schedule) && clock.minutes >= start && clock.minutes < end;
}
