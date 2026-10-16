import { FacilitySimulation } from "../simulation/facilities";
import type { ResultMetric } from "./scenarios";
export function compareFacilities(
  before: FacilitySimulation,
  after: FacilitySimulation,
) {
  if (
    before.seed !== after.seed ||
    JSON.stringify(before.neighborhoods) !== JSON.stringify(after.neighborhoods)
  )
    throw new Error("같은 주민 수요로 계획을 비교해 주세요.");
  const a = before.facilityStats,
    b = after.facilityStats;
  const rows: ResultMetric[] = [
    {
      label: "거리·정원이 맞는 주민",
      before: a.served,
      after: b.served,
      unit: "명",
      lower: false,
    },
    {
      label: "이용하기 어려운 주민",
      before: a.unserved,
      after: b.unserved,
      unit: "명",
      lower: true,
    },
    {
      label: "가까워도 자리가 부족한 주민",
      before: a.capacityShortfall,
      after: b.capacityShortfall,
      unit: "명",
      lower: true,
    },
    {
      label: "가장 가까운 시설까지 · 예상 평균",
      before: a.averageNearestSeconds / 60,
      after: b.averageNearestSeconds / 60,
      unit: "분",
      lower: true,
    },
    {
      label: "하루 전체 이용 자리",
      before: a.capacity,
      after: b.capacity,
      unit: "명분",
      lower: null,
    },
    {
      label: "남은 예산",
      before: a.remainingBudget,
      after: b.remainingBudget,
      unit: "",
      lower: null,
    },
  ];
  return {
    rows,
    before: a,
    after: b,
    neighborhoods: a.neighborhoods.map((row) => ({
      ...row,
      beforeServed: row.served,
      afterServed: b.neighborhoods.find((r) => r.id === row.id)!.served,
    })),
  };
}
