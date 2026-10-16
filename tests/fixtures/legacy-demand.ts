import { seededRandom, nodeId } from "../../src/scenario";
import type { Trip } from "../../src/types";
/** Frozen v4 school-neighborhood demand, only for the historical engine regression. */
export function legacyDemand(seed: number): readonly Trip[] {
  const random = seededRandom(seed),
    count = 140;
  const colors = [0xe6ac46, 0xf6eee2, 0x5a8db9, 0xc57463, 0x558978, 0x8496a2];
  const trips: Trip[] = [];
  for (let id = 0; id < count; id++) {
    const reverse = random() < 0.13,
      school = random() < 0.64;
    const origin = reverse
      ? nodeId(4, 1 + Math.floor(random() * 3))
      : nodeId(Math.floor(random() * 2), Math.floor(random() * 5));
    const destination = reverse
      ? nodeId(0, 1 + Math.floor(random() * 3))
      : school
        ? nodeId(3, 2)
        : nodeId(4, Math.floor(random() * 3));
    trips.push(
      Object.freeze({
        id,
        origin,
        destination,
        departAt:
          Math.round(
            (5 + Math.pow(id / count, 0.82) * 205 + random() * 3) * 10,
          ) / 10,
        purpose: reverse ? "home" : school ? "school" : "work",
        targetSpeed: 7.5 + random() * 2,
        color: colors[Math.floor(random() * colors.length)],
      }),
    );
  }
  return Object.freeze(
    trips.sort((a, b) => a.departAt - b.departAt || a.id - b.id),
  );
}
