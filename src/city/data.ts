import { BUILDINGS } from "../scenario";

export const DISTRICTS = [
  { id: "nw", name: "햇살 주거지구" },
  { id: "ne", name: "중앙·강너머 상업지구" },
  { id: "sw", name: "남쪽 주거지구" },
  { id: "se", name: "강너머 산업지구" },
] as const;
export type DistrictId = (typeof DISTRICTS)[number]["id"];
export interface CityFacility {
  id: string;
  kind: string;
  name: string;
  position: { x: number; z: number };
  districtId: DistrictId;
  purpose: string;
  population: number;
  users: number;
  serviceDemand: { wastePerMinute: number };
  environment: { noiseSource: number };
  residentGroups: string[];
}
/** Educational virtual population for the shared district layout. */
export const CITY_FACILITIES: readonly CityFacility[] = BUILDINGS.map(
  (b, i) => ({
    id: b.id,
    kind: b.kind,
    name: b.name,
    position: { x: b.x, z: b.z },
    districtId: (b.x >= 144 && b.z >= 48
      ? "se"
      : b.x >= 0
        ? "ne"
        : b.z < 96
          ? "nw"
          : "sw") as DistrictId,
    purpose: (
      {
        home: "주거",
        school: "배움",
        park: "휴식",
        office: "장보기·일하기",
        factory: "생산",
        waste: "쓰레기 처리·자원 순환",
      } as Record<string, string>
    )[b.kind],
    population: b.kind === "home" ? 80 + (i % 3) * 20 : 0,
    users: b.kind === "school" ? 240 : b.kind === "park" ? 60 : 100,
    serviceDemand: {
      wastePerMinute: b.kind === "home" ? 1.2 : b.kind === "office" ? 1.8 : 0.8,
    },
    environment: { noiseSource: b.kind === "factory" ? 3 : 1 },
    residentGroups:
      b.kind === "home"
        ? ["residents", "elders"]
        : b.kind === "school"
          ? ["families"]
          : b.kind === "factory"
            ? ["workers"]
            : ["merchants", "residents"],
  }),
);
export const districtName = (id: DistrictId) =>
  DISTRICTS.find((d) => d.id === id)!.name;
