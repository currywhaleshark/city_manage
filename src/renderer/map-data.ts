import { WALK_LIMIT_SECONDS } from "../simulation/facilities";

export const SERVICE_VEHICLE_COLORS = { waste: 0x208572, stock: 0x356cbc };

/** Fixed scales allow comparison across runs; a new maximum never recolors other places. */
export const WASTE_COLOR_STOPS = [0xffffff, 0xd9bea0, 0xa66a3f, 0x542c18];
export const WASTE_COLOR_MAX = 60;
export function wasteColor(bags: number): number {
  const value = Math.max(0, Math.min(WASTE_COLOR_MAX, bags)) / 20;
  const index = Math.min(2, Math.floor(value));
  const t = value - index;
  const a = WASTE_COLOR_STOPS[index],
    b = WASTE_COLOR_STOPS[index + 1];
  return [16, 8, 0].reduce(
    (hex, shift) =>
      hex |
      (Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) <<
        shift),
    0,
  );
}
export const ACCESS_BANDS = [
  { id: "green", max: 120, color: 0x52ad72, label: "2분 이내" },
  { id: "yellow", max: 240, color: 0xe4c34d, label: "2~4분" },
  { id: "orange", max: WALK_LIMIT_SECONDS, color: 0xe58b40, label: "4~5분" },
  { id: "red", max: Infinity, color: 0xd95b51, label: "5분 초과·길 없음" },
] as const;
export function accessBand(seconds: number | null) {
  return ACCESS_BANDS.find((band) => (seconds ?? Infinity) <= band.max + 1e-8)!;
}
export const cssColor = (hex: number) =>
  `#${hex.toString(16).padStart(6, "0")}`;
export const STOCK_BANDS = [
  { id: "red", max: 0.05, color: 0xd95b51, label: "품절" },
  { id: "orange", max: 5, color: 0xe58b40, label: "5상자 미만" },
  { id: "yellow", max: 15, color: 0xe4c34d, label: "5~15상자 미만" },
  { id: "green", max: Infinity, color: 0x52ad72, label: "15상자 이상" },
] as const;
export const stockBand = (stock: number) =>
  STOCK_BANDS.find((b) => stock < b.max)!;
