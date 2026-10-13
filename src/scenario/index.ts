import type { Network, PolicySelection, Trip, Vec2, Turn } from "../types";

export const CONFIG = {
  seed: 2404,
  demandCount: 140,
  duration: 420,
  dt: 0.1,
  budget: 100,
  spacing: 48,
  junctionRadius: 7,
  laneWidth: 3.2,
  carLength: 3.8,
  carWidth: 1.8,
  minimumGap: 1.5,
} as const;
export const DEFAULT_POLICY: PolicySelection = {
  signal: false,
  bypass: false,
  oneWay: false,
  ewGreen: 26,
};
export const nodeId = (x: number, z: number) => `n${x}-${z}`;
export const SCHOOL_NODE = nodeId(3, 2);
export const nodePosition = (x: number, z: number): Vec2 => ({
  x: (x - 2) * CONFIG.spacing,
  z: (z - 2) * CONFIG.spacing,
});
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function createDemand(
  seed = CONFIG.seed as number,
  count = CONFIG.demandCount as number,
): readonly Trip[] {
  const random = seededRandom(seed);
  const colors = [0xe6ac46, 0xf6eee2, 0x5a8db9, 0xc57463, 0x558978, 0x8496a2];
  const trips: Trip[] = [];
  for (let id = 0; id < count; id++) {
    const reverse = random() < 0.13;
    const school = random() < 0.64;
    const origin = reverse
      ? nodeId(4, 1 + Math.floor(random() * 3))
      : nodeId(Math.floor(random() * 2), Math.floor(random() * 5));
    const destination = reverse
      ? nodeId(0, 1 + Math.floor(random() * 3))
      : school
        ? SCHOOL_NODE
        : nodeId(4, Math.floor(random() * 3));
    trips.push(
      Object.freeze({
        id,
        departAt:
          Math.round(
            (5 + Math.pow(id / count, 0.82) * 205 + random() * 3) * 10,
          ) / 10,
        origin,
        destination,
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
export function createNetwork(
  policy: PolicySelection = DEFAULT_POLICY,
): Network {
  const network: Network = {
    nodes: new Map(),
    roads: new Map(),
    lanes: new Map(),
    outgoing: new Map(),
  };
  for (let x = 0; x < 5; x++)
    for (let z = 0; z < 5; z++) {
      const id = nodeId(x, z);
      network.nodes.set(id, {
        id,
        position: nodePosition(x, z),
        connectedRoadIds: [],
        signal: {
          ns: 14,
          ew: 14,
          yellow: 2,
          clearance: 1,
          offset: (x * 3 + z * 7) % 18,
        },
      });
      network.outgoing.set(id, []);
    }
  const add = (
    x: number,
    z: number,
    dx: number,
    dz: number,
    bypass = false,
  ) => {
    const startNodeId = nodeId(x, z),
      endNodeId = nodeId(x + dx, z + dz);
    const id = `${startNodeId}_${endNodeId}`;
    const oneWay = policy.oneWay && x === 1 && z === 2 && dx === 1;
    const name = bypass
      ? "새로운 우회도로"
      : dx
        ? z === 2
          ? "학교 가는 길"
          : z === 4
            ? "남쪽 둘레길"
            : "동네 가로길"
        : x < 2
          ? "햇살 주택길"
          : x === 3
            ? "학교 앞 세로길"
            : "상가 연결길";
    network.roads.set(id, {
      id,
      name,
      startNodeId,
      endNodeId,
      direction: oneWay ? "one-way" : "two-way",
      laneCount: oneWay ? 2 : 1,
      length: CONFIG.spacing,
      speedLimit: z === 2 && dx ? 9 : 8,
      bypass,
    });
    network.nodes.get(startNodeId)!.connectedRoadIds.push(id);
    network.nodes.get(endNodeId)!.connectedRoadIds.push(id);
  };
  for (let x = 0; x < 5; x++)
    for (let z = 0; z < 5; z++) {
      if (z < 4) add(x, z, 0, 1);
      if (x < 4 && !(x === 2 && z !== 2 && z !== 4)) add(x, z, 1, 0);
    }
  if (policy.bypass) add(2, 1, 1, 0, true);
  network.nodes.get(SCHOOL_NODE)!.signal = {
    ns: policy.signal ? 10 : 25,
    ew: policy.signal ? policy.ewGreen : 7,
    yellow: 2,
    clearance: 1,
    offset: 0,
  };
  rebuildLanes(network);
  return network;
}
export function rebuildLanes(network: Network) {
  network.lanes.clear();
  for (const id of network.nodes.keys()) network.outgoing.set(id, []);
  for (const road of network.roads.values()) {
    const directions =
      road.direction === "one-way"
        ? [[road.startNodeId, road.endNodeId]]
        : [
            [road.startNodeId, road.endNodeId],
            [road.endNodeId, road.startNodeId],
          ];
    for (const [from, to] of directions)
      for (let index = 0; index < road.laneCount; index++) {
        const a = network.nodes.get(from)!.position,
          b = network.nodes.get(to)!.position;
        const length = Math.hypot(b.x - a.x, b.z - a.z),
          dx = (b.x - a.x) / length,
          dz = (b.z - a.z) / length;
        const offset =
          road.direction === "one-way"
            ? (index - (road.laneCount - 1) / 2) * CONFIG.laneWidth
            : (index + 0.5) * CONFIG.laneWidth;
        const r = CONFIG.junctionRadius;
        const lane = {
          id: `${road.id}:${from}:${index}`,
          roadId: road.id,
          from,
          to,
          index,
          start: {
            x: a.x + dx * r - dz * offset,
            z: a.z + dz * r + dx * offset,
          },
          end: { x: b.x - dx * r - dz * offset, z: b.z - dz * r + dx * offset },
          length: length - 2 * r,
          axis: Math.abs(dx) > 0.5 ? ("ew" as const) : ("ns" as const),
          turns: (road.laneCount === 1
            ? ["left", "straight", "right"]
            : index === 0
              ? ["left", "straight"]
              : index === road.laneCount - 1
                ? ["straight", "right"]
                : ["straight"]) as Turn[],
        };
        network.lanes.set(lane.id, lane);
        network.outgoing.get(from)!.push(lane);
      }
  }
}
export const BUILDINGS = Array.from({ length: 16 }, (_, i) => {
  const x = i % 4,
    z = Math.floor(i / 4);
  const kind =
    x === 2 && z === 1
      ? "school"
      : x === 3 && z === 3
        ? "factory"
        : (x === 2 && z === 2) || (x === 1 && z === 0)
          ? "park"
          : x < 2
            ? "home"
            : "office";
  return {
    id: `b${i}`,
    x: (x - 1.5) * 48,
    z: (z - 1.5) * 48,
    kind,
    name:
      kind === "school"
        ? "새봄초등학교"
        : kind === "factory"
          ? "동네 공장"
          : kind === "park"
            ? "초록 공원"
            : kind === "home"
              ? "햇살 주거단지"
              : "다함께 상가",
    description:
      kind === "school"
        ? "아침마다 학생들이 모여요. 학교 앞 교차로를 살펴보세요."
        : kind === "home"
          ? "등교·출근 차량이 출발하는 주거지역이에요."
          : kind === "park"
            ? "주민들이 산책하고 쉬는 공간이에요."
            : kind === "factory"
              ? "물건을 만드는 일터예요. 산업 교통은 다음 단계에서 추가해요."
              : "출근 차량이 향하는 상가와 업무지역이에요.",
  };
});
