import { TrafficSimulation } from "../simulation";
import {
  WaterSimulation,
  WATER_POLICIES,
  WATER_DURATION,
  type WaterPlan,
} from "../simulation/water";
import {
  DumpingSimulation,
  DUMPING_POLICIES,
  DUMPING_DURATION,
  type DumpingPlan,
} from "../simulation/services/dumping";
import {
  ParkingSimulation,
  PARKING_POLICIES,
  type ParkingPlan,
} from "../simulation/parking";
import { DEFAULT_POLICY } from "../scenario";
import { POLICIES } from "../policies";
import type { PolicyDefinition } from "../policies/definition";
import { applyPolicies } from "../policies/definition";
import { WasteSimulation, WASTE_POLICIES } from "../simulation/services/waste";
import type { PolicySelection, Trip } from "../types";
import type { PedestrianTrip } from "../simulation/pedestrians";
import { CITY_FACILITIES } from "../city/data";
import { residentVoices } from "../simulation/residents";
import { LogisticsSimulation, LOGISTICS_POLICIES } from "../simulation/economy";
import {
  EnvironmentSimulation,
  ENVIRONMENT_POLICIES,
} from "../simulation/environment";
import {
  FacilitySimulation,
  FACILITY_POLICIES,
  type FacilityPlan,
} from "../simulation/facilities";

export type ScenarioId =
  | "traffic"
  | "waste"
  | "facilities"
  | "environment"
  | "logistics"
  | "parking"
  | "dumping"
  | "water";
export type MapLayer =
  | "normal"
  | "land"
  | "traffic"
  | "waste"
  | "population"
  | "access"
  | "stock"
  | "environment"
  | "water";
export interface RunConditions {
  seed: number;
  duration: number;
  demand: readonly Trip[];
  pedestrians: readonly PedestrianTrip[];
  facilityPlan?: FacilityPlan;
  parkingPlan?: ParkingPlan;
  dumpingPlan?: DumpingPlan;
  waterPlan?: WaterPlan;
}
export interface ScenarioDefinition {
  id: ScenarioId;
  number: string;
  title: string;
  introduction: string;
  request: string;
  standards: readonly string[];
  budget: number;
  duration: number;
  durations: readonly number[];
  clock?: "planning";
  facilities: typeof CITY_FACILITIES;
  demand: { vehicles: number; pedestrians: number; serviceVehicles: number };
  residents: typeof residentVoices;
  layers: readonly MapLayer[];
  policies: readonly Pick<
    PolicyDefinition<unknown>,
    "id" | "title" | "cost" | "target" | "description" | "tradeoff" | "metrics"
  >[];
  observationMetrics: readonly string[];
  reflection: string;
  create: (
    conditions: RunConditions,
    ids: readonly string[],
    ewGreen: number,
  ) => TrafficSimulation;
}
export const TRAFFIC_POLICIES: readonly PolicyDefinition<PolicySelection>[] =
  POLICIES.map((p) => ({
    ...p,
    scenarioId: "traffic",
    metrics: ["arrived", "averageDemandWait"],
    available: () => true,
    apply: (s) => {
      s[p.id] = true;
    },
  }));
export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: "traffic",
    number: "00",
    title: "막히는 등굣길",
    introduction:
      "아침마다 학교 앞에 차가 길게 늘어서요. 시장님, 우리 동네의 길을 바꿔 볼까요?",
    request: "학교에 늦지 않게, 등굣길이 조금 더 편해지면 좋겠어요.",
    standards: ["4사09-01", "4사10-02"],
    budget: 100,
    duration: 420,
    durations: [180, 420, 600],
    facilities: CITY_FACILITIES,
    demand: { vehicles: 140, pedestrians: 60, serviceVehicles: 0 },
    residents: residentVoices,
    layers: ["normal", "land", "traffic", "population"],
    policies: TRAFFIC_POLICIES,
    observationMetrics: ["arrived", "averageDemandWait", "pedestrianWait"],
    reflection: "어떤 점이 좋아졌고, 누구에게 불편해졌나요?",
    create: (c, ids, ewGreen) =>
      new TrafficSimulation(
        applyPolicies(
          TRAFFIC_POLICIES,
          ids,
          { ...DEFAULT_POLICY, ewGreen },
          100,
        ).state,
        c.demand,
        undefined,
        c.pedestrians,
      ),
  },
  {
    id: "waste",
    number: "01",
    title: "쓰레기가 쌓이는 동네",
    introduction:
      "어떤 곳은 깨끗해졌는데, 다른 곳에는 쓰레기가 쌓여 있어요. 수거차가 어디에서 늦어지는지 살펴볼까요?",
    request:
      "우리 집 앞 수거장은 왜 아직 그대로일까요? 차가 부족한지, 길이 막히는지 함께 알아봐 주세요.",
    standards: ["4사09-01", "4사08-02"],
    budget: 100,
    duration: 600,
    durations: [300, 600, 900],
    facilities: CITY_FACILITIES,
    demand: { vehicles: 140, pedestrians: 60, serviceVehicles: 2 },
    residents: residentVoices,
    layers: ["normal", "land", "waste", "traffic", "population"],
    policies: WASTE_POLICIES,
    observationMetrics: [
      "collectionRate",
      "remainingBySite",
      "averageTravelTime",
      "completedSites",
    ],
    reflection:
      "어떤 자료와 주민 의견을 참고했나요? 수거가 늦어진 곳도 있나요?",
    create: (c, ids) => new WasteSimulation(c.seed, ids),
  },
  {
    id: "facilities",
    number: "02",
    title: "우리 동네에 필요한 시설은?",
    introduction:
      "어떤 동네는 공원이 가깝지만, 도서관은 멀리 있어요. 필요한 시설과 지을 곳을 주민들과 함께 골라 볼까요?",
    request:
      "우리 동네에도 필요한 시설을 만들어 주세요. 가까워도 이용할 자리가 있는지 함께 살펴봐 주세요.",
    standards: ["4사08-02", "4사09-01"],
    budget: 100,
    duration: 0,
    durations: [0],
    clock: "planning",
    facilities: CITY_FACILITIES,
    demand: { vehicles: 0, pedestrians: 0, serviceVehicles: 0 },
    residents: residentVoices,
    layers: ["normal", "land", "access", "population"],
    policies: FACILITY_POLICIES,
    observationMetrics: [
      "served",
      "unserved",
      "capacityShortfall",
      "averageNearestSeconds",
    ],
    reflection:
      "어느 동네와 주민에게 도움이 되었나요? 혜택을 못 받은 주민의 의견도 생각해 보세요.",
    create: (c, ids) => new FacilitySimulation(c.seed, ids, c.facilityPlan),
  },
  {
    id: "environment",
    number: "03",
    title: "개발할까요, 보전할까요?",
    introduction:
      "남쪽 녹지에 일터와 주거 공간을 늘리자는 의견이 있어요. 늘어나는 공간과 차량, 주변 동네의 변화를 함께 살펴볼까요?",
    request: "필요한 공간도 만들고 싶지만, 이웃의 생활과 녹지도 생각해 주세요.",
    standards: ["4사10-01", "4사10-02"],
    budget: 100,
    duration: 420,
    durations: [180, 420, 600],
    facilities: CITY_FACILITIES,
    demand: { vehicles: 140, pedestrians: 60, serviceVehicles: 0 },
    residents: residentVoices,
    layers: ["normal", "land", "environment", "traffic", "population"],
    policies: ENVIRONMENT_POLICIES,
    observationMetrics: [
      "greenArea",
      "workCapacity",
      "housingCapacity",
      "addedTrips",
      "meanBurden",
    ],
    reflection:
      "늘어난 공간과 줄어든 녹지, 동네별 부담을 함께 보면 어떤 선택이 좋을까요?",
    create: (c, ids) => new EnvironmentSimulation(c.seed, ids),
  },
  {
    id: "logistics",
    number: "04",
    title: "시장에 물건이 부족해요",
    introduction:
      "공장에는 물건이 있는데 어떤 가게는 품절이에요. 이웃 마을에서 온 물자는 어디까지 왔을까요? 생산·배송·소비를 따라가 봐요.",
    request:
      "가게에 필요한 물건을 제때 보내 주세요. 다른 동네와 등굣길도 함께 생각해 주세요.",
    standards: ["4사07-01", "4사07-02"],
    budget: 100,
    duration: 600,
    durations: [300, 600, 900],
    facilities: CITY_FACILITIES,
    demand: { vehicles: 140, pedestrians: 60, serviceVehicles: 2 },
    residents: residentVoices,
    layers: ["normal", "land", "stock", "traffic", "population"],
    policies: LOGISTICS_POLICIES,
    observationMetrics: [
      "delivered",
      "stock",
      "unmet",
      "stockoutShops",
      "averageTravelTime",
    ],
    reflection:
      "물건이 부족한 까닭은 무엇이었나요? 우리 동네와 이웃 마을은 어떻게 서로 돕나요?",
    create: (c, ids) => new LogisticsSimulation(c.seed, ids),
  },
  {
    id: "parking",
    number: "05",
    title: "길을 막은 불법주차",
    introduction:
      "학교 앞, 시장 옆, 주거지 골목에 차가 서 있어요. 사람과 차가 어떻게 지나가는지 조사해 봐요.",
    request:
      "걸어가는 사람과 주차할 곳이 필요한 이웃의 이야기를 함께 들어 주세요.",
    standards: ["4사09-01", "4사08-02"],
    budget: 100,
    duration: 420,
    durations: [180, 420, 600],
    facilities: CITY_FACILITIES,
    demand: { vehicles: 140, pedestrians: 60, serviceVehicles: 6 },
    residents: residentVoices,
    layers: ["normal", "land", "traffic"],
    policies: PARKING_POLICIES,
    observationMetrics: ["illegalSeconds", "detouredPeople", "legal"],
    reflection: "어느 곳이 나아졌고, 아직 불편한 사람은 누구인가요?",
    create: (c, ids) =>
      new ParkingSimulation(
        c.seed,
        ids,
        c.parkingPlan,
        c.demand,
        c.pedestrians,
      ),
  },
  {
    id: "dumping",
    number: "06",
    title: "치웠는데 또 쌓이는 쓰레기",
    introduction:
      "골목·공터 옆·하천변에 봉투가 쌓여요. 지정된 곳의 쓰레기와 무단투기를 구분하고, 치운 뒤에도 다시 생기는지 조사해요.",
    request:
      "치우는 일과 다시 버리지 않게 하는 일을 함께 생각해 주세요. 원래 수거하던 집 앞도 잊지 말아 주세요.",
    standards: ["4사09-01", "4사08-02"],
    budget: 100,
    duration: DUMPING_DURATION,
    durations: [DUMPING_DURATION],
    facilities: CITY_FACILITIES,
    demand: { vehicles: 140, pedestrians: 60, serviceVehicles: 2 },
    residents: residentVoices,
    layers: ["normal", "land", "waste", "traffic"],
    policies: DUMPING_POLICIES,
    observationMetrics: [
      "illegalRemaining",
      "newDumped",
      "repeatDumped",
      "overflow",
      "normalRemaining",
    ],
    reflection:
      "무단투기와 정상 배출을 어떻게 구분했나요? 다시 쌓인 까닭과 함께 실천할 일을 적어 봐요.",
    create: (c, ids) => new DumpingSimulation(c.seed, ids, c.dumpingPlan),
  },
  {
    id: "water",
    number: "07",
    title: "강 아래쪽 물은 왜 더러울까요?",
    introduction:
      "상류와 하류를 조사하고 물에 섞인 오염과 떠 있는 쓰레기를 따로 살펴봐요.",
    request:
      "어디에서 들어온 오염인지 자료로 확인하고, 아래 동네에 어떤 변화가 생기는지도 봐 주세요.",
    standards: ["4사09-01", "4사08-02"],
    budget: 100,
    duration: WATER_DURATION,
    durations: [WATER_DURATION],
    facilities: CITY_FACILITIES,
    demand: { vehicles: 140, pedestrians: 60, serviceVehicles: 0 },
    residents: residentVoices,
    layers: ["normal", "water", "land", "traffic"],
    policies: WATER_POLICIES,
    observationMetrics: [
      "remaining",
      "entered",
      "treated",
      "outflow",
      "litterRemaining",
    ],
    reflection:
      "어떤 오염원에 효과가 있었나요? 하류와 다른 주민을 위해 다음에는 무엇을 바꾸고 싶나요?",
    create: (c, ids) => new WaterSimulation(c.seed, ids, c.waterPlan),
  },
];
export function getScenario(id: string) {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error("아직 열리지 않은 도시 문제예요.");
  return scenario;
}
