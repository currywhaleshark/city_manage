import type { TrafficSimulation } from "../simulation";
import type { CompletedTrip, Trip } from "../types";

type Observation = Pick<
  TrafficSimulation,
  "time" | "demand" | "completed" | "vehicles" | "pending" | "network"
> & { pedestrians?: TrafficSimulation["pedestrians"] };
export const PURPOSES = {
  school: "등교하는 차",
  work: "출근하는 차",
  home: "귀가하는 차",
} as const;
export const DIRECTIONS = {
  east: "동쪽으로",
  west: "서쪽으로",
  south: "남쪽으로",
  north: "북쪽으로",
} as const;
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function direction(sim: Observation, trip: Trip): keyof typeof DIRECTIONS {
  const a = sim.network.nodes.get(trip.origin)!.position;
  const b = sim.network.nodes.get(trip.destination)!.position;
  const dx = b.x - a.x,
    dz = b.z - a.z;
  return Math.abs(dx) >= Math.abs(dz)
    ? dx >= 0
      ? "east"
      : "west"
    : dz >= 0
      ? "south"
      : "north";
}

function snapshot(sim: Observation) {
  const completed = new Map(sim.completed.map((t) => [t.id, t]));
  const wait = new Map(sim.completed.map((t) => [t.id, t.waitingTime]));
  for (const v of sim.vehicles.values()) wait.set(v.id, v.waitingTime);
  for (const t of sim.pending)
    wait.set(t.id, Math.max(0, sim.time - t.departAt));
  return { completed, wait };
}

/** Reject different observation windows or demand rather than label them fair. */
export function compareExperiments(before: Observation, after: Observation) {
  const walkersBefore = before.pedestrians?.demand ?? [];
  const walkersAfter = after.pedestrians?.demand ?? [];
  if (
    walkersBefore.length !== walkersAfter.length ||
    walkersBefore.some((trip, i) =>
      (Object.keys(trip) as (keyof typeof trip)[]).some(
        (key) => trip[key] !== walkersAfter[i][key],
      ),
    )
  )
    throw new Error("비교에는 같은 보행자 출발 조건이 필요해요.");
  if (
    Math.abs(before.time - after.time) > 1e-7 ||
    before.demand.length !== after.demand.length ||
    before.demand.some((trip, i) => {
      const other = after.demand[i];
      return (Object.keys(trip) as (keyof Trip)[]).some(
        (key) => trip[key] !== other[key],
      );
    })
  )
    throw new Error("비교에는 같은 출발 조건과 관찰 시간이 필요해요.");
  const a = snapshot(before),
    b = snapshot(after);
  const common: { before: CompletedTrip; after: CompletedTrip }[] = [];
  for (const [id, first] of a.completed) {
    const second = b.completed.get(id);
    if (second) common.push({ before: first, after: second });
  }
  const matched = {
    count: common.length,
    total: before.demand.length,
    beforeTravel: mean(common.map((t) => t.before.travelTime)),
    afterTravel: mean(common.map((t) => t.after.travelTime)),
    beforeWait: mean(common.map((t) => t.before.waitingTime)),
    afterWait: mean(common.map((t) => t.after.waitingTime)),
  };
  function group(id: string, label: string, select: (t: Trip) => boolean) {
    const trips = before.demand.filter(select);
    const released = trips.filter((t) => t.departAt <= before.time + 1e-9);
    const values = (s: ReturnType<typeof snapshot>) => ({
      arrived: trips.filter((t) => s.completed.has(t.id)).length,
      averageWait: mean(released.map((t) => s.wait.get(t.id) ?? 0)),
    });
    return {
      id,
      label,
      total: trips.length,
      released: released.length,
      before: values(a),
      after: values(b),
    };
  }
  const byPurpose = Object.entries(PURPOSES).map(([id, label]) =>
    group(id, label, (t) => t.purpose === id),
  );
  const byDirection = Object.entries(DIRECTIONS).map(([id, label]) =>
    group(id, label, (t) => direction(before, t) === id),
  );
  return {
    observationSeconds: before.time,
    matched,
    byPurpose,
    byDirection,
    pedestrians: walkersBefore.length
      ? {
          total: walkersBefore.length,
          before: before.pedestrians!.stats,
          after: after.pedestrians!.stats,
        }
      : null,
  };
}

export type ExperimentComparison = ReturnType<typeof compareExperiments>;
