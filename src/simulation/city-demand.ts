import { nodeId, SCHOOL_NODE, seededRandom } from "../scenario";
import { boundaryNode } from "../city/world";
import { HOUR_SECONDS } from "./day-clock";
import type { Trip } from "../types";

export const CITY_TRAFFIC_INTERVAL = 300;
export const CITY_TRAFFIC_COUNT = 90;
/** Rush hour: work trips across the river start within this many seconds. */
export const EAST_RUSH_WINDOW = 40;

/**
 * City life has several destinations; the school experiment keeps its own demand.
 * With `rush`, commutes into the commercial and industrial districts crowd the
 * start of the cycle.
 * The same random draws are used either way, so only those departure times move.
 */
export function createCityDemand(
  seed: number,
  production = false,
  rush = false,
): readonly Trip[] {
  const random = seededRandom(seed);
  const pick = (first: number, count: number) => first + Math.floor(random() * count);
  const colors = [0xe6ac46, 0xf6eee2, 0x5a8db9, 0xc57463, 0x558978, 0x8496a2];
  const trips: Trip[] = [];
  const count = CITY_TRAFFIC_COUNT + (production ? 20 : 0);
  for (let id = 0; id < count; id++) {
    const home = nodeId(pick(0, 2), pick(0, 9));
    let center = nodeId(pick(2, 3), pick(0, 9));
    if (center === SCHOOL_NODE) center = nodeId(3, 3);
    const commerce = nodeId(pick(5, 4), pick(0, 3));
    const industry = nodeId(pick(5, 4), pick(3, 6));
    const batch = Math.floor(id / 18);
    const gate = boundaryNode(
      batch % 2 === 0 ? "east" : "west",
      Math.floor(batch / 2) % 2 === 0 ? 0 : 1,
    );
    // 10 school, 20 west-local, 30 cross-river, 20 east-local and 10 border
    // journeys per cycle. Return journeys keep both banks active.
    const pairs: [string, string, Trip["purpose"]][] = [
      [home, SCHOOL_NODE, "school"],
      [SCHOOL_NODE, home, "home"],
      [home, center, "work"],
      [center, home, "home"],
      [home, center, "work"],
      [center, home, "home"],
      [home, commerce, "work"],
      [commerce, home, "home"],
      [home, industry, "work"],
      [industry, home, "home"],
      [center, commerce, "work"],
      [commerce, center, "work"],
      [commerce, industry, "work"],
      [industry, commerce, "work"],
      [commerce, industry, "work"],
      [industry, commerce, "work"],
      [gate, industry, "work"],
      [industry, gate, "home"],
    ];
    const extra = id - CITY_TRAFFIC_COUNT;
    const workerHome =
      Math.floor(extra / 2) % 2 === 0
        ? home
        : boundaryNode("east", Math.floor(extra / 4) % 2 === 0 ? 0 : 1);
    const [origin, destination, purpose] =
      extra < 0
        ? pairs[id % pairs.length]
        : extra % 2 === 0
          ? [workerHome, industry, "work" as const]
          : [industry, workerHome, "home" as const];
    // Spread departures through the whole cycle. Extra factory trips don't
    // move or replace the base trips when the production policy is applied.
    const slot = extra < 0 ? id / CITY_TRAFFIC_COUNT : extra / 20;
    const crowded = rush && purpose === "work" &&
      (destination === industry || destination === commerce);
    const spread = crowded ? EAST_RUSH_WINDOW : 280;
    trips.push(
      Object.freeze({
        id,
        origin,
        destination,
        purpose,
        departAt: Math.round((5 + slot * spread + random() * 3) * 10) / 10,
        targetSpeed: 7.5 + random() * 2,
        color: colors[pick(0, colors.length)],
      }),
    );
  }
  return Object.freeze(
    trips.sort((a, b) => a.departAt - b.departAt || a.id - b.id),
  );
}

/**
 * The daily cycle keeps today's average load: 90 trips every 300 s over the
 * 1,920 s from 06:00 to 22:00 is 576 trips, shared out by hour (percent).
 * See docs/DAILY_CYCLE.md.
 */
export const DAILY_TRIPS = 576;
const ACTIVE_SHARES: Readonly<Record<number, number>> = {
  6: 5, 7: 8, 8: 9, 9: 7, 10: 5, 11: 4, 12: 6, 13: 4,
  14: 4, 15: 6, 16: 5, 17: 9, 18: 10, 19: 7, 20: 6, 21: 5,
};
/** A few drivers still cross the border at night. */
const NIGHT_TRIPS: Readonly<Record<number, number>> = {
  22: 3, 23: 2, 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 2,
};
/** Integer counts per hour; the active hours add up to exactly `total`. */
function allocate(total: number) {
  const hours = Object.keys(ACTIVE_SHARES).map(Number);
  const exact = hours.map((h) => (total * ACTIVE_SHARES[h]) / 100);
  const counts = exact.map(Math.floor);
  const order = hours
    .map((_, i) => i)
    .sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]) || a - b);
  const missing = total - counts.reduce((n, c) => n + c, 0);
  for (let k = 0; k < missing; k++) counts[order[k]]++;
  return Array.from({ length: 24 }, (_, h) => {
    const i = hours.indexOf(h);
    return i >= 0 ? counts[i] : 0;
  });
}
export const HOURLY_TRIPS: readonly number[] = Object.freeze(
  allocate(DAILY_TRIPS).map((n, h) => n + (NIGHT_TRIPS[h] ?? 0)),
);
/** Pedestrians keep today's 60 per 300 s over the active hours and rest at night. */
export const DAILY_PEDESTRIANS = 384;
export const HOURLY_PEDESTRIANS: readonly number[] = Object.freeze(
  allocate(DAILY_PEDESTRIANS),
);

type Pair = [string, string, Trip["purpose"]];
/**
 * Departures for one clock hour, relative to the start of that hour.
 * Mornings head out to school and work, evenings head home; in between,
 * businesses trade across the river and a few drivers use the border.
 * With `rush`, morning commutes into the commercial and industrial districts
 * leave within the first 40 s (20 clock minutes) of the hour.
 */
export function createHourlyDemand(
  seed: number,
  hour: number,
  production = false,
  rush = false,
): readonly Trip[] {
  const random = seededRandom(seed);
  const pick = (first: number, count: number) => first + Math.floor(random() * count);
  const colors = [0xe6ac46, 0xf6eee2, 0x5a8db9, 0xc57463, 0x558978, 0x8496a2];
  const morning = hour >= 6 && hour < 10;
  const homeward = hour >= 17 && hour < 19;
  const night = hour >= 22 || hour < 6;
  const extra = production && (morning || (hour >= 16 && hour < 20))
    ? Math.round((HOURLY_TRIPS[hour] * 20) / CITY_TRAFFIC_COUNT)
    : 0;
  const trips: Trip[] = [];
  const count = HOURLY_TRIPS[hour] + extra;
  for (let id = 0; id < count; id++) {
    const home = nodeId(pick(0, 2), pick(0, 9));
    let center = nodeId(pick(2, 3), pick(0, 9));
    if (center === SCHOOL_NODE) center = nodeId(3, 3);
    const commerce = nodeId(pick(5, 4), pick(0, 3));
    const industry = nodeId(pick(5, 4), pick(3, 6));
    const gate = boundaryNode(random() < 0.5 ? "east" : "west", random() < 0.5 ? 0 : 1);
    const pairs: Pair[] = night
      ? [[gate, industry, "work"], [industry, gate, "home"]]
      : morning
        ? [
            ...(hour === 7 || hour === 8
              ? ([[home, SCHOOL_NODE, "school"], [home, SCHOOL_NODE, "school"]] as Pair[])
              : []),
            [home, center, "work"],
            [home, center, "work"],
            [home, commerce, "work"],
            [home, industry, "work"],
            [gate, industry, "work"],
            [center, commerce, "work"],
          ]
        : homeward
          ? [
              [center, "", "home"],
              [center, "", "home"],
              [commerce, "", "home"],
              [industry, "", "home"],
              [industry, gate, "home"],
              [commerce, industry, "work"],
            ]
          : hour >= 19
            ? [
                [home, commerce, "work"],
                [commerce, "", "home"],
                [center, "", "home"],
                [home, center, "work"],
              ]
            : [
                ...(hour === 15
                  ? ([[SCHOOL_NODE, "", "school"], [SCHOOL_NODE, "", "school"]] as Pair[])
                  : []),
                [center, commerce, "work"],
                [commerce, center, "work"],
                [commerce, industry, "work"],
                [industry, commerce, "work"],
                [gate, industry, "work"],
                [industry, gate, "home"],
                [home, center, "work"],
                [center, "", "home"],
              ];
    const workerHome = random() < 0.5
      ? home
      : boundaryNode("east", random() < 0.5 ? 0 : 1);
    const isExtra = id >= HOURLY_TRIPS[hour];
    let [origin, destination, purpose] = isExtra
      ? hour < 12
        ? [workerHome, industry, "work" as const]
        : [industry, workerHome, "home" as const]
      : pairs[pick(0, pairs.length)];
    // An empty destination is the trip home; school pickups also end at home.
    if (destination === "") destination = home;
    if (purpose === "school" && origin === SCHOOL_NODE) purpose = "home";
    const crowded = rush && morning && purpose === "work" &&
      (destination === industry || destination === commerce);
    const spread = crowded ? EAST_RUSH_WINDOW : HOUR_SECONDS - 3;
    trips.push(
      Object.freeze({
        id,
        origin,
        destination,
        purpose,
        departAt: Math.round((random() * spread + random() * 3) * 10) / 10,
        targetSpeed: 7.5 + random() * 2,
        color: colors[pick(0, colors.length)],
      }),
    );
  }
  return Object.freeze(
    trips.sort((a, b) => a.departAt - b.departAt || a.id - b.id),
  );
}
