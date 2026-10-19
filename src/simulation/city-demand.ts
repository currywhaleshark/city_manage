import { nodeId, SCHOOL_NODE, seededRandom } from "../scenario";
import { boundaryNode } from "../city/world";
import type { Trip } from "../types";

export const CITY_TRAFFIC_INTERVAL = 300;
export const CITY_TRAFFIC_COUNT = 90;

/** City life has several destinations; the school experiment keeps its own demand. */
export function createCityDemand(
  seed: number,
  production = false,
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
    trips.push(
      Object.freeze({
        id,
        origin,
        destination,
        purpose,
        departAt: Math.round((5 + slot * 280 + random() * 3) * 10) / 10,
        targetSpeed: 7.5 + random() * 2,
        color: colors[pick(0, colors.length)],
      }),
    );
  }
  return Object.freeze(
    trips.sort((a, b) => a.departAt - b.departAt || a.id - b.id),
  );
}
