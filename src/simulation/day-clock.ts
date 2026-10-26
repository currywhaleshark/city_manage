/**
 * The living city's day. Vehicles and pedestrians still move in real seconds;
 * the clock is derived from elapsed time and the switch time, never stored.
 * See docs/DAILY_CYCLE.md for the chosen lengths.
 */
export const HOUR_SECONDS = 120;
export const DAY_SECONDS = 24 * HOUR_SECONDS;
/** A city switching to the daily cycle (new or loaded) starts at 07:00. */
export const START_HOUR = 7;
/** Nights fast-forward between 22:00 and 06:00. */
export const NIGHT_FROM = 22;
export const NIGHT_UNTIL = 6;
export const NIGHT_SPEED = 16;
/** The operating budget arrives once a day, at the same rate per elapsed second as before. */
export const BUDGET_HOUR = 6;
export const DAILY_BUDGET = 192;
/** Morning commute: traffic problems are judged across this window, day by day. */
export const COMMUTE_FROM = 7;
export const COMMUTE_UNTIL = 10;

export interface DayClock {
  /** 1 on the first day. */
  day: number;
  hour: number;
  minute: number;
  /** Seconds since the start of this hour, in simulation seconds. */
  intoHour: number;
  /** Hours counted from the switch, so the first scheduled hour is 0. */
  hourIndex: number;
}

export function dayClock(time: number, from: number): DayClock {
  const elapsed = Math.max(0, time - from);
  // Round to the 0.1 s engine step so boundaries never fall a hair short.
  const offset = Math.round((elapsed + START_HOUR * HOUR_SECONDS) * 10) / 10;
  const hours = Math.floor(offset / HOUR_SECONDS + 1e-9);
  const intoHour = offset - hours * HOUR_SECONDS;
  return {
    day: Math.floor(hours / 24) + 1,
    hour: hours % 24,
    minute: Math.min(59, Math.floor((intoHour / HOUR_SECONDS) * 60 + 1e-9)),
    intoHour,
    hourIndex: hours - START_HOUR,
  };
}

export const isNight = (hour: number) => hour >= NIGHT_FROM || hour < NIGHT_UNTIL;
export const inCommute = (hour: number) => hour >= COMMUTE_FROM && hour < COMMUTE_UNTIL;

/** Simulation time at which the given hour of the clock next begins (strictly after `time`). */
export function nextHourAt(time: number, from: number, hour: number) {
  const clock = dayClock(time, from);
  const startOfHour = time - clock.intoHour;
  const ahead = (hour - clock.hour + 24) % 24 || 24;
  return Math.round((startOfHour + ahead * HOUR_SECONDS) * 10) / 10;
}

/** "오전 8:10", in ten-minute steps so a one-hour trip does not read like a timetable. */
export function formatClock(clock: Pick<DayClock, "hour" | "minute">) {
  const half = clock.hour < 12 ? "오전" : "오후";
  const hour = clock.hour % 12 || 12;
  return `${half} ${hour}:${String(Math.floor(clock.minute / 10) * 10).padStart(2, "0")}`;
}

export function formatDayClock(clock: DayClock) {
  return `${clock.day}일차 ${formatClock(clock)}`;
}
