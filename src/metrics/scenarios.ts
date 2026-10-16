import { WasteSimulation } from "../simulation/services/waste";
import { WaterSimulation } from "../simulation/water";
import { compareWater } from "./water";
import { DumpingSimulation } from "../simulation/services/dumping";
import { compareDumping } from "./dumping";
import { ParkingSimulation } from "../simulation/parking";
import { compareParking } from "./parking";
import type { TrafficSimulation } from "../simulation";
import { compareExperiments } from "./comparison";
import { FacilitySimulation } from "../simulation/facilities";
import { compareFacilities } from "./facilities";
import { EnvironmentSimulation } from "../simulation/environment";
import { compareEnvironment } from "./environment";
import { LogisticsSimulation } from "../simulation/economy";
import { compareLogistics } from "./logistics";
export interface ResultMetric {
  label: string;
  before: number | null;
  after: number | null;
  unit: string;
  lower: boolean | null;
}
/** Shared result envelope; each system owns its own calculations. */
export function compareScenario(
  before: TrafficSimulation,
  after: TrafficSimulation,
) {
  if (before instanceof WaterSimulation && after instanceof WaterSimulation)
    return { scenarioId: "water", ...compareWater(before, after) };
  if (before instanceof WaterSimulation || after instanceof WaterSimulation)
    throw new Error("같은 도시 문제끼리 비교해 주세요.");
  if (before instanceof DumpingSimulation && after instanceof DumpingSimulation)
    return { scenarioId: "dumping", ...compareDumping(before, after) };
  if (before instanceof DumpingSimulation || after instanceof DumpingSimulation)
    throw new Error("같은 도시 문제끼리 비교해 주세요.");
  if (before instanceof ParkingSimulation && after instanceof ParkingSimulation)
    return { scenarioId: "parking", ...compareParking(before, after) };
  if (before instanceof ParkingSimulation || after instanceof ParkingSimulation)
    throw new Error("같은 도시 문제끼리 비교해 주세요.");
  if (
    before instanceof LogisticsSimulation &&
    after instanceof LogisticsSimulation
  )
    return { scenarioId: "logistics", ...compareLogistics(before, after) };
  if (
    before instanceof LogisticsSimulation ||
    after instanceof LogisticsSimulation
  )
    throw new Error("같은 도시 문제끼리 비교해 주세요.");
  if (
    before instanceof EnvironmentSimulation &&
    after instanceof EnvironmentSimulation
  )
    return { scenarioId: "environment", ...compareEnvironment(before, after) };
  if (
    before instanceof EnvironmentSimulation ||
    after instanceof EnvironmentSimulation
  )
    throw new Error("같은 도시 문제끼리 비교해 주세요.");
  if (
    before instanceof FacilitySimulation &&
    after instanceof FacilitySimulation
  )
    return { scenarioId: "facilities", ...compareFacilities(before, after) };
  if (
    before instanceof FacilitySimulation ||
    after instanceof FacilitySimulation
  )
    throw new Error("같은 도시 문제끼리 비교해 주세요.");
  if (before instanceof WasteSimulation && after instanceof WasteSimulation)
    return { scenarioId: "waste", ...compareWaste(before, after) };
  if (before instanceof WasteSimulation || after instanceof WasteSimulation)
    throw new Error("같은 도시 문제끼리 비교해 주세요.");
  const analysis = compareExperiments(before, after);
  const a = before.stats,
    b = after.stats;
  const rows: ResultMetric[] = [
    {
      label: "도착한 자동차",
      before: a.arrived,
      after: b.arrived,
      unit: "대",
      lower: false,
    },
    {
      label: "평균 이동 · 도착 차량",
      before: a.averageTravelTime,
      after: b.averageTravelTime,
      unit: "초",
      lower: true,
    },
    {
      label: "전체 1대당 누적 대기",
      before: a.averageDemandWait,
      after: b.averageDemandWait,
      unit: "초",
      lower: true,
    },
    {
      label: "보행자 1인당 누적 대기",
      before: before.pedestrians.stats.averageWaitingTime,
      after: after.pedestrians.stats.averageWaitingTime,
      unit: "초",
      lower: true,
    },
  ];
  return { scenarioId: "traffic", rows, analysis };
}
export function compareWaste(before: WasteSimulation, after: WasteSimulation) {
  if (
    before.seed !== after.seed ||
    Math.abs(before.time - after.time) > 1e-7 ||
    JSON.stringify(before.demand) !== JSON.stringify(after.demand) ||
    JSON.stringify(before.pedestrians.demand) !==
      JSON.stringify(after.pedestrians.demand) ||
    before.sites.some(
      (s, i) =>
        s.initial !== after.sites[i]?.initial ||
        s.rate !== after.sites[i]?.rate ||
        s.participation !== after.sites[i]?.participation,
    )
  )
    throw new Error("같은 아침과 관찰 시간에서 비교해 주세요.");
  const a = before.wasteStats,
    b = after.wasteStats;
  const rows: ResultMetric[] = [
    {
      label: "전체 수거율",
      before: a.collectionRate,
      after: b.collectionRate,
      unit: "%",
      lower: false,
    },
    {
      label: "남은 일반 쓰레기",
      before: a.remaining,
      after: b.remaining,
      unit: "봉투",
      lower: true,
    },
    {
      label: "새로 나온 쓰레기",
      before: a.generated,
      after: b.generated,
      unit: "봉투",
      lower: true,
    },
    {
      label: "한 차례 수거를 마친 곳",
      before: a.completedSites,
      after: b.completedSites,
      unit: "곳",
      lower: false,
    },
    {
      label: "차량 평균 구간 이동 · 도착 구간",
      before: a.averageTravelTime,
      after: b.averageTravelTime,
      unit: "초",
      lower: true,
    },
    {
      label: "일반 차량 도착",
      before: before.stats.arrived,
      after: after.stats.arrived,
      unit: "대",
      lower: false,
    },
    {
      label: "정책 비용",
      before: a.cost,
      after: b.cost,
      unit: "",
      lower: null,
    },
  ];
  return {
    rows,
    sites: a.sites.map((s) => ({
      ...s,
      beforeRemaining: s.remaining,
      afterRemaining: b.sites.find((t) => t.id === s.id)!.remaining,
    })),
    before: a,
    after: b,
  };
}
