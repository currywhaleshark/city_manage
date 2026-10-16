import { createNetwork, nodeId } from "../../scenario";
import { WORLD } from "../../city/world";
export interface WalkPoint {
  x: number;
  z: number;
}
export interface WalkEdge {
  to: string;
  meters: number;
  crossing: boolean;
}
export interface WalkRoute {
  meters: number;
  seconds: number;
  path: WalkPoint[];
}
/** A planning graph of sidewalks and crossings, independent of the four animated pedestrian routes. */
export class WalkingNetwork {
  readonly points = new Map<string, WalkPoint>();
  readonly edges = new Map<string, WalkEdge[]>();
  private routes = new Map<
    string,
    {
      distance: Map<string, number>;
      previous: Map<string, { id: string; edge: WalkEdge }>;
    }
  >();
  addPoint(id: string, point: WalkPoint) {
    this.routes.clear();
    this.points.set(id, point);
    this.edges.set(id, []);
  }
  connect(a: string, b: string, crossing = false) {
    this.routes.clear();
    const p = this.points.get(a)!,
      q = this.points.get(b)!;
    const meters = Math.hypot(p.x - q.x, p.z - q.z);
    this.edges.get(a)!.push({ to: b, meters, crossing });
    this.edges.get(b)!.push({ to: a, meters, crossing });
  }
  route(from: string, to: string): WalkRoute | null {
    if (!this.points.has(from) || !this.points.has(to)) return null;
    let tree = this.routes.get(from);
    if (!tree) {
      const distance = new Map<string, number>([[from, 0]]),
        previous = new Map<string, { id: string; edge: WalkEdge }>();
      const unvisited = new Set(this.points.keys());
      while (unvisited.size) {
        let id: string | undefined,
          best = Infinity;
        for (const key of unvisited)
          if ((distance.get(key) ?? Infinity) < best) {
            id = key;
            best = distance.get(key)!;
          }
        if (!id) break;
        unvisited.delete(id);
        for (const edge of this.edges.get(id)!) {
          const next = best + edge.meters / 1.2 + (edge.crossing ? 15 : 0);
          if (next < (distance.get(edge.to) ?? Infinity) - 1e-8) {
            distance.set(edge.to, next);
            previous.set(edge.to, { id, edge });
          }
        }
      }
      tree = { distance, previous };
      this.routes.set(from, tree);
    }
    const { distance, previous } = tree;
    if (!distance.has(to)) return null;
    const path = [this.points.get(to)!];
    let meters = 0,
      current = to;
    while (current !== from) {
      const step = previous.get(current)!;
      meters += step.edge.meters;
      current = step.id;
      path.unshift(this.points.get(current)!);
    }
    return { meters, seconds: distance.get(to)!, path };
  }
}
export const corner = (x: number, z: number, side: string) =>
  `walk-${x}-${z}-${side}`;
export function createWalkingNetwork() {
  const graph = new WalkingNetwork();
  const roads = createNetwork().roads;
  for (let x = 0; x <= WORLD.gridMax; x++)
    for (let z = 0; z <= WORLD.gridMax; z++) {
      for (const [side, dx, dz] of [
        ["nw", -1, -1],
        ["ne", 1, -1],
        ["sw", -1, 1],
        ["se", 1, 1],
      ] as const)
        graph.addPoint(corner(x, z, side), {
          x: (x - 2) * 48 + dx * 6.2,
          z: (z - 2) * 48 + dz * 6.2,
        });
      for (const [a, b] of [
        ["nw", "ne"],
        ["sw", "se"],
        ["nw", "sw"],
        ["ne", "se"],
      ])
        graph.connect(corner(x, z, a), corner(x, z, b), true);
    }
  for (let x = 0; x <= WORLD.gridMax; x++)
    for (let z = 0; z <= WORLD.gridMax; z++) {
      if (
        x < WORLD.gridMax &&
        roads.has(`${nodeId(x, z)}_${nodeId(x + 1, z)}`)
      ) {
        graph.connect(corner(x, z, "ne"), corner(x + 1, z, "nw"));
        graph.connect(corner(x, z, "se"), corner(x + 1, z, "sw"));
      }
      if (
        z < WORLD.gridMax &&
        roads.has(`${nodeId(x, z)}_${nodeId(x, z + 1)}`)
      ) {
        graph.connect(corner(x, z, "sw"), corner(x, z + 1, "nw"));
        graph.connect(corner(x, z, "se"), corner(x, z + 1, "ne"));
      }
    }
  return graph;
}
/** Uses the open center aisle of an existing block, then its northern sidewalk. */
export function connectBlock(
  graph: WalkingNetwork,
  id: string,
  point: WalkPoint,
) {
  const x = Math.round((point.x + 72) / 48),
    z = Math.round((point.z + 72) / 48);
  graph.addPoint(id, point);
  graph.addPoint(`${id}-gate`, { x: point.x, z: (z - 2) * 48 + 6.2 });
  graph.connect(id, `${id}-gate`);
  graph.connect(`${id}-gate`, corner(x, z, "se"));
  graph.connect(`${id}-gate`, corner(x + 1, z, "sw"));
}
