import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RIVER, WORLD } from "../city/world";
import type { Vec2 } from "../types";

export interface CameraSnapshot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  aspect: number;
}

const DEFAULT_DIRECTION = new THREE.Vector3(480, 490, 550).normalize();
const OVERVIEW_FRAME = { x: 0.84, y: 0.72 };
const corners = (minX: number, maxX: number, minZ: number, maxZ: number) =>
  [minX, maxX].flatMap((x) =>
    [minZ, maxZ].flatMap((z) => [0, 48].map((y) => new THREE.Vector3(x, y, z))),
  );
const CITY_CORNERS = corners(WORLD.min, WORLD.max, WORLD.min, WORLD.max);
const CITY_CENTER = new THREE.Vector3(WORLD.center, 0, WORLD.center);

/** Distance along a fixed view direction that contains every point in the frame. */
function fitDistance(
  target: THREE.Vector3,
  points: readonly THREE.Vector3[],
  direction: THREE.Vector3,
  aspect: number,
  fov: number,
  frame = OVERVIEW_FRAME,
) {
  const right = new THREE.Vector3()
    .crossVectors(THREE.Object3D.DEFAULT_UP, direction)
    .normalize();
  const up = new THREE.Vector3().crossVectors(direction, right);
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  let distance = 140;
  for (const point of points) {
    const delta = point.clone().sub(target);
    // Perspective size depends on each point's depth, not just the farthest x/y.
    const depth = delta.dot(direction);
    distance = Math.max(
      distance,
      depth + Math.abs(delta.dot(right)) / (tangent * aspect * frame.x),
      depth + Math.abs(delta.dot(up)) / (tangent * frame.y),
    );
  }
  return distance;
}

/** Fixed lens, distance-based zoom and ground-level panning for every city view. */
export class CityCamera {
  readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
  readonly controls: OrbitControls;
  private ready = false;

  constructor(canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.2;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.7;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = false;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.12;
    this.controls.minDistance = 140;
    this.controls.maxDistance = 6000;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
  }

  private direction() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    return offset.lengthSq() > 1
      ? offset.normalize()
      : DEFAULT_DIRECTION.clone();
  }

  private pose(position: THREE.Vector3, target: THREE.Vector3) {
    const damping = this.controls.enableDamping;
    // Consume pending drag/zoom deltas before assigning a view. Otherwise a
    // cancelled placement or a home-button reset keeps drifting on later frames.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.enableDamping = damping;
    this.camera.updateMatrixWorld();
    this.ready = true;
  }

  frame(
    target: THREE.Vector3,
    points: readonly THREE.Vector3[],
    frame = OVERVIEW_FRAME,
    direction = this.direction(),
  ) {
    const distance = fitDistance(
      target,
      points,
      direction,
      this.camera.aspect,
      this.camera.fov,
      frame,
    );
    this.pose(target.clone().addScaledVector(direction, distance), target);
  }

  overview(river = false) {
    const target = river
      ? new THREE.Vector3(RIVER.x, 0, WORLD.center)
      : CITY_CENTER;
    const points = river
      ? corners(RIVER.x - 110, RIVER.x + 110, WORLD.min, WORLD.max)
      : CITY_CORNERS;
    this.frame(
      target,
      points,
      OVERVIEW_FRAME,
      river ? new THREE.Vector3(120, 520, 200).normalize() : DEFAULT_DIRECTION,
    );
  }

  focus(position: Vec2, span = 180) {
    const { x, z } = position;
    this.frame(
      new THREE.Vector3(x, 0, z),
      corners(x - span / 2, x + span / 2, z - span / 2, z + span / 2),
    );
  }

  center(position: Vec2) {
    const target = new THREE.Vector3(position.x, 0, position.z);
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.pose(target.clone().add(offset), target);
  }

  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const distance = THREE.MathUtils.clamp(
      this.camera.position.distanceTo(this.controls.target) / factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.pose(
      this.controls.target.clone().addScaledVector(this.direction(), distance),
      this.controls.target.clone(),
    );
  }

  snapshot(): CameraSnapshot {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      aspect: this.camera.aspect,
    };
  }

  restore(view: CameraSnapshot) {
    const offset = view.position.clone().sub(view.target);
    offset.multiplyScalar(
      this.resizeRatio(
        view.aspect,
        this.camera.aspect,
        offset.clone().normalize(),
      ),
    );
    this.pose(view.target.clone().add(offset), view.target);
  }

  private resizeRatio(before: number, after: number, direction: THREE.Vector3) {
    return (
      fitDistance(
        CITY_CENTER,
        CITY_CORNERS,
        direction,
        after,
        this.camera.fov,
      ) /
      fitDistance(CITY_CENTER, CITY_CORNERS, direction, before, this.camera.fov)
    );
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    const before = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // OrbitControls otherwise turns much faster per pixel in a short landscape view.
    this.controls.rotateSpeed = 0.45 * Math.min(1, height / 480);
    if (this.ready && before !== this.camera.aspect) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.multiplyScalar(
        this.resizeRatio(before, this.camera.aspect, this.direction()),
      );
      this.pose(
        this.controls.target.clone().add(offset),
        this.controls.target.clone(),
      );
    }
  }

  get showDetailLabels() {
    const halfSpan =
      this.camera.position.distanceTo(this.controls.target) *
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) *
      Math.min(1, this.camera.aspect);
    return halfSpan < 220;
  }
}
