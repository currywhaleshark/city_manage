import { CONFIG } from "../scenario";
import type { Crossing, Network, Pose } from "../types";
import { crossingPose } from "./network";

// Local swept footprints are reused across identical junctions and experiments.
// A 0.1 m path sample, 0.22 m padding and cell-intersection inflation provide
// conservative separation, including the approach and the clearing vehicle tail.
const CELL = 0.25;
const PADDING = 0.22;
const profiles = new Map<string, Set<string>>();
const matrix = new Map<string, boolean>();
export const CLEAR_DISTANCE = CONFIG.carLength + CONFIG.minimumGap;
export function sameMovement(a: Crossing, b: Crossing) {
  return (
    a.nodeId === b.nodeId &&
    a.fromLaneId === b.fromLaneId &&
    a.nextLaneId === b.nextLaneId
  );
}

function profile(network: Network, movement: Crossing) {
  const origin = network.nodes.get(movement.nodeId)!.position;
  const key = movement.points
    .map((p) => `${(p.x - origin.x).toFixed(4)},${(p.z - origin.z).toFixed(4)}`)
    .join(";");
  const cached = profiles.get(key);
  if (cached) return { key, cells: cached };
  const cells = new Set<string>();
  function mark(p: Pose) {
    const x = p.x - origin.x,
      z = p.z - origin.z;
    const fx = Math.sin(p.angle),
      fz = Math.cos(p.angle);
    const halfLength = CONFIG.carLength / 2 + PADDING + CELL / Math.SQRT2;
    const halfWidth = CONFIG.carWidth / 2 + PADDING + CELL / Math.SQRT2;
    const radius = Math.hypot(halfLength, halfWidth);
    for (
      let ix = Math.floor((x - radius) / CELL);
      ix <= Math.floor((x + radius) / CELL);
      ix++
    ) {
      for (
        let iz = Math.floor((z - radius) / CELL);
        iz <= Math.floor((z + radius) / CELL);
        iz++
      ) {
        const dx = (ix + 0.5) * CELL - x,
          dz = (iz + 0.5) * CELL - z;
        if (
          Math.abs(dx * fx + dz * fz) <= halfLength &&
          Math.abs(dx * fz - dz * fx) <= halfWidth
        )
          cells.add(`${ix},${iz}`);
      }
    }
  }
  const start = crossingPose(movement, 0),
    end = crossingPose(movement, movement.length);
  for (let d = -12; d < 0; d += 0.1)
    mark({
      x: start.x + Math.sin(start.angle) * d,
      z: start.z + Math.cos(start.angle) * d,
      angle: start.angle,
    });
  const count = Math.ceil(movement.length / 0.1);
  for (let i = 0; i <= count; i++)
    mark(crossingPose(movement, (movement.length * i) / count));
  for (let d = 0.1; d <= CLEAR_DISTANCE + 0.1; d += 0.1)
    mark({
      x: end.x + Math.sin(end.angle) * d,
      z: end.z + Math.cos(end.angle) * d,
      angle: end.angle,
    });
  profiles.set(key, cells);
  return { key, cells };
}

/** Entire movements reserve disjoint swept space, not just their centre lines. */
export function movementsConflict(
  network: Network,
  a: Crossing,
  b: Crossing,
): boolean {
  if (a.nodeId !== b.nodeId) return false;
  if (
    a.fromLaneId === b.fromLaneId ||
    (a.nextLaneId && a.nextLaneId === b.nextLaneId)
  )
    return true;
  const pa = profile(network, a),
    pb = profile(network, b);
  const key = [pa.key, pb.key].sort().join("|");
  const cached = matrix.get(key);
  if (cached !== undefined) return cached;
  const conflict = [...pa.cells].some((cell) => pb.cells.has(cell));
  matrix.set(key, conflict);
  return conflict;
}
