import test from "node:test";
import assert from "node:assert/strict";
import { canContactNow, isBusinessDay, isQuietTime, localClock, normalizeSchedule, shouldRunAt } from "./tenant-schedule.js";

test("calcula la hora local del tenant y no la hora del servidor", () => {
  const clock = localClock(new Date("2026-08-11T13:30:00Z"), "America/Santo_Domingo");
  assert.equal(clock.date, "2026-08-11");
  assert.equal(clock.time, "09:30");
  assert.equal(clock.weekday, 2);
});

test("contacta solo dentro del horario comercial del cliente", () => {
  const schedule = normalizeSchedule({ businessDays: [2], businessStart: "09:00", businessEnd: "18:00", quietStart: "20:00", quietEnd: "08:00" });
  assert.equal(canContactNow(new Date("2026-08-11T13:30:00Z"), "America/Santo_Domingo", schedule), true);
  assert.equal(canContactNow(new Date("2026-08-11T23:30:00Z"), "America/Santo_Domingo", schedule), false);
});

test("respeta días laborables y feriados", () => {
  const schedule = normalizeSchedule({ holidays: ["2026-08-11"] });
  const holiday = localClock(new Date("2026-08-11T13:00:00Z"), "America/Santo_Domingo");
  const saturday = localClock(new Date("2026-08-15T13:00:00Z"), "America/Santo_Domingo");
  assert.equal(isBusinessDay(holiday, schedule), false);
  assert.equal(isBusinessDay(saturday, schedule), false);
});

test("las horas silenciosas pueden cruzar medianoche", () => {
  const schedule = normalizeSchedule({ quietStart: "20:00", quietEnd: "08:00" });
  assert.equal(isQuietTime({ date: "2026-08-11", weekday: 2, time: "23:00", minutes: 1380 }, schedule), true);
  assert.equal(isQuietTime({ date: "2026-08-12", weekday: 3, time: "07:59", minutes: 479 }, schedule), true);
  assert.equal(isQuietTime({ date: "2026-08-12", weekday: 3, time: "09:00", minutes: 540 }, schedule), false);
});

test("solo ejecuta a la hora local configurada fuera del silencio", () => {
  const schedule = normalizeSchedule({ dailyReportTime: "18:00" });
  const clock = { date: "2026-08-11", weekday: 2, time: "18:00", minutes: 1080 };
  assert.equal(shouldRunAt(clock, schedule.dailyReportTime, schedule), true);
});
