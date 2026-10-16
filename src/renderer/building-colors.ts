import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** All tintable walls/roofs share one draw call, with independent vertex ranges per block. */
export class BuildingColors {
  private geometries: THREE.BufferGeometry[] = [];
  private ranges: { id: string; start: number; count: number }[] = [];
  private count = 0;
  private attribute!: THREE.BufferAttribute;
  private original!: Float32Array;
  private current = new Map<string, number>();
  capture(mesh: THREE.Mesh, id: string) {
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    const color = (mesh.material as THREE.MeshStandardMaterial).color;
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.geometries.push(geometry);
    this.ranges.push({ id, start: this.count, count });
    this.count += count;
  }
  build() {
    const geometry = mergeGeometries(this.geometries)!;
    this.geometries.forEach((g) => g.dispose());
    this.geometries = [];
    this.attribute = geometry.getAttribute("color") as THREE.BufferAttribute;
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    this.original = new Float32Array(this.attribute.array);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
  update(colors: Map<string, number>) {
    let changed = false;
    const color = new THREE.Color();
    for (const { id, start, count } of this.ranges) {
      const next = colors.get(id);
      if (next === this.current.get(id)) continue;
      if (next === undefined) {
        (this.attribute.array as Float32Array).set(
          this.original.subarray(start * 3, (start + count) * 3),
          start * 3,
        );
      } else {
        color.setHex(next);
        for (let i = start; i < start + count; i++)
          this.attribute.setXYZ(i, color.r, color.g, color.b);
      }
      changed = true;
    }
    this.current = colors;
    if (changed) this.attribute.needsUpdate = true;
  }
  get snapshot() {
    return [...new Set(this.ranges.map((r) => r.id))].map((id) => {
      const range = this.ranges.find((r) => r.id === id)!;
      return {
        id,
        tinted: this.current.has(id),
        color: new THREE.Color()
          .fromBufferAttribute(this.attribute, range.start)
          .getHex(),
      };
    });
  }
}
