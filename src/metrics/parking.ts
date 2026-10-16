import { ParkingSimulation } from "../simulation/parking";
import type { ResultMetric } from "./scenarios";
export function compareParking(
  before: ParkingSimulation,
  after: ParkingSimulation,
) {
  if (
    before.seed !== after.seed ||
    before.time !== after.time ||
    before.time < 1 ||
    JSON.stringify(before.demand) !== JSON.stringify(after.demand) ||
    JSON.stringify(before.pedestrians.demand) !==
      JSON.stringify(after.pedestrians.demand) ||
    JSON.stringify(before.parkingDemand) !== JSON.stringify(after.parkingDemand)
  )
    throw new Error(
      "같은 차량·보행자·주차 수요와 관찰 시간에서 비교해 주세요.",
    );
  const a = before.parkingStats,
    b = after.parkingStats;
  const rows: ResultMetric[] = [
    {
      label: "불법주차가 차지한 시간 합계",
      before: a.illegalSeconds / 60,
      after: b.illegalSeconds / 60,
      unit: "분",
      lower: true,
    },
    {
      label: "차를 피해 돌아간 보행자",
      before: a.detouredPeople,
      after: b.detouredPeople,
      unit: "명",
      lower: true,
    },
    {
      label: "보행자가 더 걸은 거리 합계",
      before: a.extraWalkingDistance,
      after: b.extraWalkingDistance,
      unit: "m",
      lower: true,
    },
    {
      label: "정해진 자리를 이용한 차",
      before: a.legal,
      after: b.legal,
      unit: "대",
      lower: false,
    },
    {
      label: "일반 차량 도착",
      before: before.stats.arrived,
      after: after.stats.arrived,
      unit: "대",
      lower: false,
    },
    {
      label: "주차 뒤 예상 보행 거리 합계",
      before: a.parkingWalkDistance,
      after: b.parkingWalkDistance,
      unit: "m",
      lower: null,
    },
    {
      label: "사용 예산",
      before: a.cost,
      after: b.cost,
      unit: "",
      lower: null,
    },
  ];
  return {
    before: a,
    after: b,
    rows,
    sites: a.sites.map((s) => ({
      id: s.id,
      name: s.name,
      before: s.illegalSeconds / 60,
      after: b.sites.find((t) => t.id === s.id)!.illegalSeconds / 60,
    })),
  };
}
