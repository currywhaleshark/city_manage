import type { Camera } from "three";
/** Camera motion stays responsive; stationary text/layout updates at 10 Hz. */
export class LabelClock {
  private nextAt = 0;
  private last: number[] = [];
  due(camera: Camera, width: number, height: number) {
    const p = camera.position,
      q = camera.quaternion,
      m = camera.projectionMatrix.elements;
    const state = [
      p.x,
      p.y,
      p.z,
      q.x,
      q.y,
      q.z,
      q.w,
      m[0],
      m[5],
      width,
      height,
    ];
    const now = performance.now();
    if (now < this.nextAt && state.every((n, i) => n === this.last[i]))
      return false;
    this.last = state;
    this.nextAt = now + 100;
    return true;
  }
}
