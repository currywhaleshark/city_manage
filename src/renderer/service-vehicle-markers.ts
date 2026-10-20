import * as THREE from "three";
import type { MapLayer } from "../scenarios";
import { SERVICE_VEHICLE_COLORS } from "./map-data";

const DIAMETER_PX = 16;

/** Small hollow rings leave the truck visible and never intercept map clicks. */
export class ServiceVehicleMarkers {
  private markers: THREE.Sprite[] = [];
  private texture: THREE.DataTexture;
  private material: THREE.SpriteMaterial;

  constructor(private layer: "waste" | "stock") {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    const color = SERVICE_VEHICLE_COLORS[layer];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const radius = Math.hypot(
          (x + 0.5 - size / 2) / (size / 2),
          (y + 0.5 - size / 2) / (size / 2),
        );
        const colored = radius > 0.56 && radius < 0.83;
        const offset = (y * size + x) * 4;
        for (const [channel, shift] of [16, 8, 0].entries())
          pixels[offset + channel] = colored ? (color >> shift) & 255 : 255;
        pixels[offset + 3] = Math.round(
          255 * THREE.MathUtils.clamp(
            Math.min((radius - 0.43) / 0.04, (0.98 - radius) / 0.04),
            0,
            1,
          ),
        );
      }
    this.texture = new THREE.DataTexture(pixels, size, size);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
  }

  attach(truck: THREE.Group) {
    const marker = new THREE.Sprite(this.material);
    marker.name = `${this.layer}-vehicle-marker`;
    marker.position.y = 3;
    marker.renderOrder = 20;
    marker.visible = false;
    marker.raycast = () => {};
    // The sprite inherits the truck's interpolated position and visibility.
    truck.add(marker);
    this.markers.push(marker);
  }

  update(camera: THREE.Camera, height: number, layer: MapLayer) {
    const visible = layer === this.layer && height > 0;
    // Non-attenuated sprites still scale with the lens and viewport height.
    const scale = visible
      ? (2 * DIAMETER_PX) / (height * camera.projectionMatrix.elements[5])
      : 0;
    for (const marker of this.markers) {
      marker.visible = visible;
      if (visible) marker.scale.set(scale, scale, 1);
    }
  }

  dispose() {
    for (const marker of this.markers) marker.removeFromParent();
    this.markers = [];
    this.material.dispose();
    this.texture.dispose();
  }
}
