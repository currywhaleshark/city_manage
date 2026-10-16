/** Coordinates shared by the road, parcel, service and drawing layers. */
export const CITY_LAYOUT_VERSION = "river-districts-v3";
export const WORLD = {
  center: 96,
  size: 468,
  gridMax: 8,
  min: -138,
  max: 330,
} as const;
export const RIVER = {
  x: 120,
  width: 24,
  bridges: [1, 4, 7],
  name: "새봄천",
} as const;
/** Leave a clear road-width opening through both riverbanks at every bridge. */
export const RIVERBANK_SEGMENTS = (() => {
  const segments: { minZ: number; maxZ: number }[] = [];
  let minZ: number = WORLD.min;
  for (const row of RIVER.bridges) {
    const z = (row - 2) * 48;
    segments.push({ minZ, maxZ: z - 6 });
    minZ = z + 6;
  }
  segments.push({ minZ, maxZ: WORLD.max });
  return segments;
})();
export const FACTORY = { x: 216, z: 168 };
export const WASTE_DEPOT = {
  id: "waste-treatment",
  x: 264,
  z: 216,
  roadId: "n7-7_n8-7",
  from: "n7-7",
  origin: "n8-7",
};
export const DEVELOPMENT_PLOTS = {
  industry: { x: 216, z: 216 },
  housing: { x: -24, z: 168 },
};
export const BUILDABLE_PLOTS = [
  {
    id: "north",
    name: "A · 햇살 주거 공터",
    position: { x: -72, z: 120 },
    width: 30,
    depth: 30,
    district: "주거지구",
  },
  {
    id: "west",
    name: "B · 작은 골목 공터",
    position: { x: -72, z: 216 },
    width: 22,
    depth: 22,
    district: "주거지구",
  },
  {
    id: "south",
    name: "C · 남쪽 생활 공터",
    position: { x: 24, z: 264 },
    width: 34,
    depth: 34,
    district: "상업지구",
  },
  {
    id: "riverside",
    name: "D · 하천 옆 공터",
    position: { x: 72, z: 72 },
    width: 34,
    depth: 34,
    district: "상업지구",
  },
  {
    id: "market",
    name: "E · 시장 옆 공터",
    position: { x: 216, z: -24 },
    width: 26,
    depth: 26,
    district: "상업지구",
  },
  {
    id: "industry",
    name: "F · 산업지구 공터",
    position: { x: 264, z: 264 },
    width: 34,
    depth: 34,
    district: "산업지구",
  },
] as const;
export const EXTERNAL_CONNECTIONS = [
  {
    id: "west",
    name: "강빛마을",
    x: -168,
    edgeX: WORLD.min,
    cityX: 0,
    warehouse: { x: -181, z: 24 },
  },
  {
    id: "east",
    name: "들녘마을",
    x: 360,
    edgeX: WORLD.max,
    cityX: 8,
    warehouse: { x: 373, z: 24 },
  },
] as const;
export const boundaryNode = (side: "west" | "east", row: 0 | 1) =>
  `boundary-${side}-${row}`;
export const inCityBounds = (p: { x: number; z: number }) =>
  p.x >= WORLD.min && p.x <= WORLD.max && p.z >= WORLD.min && p.z <= WORLD.max;
/** All boundary links are axis aligned. Clip their drawing, not their routing. */
export function visibleRoadSegment(
  a: { x: number; z: number },
  b: { x: number; z: number },
) {
  if (
    Math.max(a.x, b.x) <= WORLD.min ||
    Math.min(a.x, b.x) >= WORLD.max ||
    Math.max(a.z, b.z) < WORLD.min ||
    Math.min(a.z, b.z) > WORLD.max
  )
    return null;
  const clamp = (n: number) => Math.max(WORLD.min, Math.min(WORLD.max, n));
  return {
    a: { x: clamp(a.x), z: clamp(a.z) },
    b: { x: clamp(b.x), z: clamp(b.z) },
  };
}
export function externalGatewayPosition(id: string) {
  const side = EXTERNAL_CONNECTIONS.find((s) => id === `${s.id}-region`)!;
  return { x: side.edgeX + (side.id === "west" ? 8 : -8), z: 24 };
}
export const DISTRICT_AREAS = [
  {
    id: "residential",
    name: "햇살 주거지구",
    x: -48,
    z: 96,
    width: 90,
    depth: 378,
    color: 0xb8cba9,
  },
  {
    id: "commercial",
    name: "중앙 상업지구",
    x: 48,
    z: 96,
    width: 90,
    depth: 378,
    color: 0xd2ceb7,
  },
  {
    id: "market",
    name: "강너머 상업지구",
    x: 216,
    z: -24,
    width: 138,
    depth: 138,
    color: 0xd2ceb7,
  },
  {
    id: "industrial",
    name: "강너머 산업지구",
    x: 216,
    z: 168,
    width: 138,
    depth: 234,
    color: 0xbdc4c2,
  },
] as const;
