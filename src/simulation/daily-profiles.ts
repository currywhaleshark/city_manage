/**
 * How everyday life varies over the clock in phase 1b of the daily cycle
 * (docs/DAILY_CYCLE.md). Nights are quiet: households make little waste
 * and shops are closed. Factors multiply the rates the services already use.
 */
const byHour = (spans: readonly [from: number, to: number, value: number][]) =>
  Object.freeze(
    Array.from({ length: 24 }, (_, h) => spans.find(([a, b]) => h >= a && h < b)?.[2] ?? 0),
  );

/** Household waste: little at night, more around breakfast and in the evening. */
export const WASTE_BY_HOUR = byHour([
  [0, 6, 0.1],
  [6, 9, 1.1],
  [9, 18, 0.9],
  [18, 22, 1.4],
  [22, 24, 0.3],
]);
/**
 * Shop sales: closed 22:00–08:00, busiest after work. A day's sales (about
 * 540 boxes) slightly exceed what two delivery trucks bring (about 500), so
 * evenings run short until deliveries improve.
 */
export const SALES_BY_HOUR = byHour([
  [8, 10, 0.4],
  [10, 17, 0.7],
  [17, 21, 1],
  [21, 22, 0.4],
]);
/** Residents carry rubbish out (or dump it) only while they are up. */
export const DISPOSAL_HOURS = { from: 6, until: 22 } as const;
/** When drivers stop at each parking site; nobody arrives outside these hours. */
export const PARKING_HOURS: Readonly<Record<string, readonly [number, number][]>> = {
  school: [[7, 9], [14, 16]],
  market: [[10, 21]],
  homes: [[6, 8], [17, 23]],
  "east-market": [[9, 20]],
};
export const parkingOpen = (siteId: string, hour: number) =>
  (PARKING_HOURS[siteId] ?? [[6, 22]]).some(([a, b]) => hour >= a && hour < b);
