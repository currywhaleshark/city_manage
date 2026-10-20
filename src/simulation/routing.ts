import { CONFIG } from "../scenario";
import type { Lane, Network } from "../types";
import { nextTurn, permitsRoute } from "./lanes";

export type DrivingGoal = { laneId: string; endS?: number } | { nodeId: string };
export type LaneDelay = (lane: Lane) => number;
export interface DrivingRoute { roads: string[]; seconds: number }

function atGoal(lane: Lane, goal: DrivingGoal) {
  return "laneId" in goal ? lane.id === goal.laneId : lane.to === goal.nodeId;
}
function laneSeconds(network: Network, lane: Lane, goal: DrivingGoal, delay: LaneDelay) {
  const length = "laneId" in goal && lane.id === goal.laneId
    ? goal.endS ?? lane.length : lane.length;
  return length / network.roads.get(lane.roadId)!.speedLimit + delay(lane);
}
function junctionSeconds(network: Network, incoming: Lane | undefined, outgoing: Lane) {
  if (!incoming) return 0;
  const signal = network.nodes.get(incoming.to)!.signal;
  const cycle = signal.ns + signal.ew + 2 * (signal.yellow + signal.clearance) +
    (signal.walk ?? 0) + (signal.walkClearance ?? 0);
  const red = cycle - signal[incoming.axis];
  // Expected signal wait, plus the same straight/turn speeds as the movement model.
  return (cycle ? red * red / (2 * cycle) : 0) +
    2 * CONFIG.junctionRadius / (nextTurn(network, incoming, outgoing.roadId) === "straight" ? 8 : 4.5);
}

/** Search directed approaches, so only an immediate U-turn is forbidden.
 * A road may still be used later from a legal approach to the destination bay. */
export function findDrivingRoute(
  network: Network, start: { nodeId: string; incomingLaneId?: string },
  goal: DrivingGoal, delay: LaneDelay = () => 0,
): DrivingRoute | undefined {
  type Visit = { key: string; lane?: Lane; seconds: number };
  const heap: Visit[] = [];
  const push = (value: Visit) => {
    let i = heap.length; heap.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].seconds <= value.seconds) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = value;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && heap[child + 1].seconds < heap[child].seconds) child++;
        if (last.seconds <= heap[child].seconds) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  const distance = new Map([["start", 0]]);
  const previous = new Map<string, { key: string; roadId: string }>();
  push({ key: "start", lane: start.incomingLaneId ? network.lanes.get(start.incomingLaneId) : undefined, seconds: 0 });
  while (heap.length) {
    const current = pop();
    if (current.seconds !== distance.get(current.key)) continue;
    if (current.key !== "start" && atGoal(current.lane!, goal)) {
      const roads: string[] = [];
      for (let key = current.key; key !== "start";) {
        const edge = previous.get(key)!;
        roads.push(edge.roadId); key = edge.key;
      }
      return { roads: roads.reverse(), seconds: current.seconds };
    }
    const node = current.lane?.to ?? start.nodeId;
    for (const lane of network.outgoing.get(node) ?? []) {
      if (current.lane && (current.lane.roadId === lane.roadId ||
        !permitsRoute(network, current.lane, lane.roadId))) continue;
      const seconds = current.seconds + junctionSeconds(network, current.lane, lane) +
        laneSeconds(network, lane, goal, delay);
      if (seconds >= (distance.get(lane.id) ?? Infinity) - 1e-8) continue;
      distance.set(lane.id, seconds);
      previous.set(lane.id, { key: current.key, roadId: lane.roadId });
      push({ key: lane.id, lane, seconds });
    }
  }
}

/** Price the existing remaining route with the same observations as a candidate. */
export function drivingRouteSeconds(
  network: Network, incoming: Lane, roads: readonly string[], goal: DrivingGoal, delay: LaneDelay,
) {
  let seconds = 0;
  for (let i = 0; i < roads.length; i++) {
    const lanes = (network.outgoing.get(incoming.to) ?? []).filter(l =>
      l.roadId === roads[i] && permitsRoute(network, l, roads[i + 1]) &&
      !(i === roads.length - 1 && "laneId" in goal && l.id !== goal.laneId));
    lanes.sort((a, b) => laneSeconds(network, a, goal, delay) - laneSeconds(network, b, goal, delay));
    const lane = lanes[0];
    if (!lane || lane.roadId === incoming.roadId || !permitsRoute(network, incoming, lane.roadId)) return Infinity;
    seconds += junctionSeconds(network, incoming, lane) + laneSeconds(network, lane, goal, delay);
    incoming = lane;
  }
  return atGoal(incoming, goal) ? seconds : Infinity;
}
