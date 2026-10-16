import { EnvironmentSimulation } from "../simulation/environment";
import type { ResultMetric } from "./scenarios";
export function compareEnvironment(
  before: EnvironmentSimulation,
  after: EnvironmentSimulation,
) {
  if (
    before.seed !== after.seed ||
    before.time !== after.time ||
    before.time < 1 ||
    JSON.stringify(before.backgroundDemand) !==
      JSON.stringify(after.backgroundDemand) ||
    JSON.stringify(before.pedestrians.demand) !==
      JSON.stringify(after.pedestrians.demand)
  )
    throw new Error("같은 기존 교통·보행 수요와 관찰 시간에서 비교해 주세요.");
  const a = before.environmentStats,
    b = after.environmentStats;
  const definitions = [
    ["developedArea", "개발한 면적", "㎡", null],
    ["greenArea", "대상 부지에 남은 녹지", "㎡", false],
    ["workCapacity", "새 일터 이용 자리", "명분", null],
    ["housingCapacity", "새 거주 공간", "명분", null],
    ["addedTrips", "개발로 추가된 차량 수요", "건", null],
    ["backgroundArrived", "기존 차량 도착 · 같은 140대", "대", false],
    ["meanBurden", "장소별 평균 환경 부담 · 가상", "점", true],
    ["remainingBudget", "남은 예산", "", null],
  ] as const;
  const rows: ResultMetric[] = definitions.map(([key, label, unit, lower]) => ({
    label,
    before: a[key],
    after: b[key],
    unit,
    lower,
  }));
  return {
    before: a,
    after: b,
    rows,
    regions: a.regions.map((row, i) => ({
      ...row,
      beforeBurden: row.meanBurden!,
      afterBurden: b.regions[i].meanBurden!,
    })),
  };
}
