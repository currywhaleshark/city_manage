import * as THREE from "three";
import type { LiveCitySimulation } from "../simulation/live";
import { walkingPose } from "../simulation/pedestrians";
import { BUILDABLE_PLOTS } from "../city/world";

/** Deck height of a footbridge; walkers on it are lifted to the same height. */
export const BRIDGE_HEIGHT = 5.5;
/** Length over which walkers climb at each end of a footbridge. */
export const BRIDGE_RAMP = 3;

/** Footbridges and the expanded recycling centre bought in the living city. */
export class StructureRenderer extends THREE.Group {
  private deck = new THREE.MeshStandardMaterial({ color: 0x8fa3ad, roughness: 0.7 });
  private post = new THREE.MeshStandardMaterial({ color: 0x5f6f78, roughness: 0.8 });
  private shed = new THREE.MeshStandardMaterial({ color: 0x5d8a6e, roughness: 0.85 });
  constructor(sim: LiveCitySimulation) {
    super();
    for (const a of sim.activeActions) {
      if (a.id === "footbridge") this.footbridge(sim, a.target);
      if (a.id === "depot") this.depot(a.target);
    }
  }
  private footbridge(sim: LiveCitySimulation, nodeId: string) {
    const route = [...sim.pedestrians.routes.values()].find((r) => r.nodeId === nodeId);
    if (!route) return;
    const a = walkingPose(route, route.crossingStart),
      b = walkingPose(route, route.crossingEnd);
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const angle = Math.atan2(b.x - a.x, b.z - a.z);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, length + 2), this.deck);
    deck.position.set((a.x + b.x) / 2, BRIDGE_HEIGHT - 0.2, (a.z + b.z) / 2);
    deck.rotation.y = angle;
    deck.castShadow = deck.receiveShadow = true;
    this.add(deck);
    for (const end of [a, b]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, BRIDGE_HEIGHT, 2.6), this.post);
      tower.position.set(end.x, BRIDGE_HEIGHT / 2, end.z);
      tower.rotation.y = angle;
      tower.castShadow = true;
      this.add(tower);
    }
  }
  private depot(siteId: string) {
    const plot = BUILDABLE_PLOTS.find((p) => p.id === siteId);
    if (!plot) return;
    const shed = new THREE.Mesh(
      new THREE.BoxGeometry(plot.width - 8, 7, plot.depth - 12),
      this.shed,
    );
    shed.position.set(plot.position.x, 3.5, plot.position.z);
    shed.castShadow = shed.receiveShadow = true;
    this.add(shed);
  }
  dispose() {
    this.removeFromParent();
    this.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of [this.deck, this.post, this.shed]) m.dispose();
  }
}
