import * as THREE from "three";
import type { WasteSimulation } from "../simulation/services/waste";
import type { Selection } from "./city";
import { WASTE_DEPOT } from "../city/world";

export class WasteRenderer extends THREE.Group {
  readonly selectable: THREE.Object3D[] = [];
  private bins: { id: string; pile: THREE.Mesh }[] = [];
  private trucks = new Map<number, THREE.Group>();
  private materials: THREE.Material[] = [];
  constructor(private simulation: WasteSimulation) {
    super();
    const material = (color: number) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      this.materials.push(m);
      return m;
    };
    const dark = material(0x304c48),
      orange = material(0xd99839),
      cream = material(0xefe6cf),
      glass = material(0x466977),
      rubber = material(0x354246);
    const box = (
      g: THREE.Group,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      m: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    for (const site of simulation.sites) {
      if (site.kind) continue;
      const lane = simulation.network.lanes.get(site.laneId)!;
      const pose = simulation.lanePose(lane, lane.length - 7);
      const g = new THREE.Group();
      g.position.set(
        pose.x - Math.cos(pose.angle) * 6.9,
        0,
        pose.z + Math.sin(pose.angle) * 6.9,
      );
      g.rotation.y = pose.angle;
      this.add(g);
      const bin = box(g, 0, 1, 0, 1.5, 1.4, 2.1, dark);
      box(g, 0, 1.75, 0, 1.7, 0.18, 2.3, cream);
      const pile = box(g, -1.8, 0.5, 0, 1.4, 1, 2, orange);
      this.bins.push({ id: site.id, pile });
      const selection: Selection = {
        kind: "building",
        id: site.facilityId,
        title: site.name,
        description: "차가 도착한 뒤 멈춰서 수거해요.",
      };
      bin.userData.selection = selection;
      pile.userData.selection = selection;
      this.selectable.push(bin, pile);
    }
    // Depot is on an existing industrial block, beside its road access.
    const depot = new THREE.Group();
    depot.position.set(WASTE_DEPOT.x, 0, WASTE_DEPOT.z + 16);
    this.add(depot);
    const depotMesh = box(depot, 0, 1.5, 0, 6, 3, 4, dark);
    box(depot, 0, 3.1, 0, 6.5, 0.3, 4.5, cream);
    depotMesh.userData.selection = {
      kind: "building",
      id: WASTE_DEPOT.id,
      title: "쓰레기 처리시설",
      description: "수거차가 돌아와 적재한 쓰레기를 내려놓는 곳이에요.",
    };
    this.selectable.push(depotMesh);
    for (const truck of simulation.trucks) {
      const g = new THREE.Group();
      this.add(g);
      this.trucks.set(truck.id, g);
      const body = box(g, 0, 1.5, -0.6, 1.8, 1.6, 2.4, orange);
      box(g, 0, 1.15, 1.25, 1.8, 1.2, 1.3, cream);
      box(g, 0, 1.65, 1.62, 1.5, 0.6, 0.1, glass);
      box(g, 0, 2.43, -0.6, 0.9, 0.14, 1.4, cream);
      for (const z of [-1.2, 1.2]) box(g, 0, 0.65, z, 1.8, 0.5, 0.5, rubber);
      body.userData.selection = {
        kind: "service",
        id: String(truck.id),
        title: truck.name,
        description: "도로와 신호를 따라 이동하는 수거차예요.",
      } satisfies Selection;
      this.selectable.push(body);
    }
  }
  update(alpha: number) {
    for (const bin of this.bins) {
      const amount = this.simulation.sites.find(
        (s) => s.id === bin.id,
      )!.remaining;
      bin.pile.visible = amount > 0.05;
      bin.pile.scale.y = Math.max(0.1, Math.min(4, amount / 12));
      bin.pile.position.y = 0.3 + bin.pile.scale.y * 0.5;
    }
    for (const [id, g] of this.trucks) {
      const v = this.simulation.vehicles.get(id);
      g.visible = !!v;
      if (!v) continue;
      g.position.set(
        v.previousPose.x + (v.pose.x - v.previousPose.x) * alpha,
        0,
        v.previousPose.z + (v.pose.z - v.previousPose.z) * alpha,
      );
      g.rotation.y =
        v.previousPose.angle +
        Math.atan2(
          Math.sin(v.pose.angle - v.previousPose.angle),
          Math.cos(v.pose.angle - v.previousPose.angle),
        ) *
          alpha;
    }
  }
  dispose() {
    this.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.removeFromParent();
  }
}
