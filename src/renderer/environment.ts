import * as THREE from "three";
import {
  EnvironmentSimulation,
  DEVELOPMENT_SITES,
  BUFFER_STRIPS,
  ENVIRONMENT_PLACES,
  burdenLevel,
} from "../simulation/environment";
import type { Selection } from "./city";
import type { MapLayer } from "../scenarios";

export class EnvironmentRenderer extends THREE.Group {
  readonly selectable: THREE.Object3D[] = [];
  private owned: THREE.Material[] = [];
  private labels: {
    element: HTMLElement;
    position: THREE.Vector3;
    regionId?: string;
  }[] = [];
  private discs: {
    mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
    regionId: string;
  }[] = [];
  private lastSample = -1;
  constructor(
    readonly simulation: EnvironmentSimulation,
    root: HTMLElement,
  ) {
    super();
    const material = (color: number) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      this.owned.push(m);
      return m;
    };
    const grass = material(0x9eb578),
      stone = material(0xc1c5ba),
      industry = material(0x97a19e),
      home = material(0xe1c796),
      roof = material(0x668482),
      leaf = material(0x738f59),
      trunk = material(0x99876a);
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      m: THREE.Material,
      selection?: Selection,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.add(mesh);
      if (selection) {
        mesh.userData.selection = selection;
        this.selectable.push(mesh);
      }
      return mesh;
    };
    const tree = (x: number, z: number) => {
      box(x, 1.3, z, 0.6, 2, 0.6, trunk);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.7, 4.5, 5), leaf);
      crown.position.set(x, 4, z);
      crown.castShadow = true;
      this.add(crown);
    };
    const label = (
      text: string,
      position: { x: number; z: number },
      regionId?: string,
    ) => {
      const element = document.createElement("span");
      element.className = "map-label environment-label";
      element.textContent = text;
      root.append(element);
      this.labels.push({
        element,
        position: new THREE.Vector3(position.x, regionId ? 15 : 5, position.z),
        regionId,
      });
    };
    for (const site of DEVELOPMENT_SITES) {
      const parcel = simulation.parcels.find((p) => p.id === site.id)!;
      const { x, z } = site.position;
      const selection: Selection = {
        kind: "development",
        id: site.id,
        title: site.name,
        description: "개발된 면적과 남은 녹지를 비교하는 지정 부지예요.",
      };
      box(x, 0.4, z, 24, 0.25, 12, grass, selection);
      if (parcel.developedArea) {
        const width = parcel.developedArea / 12,
          cx = x + 12 - width / 2;
        box(cx, 0.6, z, width, 0.25, 12, stone, selection);
        box(
          cx,
          site.id === "industry" ? 3.5 : 5,
          z,
          width - 1,
          site.id === "industry" ? 6 : 9,
          10,
          site.id === "industry" ? industry : home,
          selection,
        );
        box(
          cx,
          site.id === "industry" ? 6.7 : 9.7,
          z,
          width,
          0.5,
          10.5,
          roof,
          selection,
        );
        if (site.id === "industry")
          box(cx + width / 4, 7, z + 2, 1.3, 7, 1.3, stone, selection);
        else
          for (const dz of [-3, 1])
            box(cx, 6.5, z + dz, width - 2, 0.8, 0.2, roof);
      }
      // Trees stay on the undeveloped portion; their land area is preserved in the model.
      for (let dx = -9; dx < 12 - parcel.developedArea / 12; dx += 5)
        tree(x + dx, z + 2);
      label(
        `${site.id === "industry" ? "산업" : "주거"} 부지 · 녹지 ${parcel.greenArea}㎡`,
        site.position,
      );
    }
    for (const strip of BUFFER_STRIPS) {
      box(
        (strip.minX + strip.maxX) / 2,
        0.35,
        (strip.minZ + strip.maxZ) / 2,
        4,
        0.15,
        strip.maxZ - strip.minZ,
        grass,
      );
      if (simulation.configuration.buffer)
        for (let z = strip.minZ + 2; z < strip.maxZ; z += 5) tree(58, z);
    }
    if (simulation.configuration.buffer)
      label("완충 녹지 · 184㎡", { x: 58, z: 77 });
    for (const place of ENVIRONMENT_PLACES) {
      label("", place.position, place.id);
      const m = new THREE.MeshBasicMaterial({
        color: 0x6d9e91,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      });
      this.owned.push(m);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(17, 32), m);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(place.position.x, 0.65, place.position.z);
      this.add(disc);
      this.discs.push({ mesh: disc, regionId: place.id });
    }
  }
  update(camera: THREE.Camera, width: number, height: number, layer: MapLayer) {
    if (this.lastSample !== Math.floor(this.simulation.time)) {
      this.lastSample = Math.floor(this.simulation.time);
      for (const region of this.simulation.environmentStats.regions) {
        const level = burdenLevel(region.currentBurden);
        const label = this.labels.find((l) => l.regionId === region.id)!;
        label.element.textContent = `${level} · ${region.currentBurden.toFixed(1)}점(가상)`;
        label.element.dataset.level = level;
        this.discs
          .find((d) => d.regionId === region.id)!
          .mesh.material.color.setHex(
            level === "낮음"
              ? 0x609a8e
              : level === "중간"
                ? 0xd4ac58
                : 0xc87855,
          );
      }
    }
    for (const label of this.labels) {
      const p = label.position.clone().project(camera);
      label.element.hidden =
        p.z < -1 || p.z > 1 || (!!label.regionId && layer !== "environment");
      label.element.style.left = `${((p.x + 1) / 2) * width}px`;
      label.element.style.top = `${((1 - p.y) / 2) * height}px`;
    }
    this.discs.forEach((d) => {
      d.mesh.visible = layer === "environment";
    });
  }
  dispose() {
    this.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.owned.forEach((m) => m.dispose());
    this.labels.forEach((l) => l.element.remove());
    this.removeFromParent();
  }
}
