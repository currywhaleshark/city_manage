import type { Network, PolicySelection, Trip, Vec2, Turn } from "../types";
import {
  WORLD,
  RIVER,
  FACTORY,
  WASTE_DEPOT,
  BUILDABLE_PLOTS,
  DEVELOPMENT_PLOTS,
  EXTERNAL_CONNECTIONS,
  boundaryNode,
} from "../city/world";

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
    // Half the demand remains school traffic. Work/home trips use the expanded
    // districts, with explicit inbound/outbound cohorts at both city borders.
    const cohort = id % 20;
    const home = nodeId(Math.floor(random() * 2), Math.floor(random() * 8));
    const workplace = nodeId(
      6 + Math.floor(random() * 3),
      id % 2 === 0 ? 4 + Math.floor(random() * 4) : Math.floor(random() * 3),
    );
    const origin =
      cohort === 0
        ? boundaryNode("west", 0)
        : cohort === 1
          ? boundaryNode("east", 0)
          : [3, 8, 9].includes(cohort)
            ? workplace
            : home;
    const destination =
      cohort === 2
        ? boundaryNode("west", 1)
        : cohort === 3
          ? boundaryNode("east", 1)
          : [1, 8, 9].includes(cohort)
            ? home
            : cohort < 10
              ? workplace
              : SCHOOL_NODE;
    const purpose = [1, 3, 8, 9].includes(cohort)
      ? "home"
      : cohort < 10
        ? "work"
        : "school";
    trips.push(
      Object.freeze({
        id,
        departAt:
          Math.round(
            (5 + Math.pow(id / count, 0.82) * 205 + random() * 3) * 10,
          ) / 10,
        origin,
        destination,
        purpose,
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
  for (let x = 0; x <= WORLD.gridMax; x++)
    for (let z = 0; z <= WORLD.gridMax; z++) {
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
      : dx && x === 4
        ? z === 1
          ? "새봄천 상류 다리"
          : z === 4
            ? "새봄천 중앙 다리"
            : "새봄천 하류 다리"
        : x >= 5
          ? z >= 3
            ? "산업지구 연결길"
            : "강너머 상업길"
          : z > 4
            ? x < 2
              ? "남쪽 주거지구 길"
              : "남쪽 상업지구 길"
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
  for (let x = 0; x <= WORLD.gridMax; x++)
    for (let z = 0; z <= WORLD.gridMax; z++) {
      if (z < WORLD.gridMax) add(x, z, 0, 1);
      if (
        x < WORLD.gridMax &&
        !(x === 2 && z < 4 && z !== 2) &&
        !(x === 4 && !(RIVER.bridges as readonly number[]).includes(z))
      )
        add(x, z, 1, 0);
    }
  for (const connection of EXTERNAL_CONNECTIONS) {
    const outside = [0, 1].map((i) => `outside-${connection.id}-${i}`);
    const gates = [
      boundaryNode(connection.id, 0),
      boundaryNode(connection.id, 1),
    ];
    gates.forEach((id, i) =>
      network.nodes.set(id, {
        id,
        position: { x: connection.edgeX, z: i * 48 },
        connectedRoadIds: [],
        boundary: true,
        signal: { ns: 0, ew: 1, yellow: 0, clearance: 0, offset: 0 },
      }),
    );
    outside.forEach((id, i) => {
      network.nodes.set(id, {
        id,
        position: { x: connection.x, z: i * 48 },
        connectedRoadIds: [],
        signal: { ns: 14, ew: 14, yellow: 2, clearance: 1, offset: 0 },
      });
    });
    const links = [
      [nodeId(connection.cityX, 2), gates[0], "out"],
      [gates[0], outside[0], "approach-out"],
      [outside[0], outside[1], "supply"],
      [outside[1], gates[1], "approach-in"],
      [gates[1], nodeId(connection.cityX, 3), "in"],
    ];
    for (const [startNodeId, endNodeId, part] of links) {
      const a = network.nodes.get(startNodeId)!.position,
        b = network.nodes.get(endNodeId)!.position;
      const id = `external-${connection.id}-${part}`;
      network.roads.set(id, {
        id,
        startNodeId,
        endNodeId,
        name: `${connection.name} ${part === "supply" ? "물류 연결길" : "연결도로"}`,
        direction: "two-way",
        laneCount: 1,
        speedLimit: 9,
        length: Math.hypot(a.x - b.x, a.z - b.z),
      });
      network.nodes.get(startNodeId)!.connectedRoadIds.push(id);
      network.nodes.get(endNodeId)!.connectedRoadIds.push(id);
    }
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
const coreBuildings = Array.from({ length: 16 }, (_, i) => {
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
    x: kind === "factory" ? FACTORY.x : (x - 1.5) * 48,
    z: kind === "factory" ? FACTORY.z : (z - 1.5) * 48,
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
              ? "산업지구에서 물건을 만들고 화물차로 상점에 보내요."
              : "출근 차량이 향하는 상가와 업무지역이에요.",
  };
});
const extension = [] as typeof coreBuildings;
for (let z = 0; z < 8; z++)
  for (let x = 0; x < 8; x++) {
    if ((x < 4 && z < 4) || x === 4) continue;
    const position = { x: (x - 1.5) * 48, z: (z - 1.5) * 48 };
    if (
      [
        ...BUILDABLE_PLOTS.map((p) => p.position),
        ...Object.values(DEVELOPMENT_PLOTS),
        FACTORY,
        WASTE_DEPOT,
        { x: 72, z: 120 },
      ].some((p) => p.x === position.x && p.z === position.z)
    )
      continue;
    const kind = x < 2 ? "home" : x >= 5 && z >= 3 ? "factory" : "office";
    extension.push({
      id: `block-${x}-${z}`,
      ...position,
      kind,
      name:
        kind === "home"
          ? `남쪽 주거단지 ${z - 3}`
          : kind === "factory"
            ? "강너머 산업단지"
            : "중앙 생활 상가",
      description:
        kind === "home"
          ? "주민이 살고 있는 주거지구예요. 공원과 도서관까지의 길을 살펴보세요."
          : kind === "factory"
            ? "하천 동쪽 산업지구예요. 생산과 주변 환경을 함께 고려해요."
            : "장보기와 일자리를 위한 상업지구예요.",
    });
  }
export const BUILDINGS = [
  ...coreBuildings,
  ...extension,
  {
    id: WASTE_DEPOT.id,
    x: WASTE_DEPOT.x,
    z: WASTE_DEPOT.z,
    kind: "waste",
    name: "새봄 자원순환센터",
    description:
      "산업지구의 쓰레기 처리장이에요. 수거차가 실제로 돌아와 쓰레기를 내려놓아요. 하천과 주변 생활환경도 살펴봐요.",
  },
];
