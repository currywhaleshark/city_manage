import { BUILDABLE_PLOTS } from "./world";

export interface ParcelUse {
  siteId: string;
  kind: "library" | "park" | "parking" | "water";
}
export const PARCEL_AREA = {
  library: 400,
  park: 900,
  parking: 400,
  water: 144,
} as const;
/** Every construction system uses the same finite parcels and occupancy rule. */
export function validateParcelUses(uses: readonly ParcelUse[]) {
  const occupied = new Set<string>();
  for (const use of uses) {
    const plot = BUILDABLE_PLOTS.find((p) => p.id === use.siteId);
    if (!plot || !Object.prototype.hasOwnProperty.call(PARCEL_AREA, use.kind))
      throw new Error("건설 부지를 확인해 주세요.");
    if (occupied.has(use.siteId))
      throw new Error("한 부지에는 한 시설만 지을 수 있어요.");
    if (plot.width * plot.depth < PARCEL_AREA[use.kind])
      throw new Error("공터 면적이 부족해요.");
    occupied.add(use.siteId);
  }
}
