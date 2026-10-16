import { LogisticsSimulation } from "../simulation/economy";
import type { ResultMetric } from "./scenarios";
export function compareLogistics(
  before: LogisticsSimulation,
  after: LogisticsSimulation,
) {
  if (
    before.seed !== after.seed ||
    before.time !== after.time ||
    before.time < 1 ||
    JSON.stringify(before.demand) !== JSON.stringify(after.demand) ||
    JSON.stringify(before.pedestrians.demand) !==
      JSON.stringify(after.pedestrians.demand) ||
    before.shops.some(
      (s, i) =>
        s.initial !== after.shops[i]?.initial ||
        s.demandRate !== after.shops[i]?.demandRate,
    ) ||
    before.sources
      .filter((s) => s.id !== "west-region")
      .some((s) => {
        const other = after.sources.find((n) => n.id === s.id);
        return !other || s.initial !== other.initial || s.rate !== other.rate;
      })
  )
    throw new Error("같은 생산·소비 조건과 관찰 시간에서 비교해 주세요.");
  const a = before.logisticsStats,
    b = after.logisticsStats;
  const definitions = [
    ["delivered", "상점에 배송한 물자", "상자", false],
    ["unmet", "물건이 없어 사지 못한 양", "상자", true],
    ["stock", "상점에 남은 재고", "상자", null],
    ["stockoutShops", "품절을 겪은 상점", "곳", true],
    ["averageTravelTime", "평균 이동 · 도착 구간", "초", true],
    ["backgroundArrived", "일반 차량 도착", "대", false],
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
    shops: a.shops.map((s) => ({
      name: s.name,
      id: s.id,
      beforeUnmet: s.unmet,
      afterUnmet: b.shops.find((n) => n.id === s.id)!.unmet,
    })),
  };
}
