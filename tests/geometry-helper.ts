import { CONFIG } from "../src/scenario";
import type { Pose } from "../src/types";
export function overlaps(a: Pose, b: Pose) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  if (dx * dx + dz * dz > 25) return false;
  const af = { x: Math.sin(a.angle), z: Math.cos(a.angle) },
    ar = { x: Math.cos(a.angle), z: -Math.sin(a.angle) };
  const bf = { x: Math.sin(b.angle), z: Math.cos(b.angle) },
    br = { x: Math.cos(b.angle), z: -Math.sin(b.angle) };
  for (const n of [af, ar, bf, br]) {
    const separation = Math.abs(dx * n.x + dz * n.z);
    const ra =
      (CONFIG.carLength / 2) * Math.abs(af.x * n.x + af.z * n.z) +
      0.9 * Math.abs(ar.x * n.x + ar.z * n.z);
    const rb =
      (CONFIG.carLength / 2) * Math.abs(bf.x * n.x + bf.z * n.z) +
      0.9 * Math.abs(br.x * n.x + br.z * n.z);
    if (separation >= ra + rb - 0.02) return false;
  }
  return true;
}
