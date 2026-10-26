import * as THREE from "three";
import type { TrafficSimulation } from "../simulation";
import { BRIDGE_HEIGHT, BRIDGE_RAMP } from "./structures";

/** Four draw calls for all walkers; gait follows distance, including pause and replay. */
export class PedestrianRenderer extends THREE.Group {
  private torso = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.54, 0.65, 0.34),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    512,
  );
  private heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.24, 7, 5),
    new THREE.MeshStandardMaterial({ color: 0xe6b38a }),
    512,
  );
  private legs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.17, 0.55, 0.19),
    new THREE.MeshStandardMaterial({ color: 0x354b60 }),
    1024,
  );
  private bags = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.38, 0.43, 0.19),
    new THREE.MeshStandardMaterial({ color: 0xf4d57a }),
    512,
  );
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  constructor() {
    super();
    for (const mesh of [this.torso, this.heads, this.legs, this.bags]) {
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.add(mesh);
    }
  }
  update(sim: TrafficSimulation, alpha: number) {
    let i = 0;
    for (const p of sim.pedestrians.active.values()) {
      if (i >= 512) break;
      const x = p.previousPose.x + (p.pose.x - p.previousPose.x) * alpha;
      const z = p.previousPose.z + (p.pose.z - p.previousPose.z) * alpha;
      const angle =
        p.previousPose.angle +
        Math.atan2(
          Math.sin(p.pose.angle - p.previousPose.angle),
          Math.cos(p.pose.angle - p.previousPose.angle),
        ) *
          alpha;
      const distance =
        p.previousDistance + (p.distance - p.previousDistance) * alpha;
      // On a footbridge, climb at each end of the crossing.
      const route = sim.pedestrians.routes.get(p.trip.routeId);
      const path = p.path ?? route;
      const lift =
        route && path && sim.pedestrians.bridges.has(route.nodeId) &&
        distance > path.crossingStart && distance < path.crossingEnd
          ? BRIDGE_HEIGHT * Math.min(1,
            (distance - path.crossingStart) / BRIDGE_RAMP,
            (path.crossingEnd - distance) / BRIDGE_RAMP)
          : 0;
      const gait =
        p.distance > p.previousDistance + 0.001
          ? Math.sin(distance * 8) * 0.45
          : 0;
      const place = (
        mesh: THREE.InstancedMesh,
        index: number,
        dx: number,
        y: number,
        dz: number,
        swing = 0,
      ) => {
        this.dummy.position.set(
          x + Math.cos(angle) * dx + Math.sin(angle) * dz,
          y + lift,
          z - Math.sin(angle) * dx + Math.cos(angle) * dz,
        );
        this.dummy.rotation.set(0, angle, 0);
        this.dummy.rotateX(swing);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
      };
      place(this.torso, i, 0, 1.27, 0);
      this.torso.setColorAt(i, this.color.setHex(p.trip.color));
      place(this.heads, i, 0, 1.88, 0);
      place(this.bags, i, 0, 1.28, -0.24);
      place(this.legs, i * 2, -0.15, 0.68, gait * 0.2, gait);
      place(this.legs, i * 2 + 1, 0.15, 0.68, -gait * 0.2, -gait);
      i++;
    }
    for (const mesh of [this.torso, this.heads, this.legs, this.bags]) {
      mesh.count = mesh === this.legs ? i * 2 : i;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.torso.instanceColor) this.torso.instanceColor.needsUpdate = true;
  }
}
