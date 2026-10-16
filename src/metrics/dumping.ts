import { DumpingSimulation } from "../simulation/services/dumping";
export function compareDumping(
  before: DumpingSimulation,
  after: DumpingSimulation,
) {
  if (
    before.seed !== after.seed ||
    Math.abs(before.time - after.time) > 1e-7 ||
    JSON.stringify(before.disposalDemand) !==
      JSON.stringify(after.disposalDemand) ||
    JSON.stringify(before.demand) !== JSON.stringify(after.demand) ||
    before.sites.some(
      (s, i) =>
        s.initial !== after.sites[i]?.initial ||
        s.rate !== after.sites[i]?.rate,
    )
  )
    throw new Error("같은 배출 수요와 관찰 회차끼리 비교해 주세요.");
  const a = before.dumpingStats,
    b = after.dumpingStats;
  const rows = (
    [
      ["illegalRemaining", "남은 무단투기", "봉투"],
      ["newDumped", "새로 버린 투기물", "봉투"],
      ["repeatDumped", "청소 뒤 다시 버린 양", "봉투"],
      ["overflow", "지정 장소에서 넘친 양", "봉투"],
      ["normalRemaining", "기존 수거장에 남은 양", "봉투"],
      ["remaining", "도시 전체에 남은 양", "봉투"],
      ["collected", "수거차가 치운 양", "봉투"],
      ["cost", "사용 예산", ""],
    ] as const
  ).map(([key, label, unit]) => ({
    label,
    before: a[key],
    after: b[key],
    unit,
    lower: key === "cost" ? null : key !== "collected",
  }));
  return {
    rows,
    before: a,
    after: b,
    sites: a.sites.map((s) => ({
      id: s.id,
      name: s.name,
      before: s.remaining,
      after: b.sites.find((t) => t.id === s.id)!.remaining,
    })),
  };
}
