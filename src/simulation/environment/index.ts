import { TrafficSimulation } from "../../simulation";
import {
  createDemand,
  DEFAULT_POLICY,
  nodeId,
  seededRandom,
} from "../../scenario";
import { createPedestrianDemand } from "../pedestrians";
import { CITY_FACILITIES, type DistrictId } from "../../city/data";
import {
  applyPolicies,
  type PolicyDefinition,
} from "../../policies/definition";
import type { Trip, Vec2 } from "../../types";
import { DEVELOPMENT_PLOTS } from "../../city/world";

export const ENVIRONMENT_MODEL_VERSION = "development-environment-v2";
export const DEVELOPMENT_SITES = [
  {
    id: "industry",
    name: "남동쪽 산업 확장 부지",
    position: DEVELOPMENT_PLOTS.industry,
    districtId: "se" as DistrictId,
  },
  {
    id: "housing",
    name: "남서쪽 주거 확장 부지",
    position: DEVELOPMENT_PLOTS.housing,
    districtId: "sw" as DistrictId,
  },
] as const;
export const BUFFER_STRIPS = [
  { minX: 200, maxX: 204, minZ: 150, maxZ: 186 },
  { minX: 200, maxX: 204, minZ: 212, maxZ: 222 },
] as const;
export const MANAGED_AREA = 2 * 24 * 12 + 4 * (36 + 10);
export interface EnvironmentConfiguration {
  industry: boolean;
  housing: boolean;
  conserve: boolean;
  buffer: boolean;
  small: boolean;
}
export const ENVIRONMENT_POLICIES: readonly PolicyDefinition<EnvironmentConfiguration>[] =
  [
    {
      id: "industry",
      scenarioId: "environment",
      title: "산업시설 확장",
      cost: 40,
      target: "남동쪽 확장 부지",
      description:
        "일터 이용 자리 48명분과 출근 차량 48건을 추가해요. 규모에 따라 달라져요.",
      tradeoff: "녹지 일부가 건물로 바뀌고 주변 시설·교통 부담이 늘 수 있어요.",
      metrics: ["workCapacity", "addedTrips", "meanBurden"],
      available: () => true,
      apply: (s) => {
        s.industry = true;
      },
    },
    {
      id: "housing",
      scenarioId: "environment",
      title: "주거지 확장",
      cost: 30,
      target: "남서쪽 확장 부지",
      description:
        "거주 공간 48명분과 등교·출근 차량 24건을 추가해요. 규모에 따라 달라져요.",
      tradeoff:
        "살 공간은 늘지만 녹지가 줄고 기존 길의 대기가 길어질 수 있어요.",
      metrics: ["housingCapacity", "addedTrips", "greenArea"],
      available: () => true,
      apply: (s) => {
        s.housing = true;
      },
    },
    {
      id: "conserve",
      scenarioId: "environment",
      title: "녹지 보전",
      cost: 15,
      target: "두 확장 부지의 녹지",
      description:
        "부지마다 192㎡를 보전 구역으로 지정해요. 개발은 나머지 96㎡ 안에서 해요.",
      tradeoff: "기존 일터는 그대로예요. 새로 늘릴 공간의 크기는 줄어들어요.",
      metrics: ["protectedArea", "greenArea"],
      available: () => true,
      apply: (s) => {
        s.conserve = true;
      },
    },
    {
      id: "buffer",
      scenarioId: "environment",
      title: "완충 녹지 조성",
      cost: 20,
      target: "공장 서쪽의 두 녹지 띠",
      description:
        "도로를 비워 둔 녹지 띠에 나무를 심어요. 띠 너머로 전달되는 산업시설의 가상 부담을 줄여요.",
      tradeoff:
        "교통량이나 모든 동네의 부담을 줄이는 정책은 아니에요. 개발 면적과 이용 자리는 그대로예요.",
      metrics: ["meanBurden", "bufferArea"],
      available: () => true,
      apply: (s) => {
        s.buffer = true;
      },
    },
    {
      id: "small",
      scenarioId: "environment",
      title: "개발 규모 축소",
      cost: 10,
      target: "이번에 선택한 개발",
      description:
        "새 산업·주거 개발을 각각 192㎡에서 96㎡로 줄여요. 추가 자리와 차량 수요도 절반이 돼요.",
      tradeoff:
        "녹지 보전으로 이미 96㎡로 제한했다면 더 줄어들지 않아요. 개발을 고르지 않으면 크기 변화가 없어요.",
      metrics: ["developedArea", "addedTrips"],
      available: () => true,
      apply: (s) => {
        s.small = true;
      },
    },
  ];
export const burdenLevel = (value: number) =>
  value < 10 ? "낮음" : value < 20 ? "중간" : "높음";
export interface EnvironmentPlace {
  id: string;
  name: string;
  position: Vec2;
  districtId: DistrictId;
  population: number;
  use: string;
}
export const ENVIRONMENT_PLACES: readonly EnvironmentPlace[] = [
  ...CITY_FACILITIES.filter(
    (f) =>
      f.population > 0 ||
      f.kind === "school" ||
      f.id === "b15" ||
      f.id === "block-5-5" ||
      f.kind === "waste",
  ).map((f) => ({
    id: f.id,
    name:
      (
        {
          b0: "북쪽 첫 마을",
          b4: "학교 가는 길 서쪽",
          b5: "학교 가는 길 안쪽",
          b8: "서쪽 끝 마을",
          b9: "공원 건너 마을",
          b12: "남쪽 끝 마을",
          b13: "남쪽 안쪽 마을",
        } as Record<string, string>
      )[f.id] ?? f.name,
    position: f.position,
    districtId: f.districtId,
    population: f.population,
    use: f.purpose,
  })),
  {
    id: "housing",
    name: "새 주거 부지",
    position: DEVELOPMENT_SITES[1].position,
    districtId: "sw",
    population: 0,
    use: "계획 부지",
  },
];

/** Geometric screening in the toy model; does not model sound, particles, wind or health. */
export function crossesBuffer(source: Vec2, receiver: Vec2) {
  return BUFFER_STRIPS.some((strip) => {
    if (source.x === receiver.x) return false;
    const t =
      ((strip.minX + strip.maxX) / 2 - source.x) / (receiver.x - source.x);
    const z = source.z + t * (receiver.z - source.z);
    return t > 0 && t < 1 && z >= strip.minZ && z <= strip.maxZ;
  });
}
export function distanceWeight(source: Vec2, receiver: Vec2, radius: number) {
  return (
    1 /
    (1 + Math.hypot(source.x - receiver.x, source.z - receiver.z) / radius) ** 2
  );
}
function developmentDemand(
  seed: number,
  kind: "industry" | "housing",
  count: number,
): readonly Trip[] {
  const random = seededRandom(
    seed ^ (kind === "industry" ? 0x696e64 : 0x686f6d),
  );
  const fullCount = kind === "industry" ? 48 : 24;
  const trips: Trip[] = [];
  for (let i = 0; i < fullCount; i++) {
    const school = random() < 0.5;
    trips.push(
      Object.freeze({
        id: (kind === "industry" ? 2000 : 3000) + i,
        origin: kind === "industry" ? nodeId(i % 2, i % 5) : nodeId(1, 6),
        destination:
          kind === "industry"
            ? nodeId(7, 7)
            : school
              ? nodeId(3, 2)
              : nodeId(4, 0),
        departAt:
          Math.round((12 + (i / fullCount) * 195 + random() * 3) * 10) / 10,
        purpose: kind === "housing" && school ? "school" : "work",
        targetSpeed: 7.5 + random() * 1.5,
        color: kind === "industry" ? 0x6b9ba5 : 0xd6aa6a,
      }),
    );
  }
  return Object.freeze(trips.slice(0, count));
}
export class EnvironmentSimulation extends TrafficSimulation {
  readonly scenarioId = "environment";
  readonly configuration: EnvironmentConfiguration;
  readonly policyIds: readonly string[];
  readonly cost: number;
  readonly backgroundDemand: readonly Trip[];
  readonly addedDemand: readonly Trip[];
  readonly parcels: {
    id: "industry" | "housing";
    developedArea: number;
    greenArea: number;
    protectedArea: number;
    capacity: number;
  }[];
  private sums = ENVIRONMENT_PLACES.map(() => ({ facility: 0, traffic: 0 }));
  private sampleCount = 0;
  private currentBurden = ENVIRONMENT_PLACES.map(() => ({
    facility: 0,
    traffic: 0,
  }));
  constructor(
    readonly seed = 2404,
    policyIds: readonly string[] = [],
  ) {
    const applied = applyPolicies(
      ENVIRONMENT_POLICIES,
      policyIds,
      {
        industry: false,
        housing: false,
        conserve: false,
        buffer: false,
        small: false,
      },
      100,
    );
    const config = applied.state;
    const area = config.conserve || config.small ? 96 : 192;
    const background = createDemand(seed);
    const added = Object.freeze([
      ...developmentDemand(seed, "industry", config.industry ? area / 4 : 0),
      ...developmentDemand(seed, "housing", config.housing ? area / 8 : 0),
    ]);
    super(
      DEFAULT_POLICY,
      Object.freeze(
        [...background, ...added].sort(
          (a, b) => a.departAt - b.departAt || a.id - b.id,
        ),
      ),
      undefined,
      createPedestrianDemand(seed),
    );
    this.configuration = config;
    this.cost = applied.cost;
    this.policyIds = Object.freeze([...policyIds]);
    this.backgroundDemand = background;
    this.addedDemand = added;
    this.parcels = DEVELOPMENT_SITES.map((site) => ({
      id: site.id,
      developedArea: config[site.id] ? area : 0,
      greenArea: 288 - (config[site.id] ? area : 0),
      protectedArea: config.conserve ? 192 : 0,
      capacity: config[site.id] ? area / 4 : 0,
    }));
    this.currentBurden = this.calculateBurden();
  }
  private calculateBurden() {
    const industry = this.parcels.find((p) => p.id === "industry")!;
    const sources = [
      ...CITY_FACILITIES.filter(
        (f) => f.kind === "factory" || f.kind === "waste",
      ).map((f) => ({
        position: f.position,
        strength: f.id === "b15" ? 40 : f.kind === "waste" ? 18 : 8,
      })),
      {
        position: DEVELOPMENT_SITES[0].position,
        strength: (30 * industry.developedArea) / 192,
      },
    ];
    return ENVIRONMENT_PLACES.map((place) => ({
      facility: sources.reduce(
        (sum, source) =>
          sum +
          source.strength *
            distanceWeight(source.position, place.position, 45) *
            (this.configuration.buffer &&
            crossesBuffer(source.position, place.position)
              ? 0.65
              : 1),
        0,
      ),
      traffic: [...this.vehicles.values()].reduce(
        (sum, vehicle) =>
          sum + 0.8 * distanceWeight(vehicle.pose, place.position, 38),
        0,
      ),
    }));
  }
  override step() {
    super.step();
    if (Math.round(this.time * 10) % 10 !== 0) return;
    this.currentBurden = this.calculateBurden();
    this.sampleCount++;
    this.currentBurden.forEach((value, i) => {
      this.sums[i].facility += value.facility;
      this.sums[i].traffic += value.traffic;
    });
  }
  get environmentStats() {
    const regions = ENVIRONMENT_PLACES.map((place, i) => ({
      ...place,
      currentBurden:
        this.currentBurden[i].facility + this.currentBurden[i].traffic,
      facilityBurden: this.currentBurden[i].facility,
      trafficBurden: this.currentBurden[i].traffic,
      meanBurden: this.sampleCount
        ? (this.sums[i].facility + this.sums[i].traffic) / this.sampleCount
        : null,
      meanFacilityBurden: this.sampleCount
        ? this.sums[i].facility / this.sampleCount
        : null,
      meanTrafficBurden: this.sampleCount
        ? this.sums[i].traffic / this.sampleCount
        : null,
    }));
    const addedIds = new Set(this.addedDemand.map((t) => t.id));
    const arrivedAdded = this.completed.filter((t) => addedIds.has(t.id));
    return {
      time: this.time,
      sampleCount: this.sampleCount,
      model: "educational-proxy",
      parcels: this.parcels,
      managedArea: MANAGED_AREA,
      developedArea: this.parcels.reduce((n, p) => n + p.developedArea, 0),
      greenArea:
        MANAGED_AREA - this.parcels.reduce((n, p) => n + p.developedArea, 0),
      protectedArea: this.parcels.reduce((n, p) => n + p.protectedArea, 0),
      bufferArea: this.configuration.buffer ? 184 : 0,
      workCapacity: this.parcels[0].capacity,
      housingCapacity: this.parcels[1].capacity,
      backgroundTrips: this.backgroundDemand.length,
      addedTrips: this.addedDemand.length,
      backgroundArrived: this.completed.length - arrivedAdded.length,
      addedArrived: arrivedAdded.length,
      industryArrived: arrivedAdded.filter((t) => t.id >= 2000 && t.id < 3000)
        .length,
      industryTrips: this.addedDemand.filter((t) => t.id < 3000).length,
      meanBurden: this.sampleCount
        ? regions.reduce((n, r) => n + r.meanBurden!, 0) / regions.length
        : null,
      highBurdenPlaces: regions.filter((r) => (r.meanBurden ?? 0) >= 20).length,
      cost: this.cost,
      remainingBudget: 100 - this.cost,
      regions,
      rules: {
        sampleSeconds: 1,
        facilityDistanceScale: 45,
        trafficDistanceScale: 38,
        vehicleWeight: 0.8,
        bufferFactor: 0.65,
        highThreshold: 20,
      },
    };
  }
}
