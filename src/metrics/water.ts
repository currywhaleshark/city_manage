import { WaterSimulation } from "../simulation/water";
export function compareWater(before: WaterSimulation, after: WaterSimulation) {
  if (
    before.seed !== after.seed ||
    before.time !== after.time ||
    JSON.stringify(before.schedule) !== JSON.stringify(after.schedule) ||
    JSON.stringify(before.demand) !== JSON.stringify(after.demand) ||
    JSON.stringify(before.pedestrians.demand) !==
      JSON.stringify(after.pedestrians.demand)
  )
    throw new Error("같은 유량·유입 일정·관찰 시간끼리 비교해 주세요.");
  const a = before.waterStats,
    b = after.waterStats;
  const rows = (
    [
      ["remaining", "하천에 남은 오염", "가상단위", true],
      ["entered", "강에 들어온 새 오염 · 누적", "가상단위", true],
      ["treated", "유입 전에 처리한 양 · 누적", "가상단위", false],
      ["outflow", "지도 밖 하류로 나간 오염 · 누적", "가상단위", true],
      ["litterRemaining", "둔치·물 위에 남은 쓰레기", "봉투", true],
      ["litterCollected", "모아 처리한 쓰레기 · 누적", "봉투", false],
      ["litterOutflow", "지도 밖으로 나간 쓰레기 · 누적", "봉투", true],
      ["cost", "사용 예산", "", null],
    ] as const
  ).map(([key, label, unit, lower]) => ({
    label,
    before: a[key],
    after: b[key],
    unit,
    lower,
  }));
  return {
    rows,
    before: a,
    after: b,
    sites: a.sites.map((s, i) => ({
      name: s.name,
      before: s.level,
      after: b.sites[i].level,
    })),
  };
}
