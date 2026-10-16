import {
  WALK_LIMIT_SECONDS,
  type FacilitySimulation,
  type ServiceKind,
} from "../simulation/facilities";
import type { WalkPoint } from "../simulation/facilities/walking";

export interface CoverageSegment {
  from: WalkPoint;
  to: WalkPoint;
}
/** Trace actual reachable sidewalks, including partial last edges and crossing wait time. */
export function facilityCoverage(sim: FacilitySimulation, kind: ServiceKind) {
  const facilities = sim.facilities.filter((f) => f.kind === kind);
  const distance = new Map<string, number>();
  for (const id of sim.walking.points.keys()) {
    distance.set(
      id,
      Math.min(
        ...facilities.map(
          (f) => sim.walking.route(f.id, id)?.seconds ?? Infinity,
        ),
      ),
    );
  }
  const segments: CoverageSegment[] = [];
  for (const [id, edges] of sim.walking.edges) {
    for (const edge of edges) {
      if (id >= edge.to || edge.meters === 0) continue;
      const from = sim.walking.points.get(id)!,
        to = sim.walking.points.get(edge.to)!;
      const fraction = (start: string) =>
        Math.max(
          0,
          Math.min(
            1,
            ((WALK_LIMIT_SECONDS -
              (distance.get(start) ?? Infinity) -
              (edge.crossing ? 15 : 0)) *
              1.2) /
              edge.meters,
          ),
        );
      const a = fraction(id),
        b = fraction(edge.to);
      const along = (t: number) => ({
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
      });
      if (a + b >= 1) segments.push({ from, to });
      else {
        if (a > 0) segments.push({ from, to: along(a) });
        if (b > 0) segments.push({ from: along(1 - b), to });
      }
    }
  }
  return { facilityIds: facilities.map((f) => f.id), segments };
}

/** A narrow, outlined ground ribbon; cells merge overlapping facilities without darker overlaps. */
export function coverageCells(
  segments: CoverageSegment[],
  size = 2,
  radius = 2.6,
) {
  const cells = new Set<string>();
  for (const { from, to } of segments) {
    const dx = to.x - from.x,
      dz = to.z - from.z,
      length2 = dx * dx + dz * dz;
    for (
      let x = Math.floor((Math.min(from.x, to.x) - radius) / size);
      x <= Math.ceil((Math.max(from.x, to.x) + radius) / size);
      x++
    ) {
      for (
        let z = Math.floor((Math.min(from.z, to.z) - radius) / size);
        z <= Math.ceil((Math.max(from.z, to.z) + radius) / size);
        z++
      ) {
        const px = (x + 0.5) * size,
          pz = (z + 0.5) * size;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((px - from.x) * dx + (pz - from.z) * dz) / (length2 || 1),
          ),
        );
        if (Math.hypot(px - from.x - t * dx, pz - from.z - t * dz) <= radius)
          cells.add(`${x},${z}`);
      }
    }
  }
  return cells;
}
