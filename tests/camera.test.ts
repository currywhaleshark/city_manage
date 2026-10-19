import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import { CityCamera } from "../src/renderer/camera";
import { BUILDABLE_PLOTS, RIVER, WORLD } from "../src/city/world";

// Real Three.js projection and OrbitControls; no WebGL/browser layout required.
function fixture(t: TestContext, width = 1280, height = 588) {
  const dom = new JSDOM("<canvas></canvas>");
  const canvas = dom.window.document.querySelector("canvas")!;
  const size = { width, height };
  Object.defineProperties(canvas, {
    clientWidth: { get: () => size.width },
    clientHeight: { get: () => size.height },
  });
  canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
  const view = new CityCamera(canvas);
  view.resize(width, height);
  view.overview();
  const pointer = (type: string, x: number, y: number, button = 0) => {
    const event = new dom.window.MouseEvent(type, {
      clientX: x,
      clientY: y,
      button,
      bubbles: true,
    });
    Object.assign(event, { pointerId: 1, pointerType: "mouse" });
    canvas.dispatchEvent(event);
  };
  t.after(() => {
    view.controls.dispose();
    dom.window.close();
  });
  return {
    view,
    dom,
    canvas,
    resize(w: number, h: number) {
      size.width = w;
      size.height = h;
      view.resize(w, h);
    },
    drag(button = 0) {
      pointer("pointerdown", 200, 200, button);
      pointer("pointermove", 330, 225, button);
      pointer("pointerup", 330, 225, button);
    },
  };
}
const direction = (view: CityCamera) =>
  view.camera.position.clone().sub(view.controls.target).normalize();
function checkFrame(
  view: CityCamera,
  points: THREE.Vector3[],
  x = 0.84,
  y = 0.72,
) {
  view.camera.updateMatrixWorld();
  for (const point of points) {
    const p = point.clone().project(view.camera);
    assert.ok(Math.abs(p.x) <= x + 1e-8, `x=${p.x}`);
    assert.ok(Math.abs(p.y) <= y + 1e-8, `y=${p.y}`);
    assert.ok(p.z > -1 && p.z < 1, `depth=${p.z}`);
  }
}
const worldCorners = [WORLD.min, WORLD.max].flatMap((x) =>
  [WORLD.min, WORLD.max].flatMap((z) =>
    [0, 48].map((y) => new THREE.Vector3(x, y, z)),
  ),
);

test("perspective overview fits the city and river in desktop, portrait and short landscape views", (t) => {
  for (const [w, h] of [
    [1280, 588],
    [390, 718],
    [320, 474],
    [844, 258],
  ]) {
    const { view } = fixture(t, w, h);
    assert.equal(view.camera.isPerspectiveCamera, true);
    checkFrame(view, worldCorners);
    view.overview(true);
    checkFrame(
      view,
      [RIVER.x - 110, RIVER.x + 110].flatMap((x) =>
        [WORLD.min, WORLD.max].flatMap((z) =>
          [0, 48].map((y) => new THREE.Vector3(x, y, z)),
        ),
      ),
    );
  }
});

test("nearby objects are visibly larger while wheel and buttons keep one fixed lens", (t) => {
  const { view, dom, canvas } = fixture(t);
  const back = direction(view);
  const right = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), back)
    .normalize();
  const apparentWidth = (depth: number) => {
    const center = view.controls.target.clone().addScaledVector(back, depth);
    const a = center.clone().addScaledVector(right, -10).project(view.camera);
    const b = center.clone().addScaledVector(right, 10).project(view.camera);
    return a.distanceTo(b);
  };
  assert.ok(apparentWidth(100) > apparentWidth(-100) * 1.15);
  const original = view.controls.getDistance();
  view.zoom(1.2);
  assert.ok(Math.abs(view.controls.getDistance() - original / 1.2) < 1e-8);
  const closer = view.controls.getDistance();
  canvas.dispatchEvent(
    new dom.window.WheelEvent("wheel", { deltaY: 100, cancelable: true }),
  );
  assert.ok(view.controls.getDistance() > closer);
  assert.ok(direction(view).distanceTo(back) < 1e-8);
  for (let i = 0; i < 80; i++) view.zoom(1.2);
  assert.equal(Math.round(view.controls.getDistance()), 140);
  for (let i = 0; i < 100; i++) view.zoom(1 / 1.2);
  assert.equal(Math.round(view.controls.getDistance()), 6000);
  assert.equal(view.camera.fov, 42);
  assert.equal(view.camera.zoom, 1);
});

test("rotation settles promptly and panning keeps the focus on the ground", (t) => {
  const { view, drag } = fixture(t);
  const before = direction(view);
  drag();
  for (let i = 0; i < 20; i++) view.controls.update();
  const settled = direction(view);
  for (let i = 0; i < 40; i++) view.controls.update();
  assert.ok(
    before.angleTo(direction(view)) < 0.8,
    "a 130px drag should not spin the city halfway around",
  );
  assert.ok(
    settled.angleTo(direction(view)) < 0.01,
    "little movement remains after 20 frames",
  );
  const target = view.controls.target.clone();
  drag(2);
  for (let i = 0; i < 60; i++) view.controls.update();
  assert.ok(view.controls.target.distanceTo(target) > 1);
  assert.ok(Math.abs(view.controls.target.y) < 1e-8);
});

test("home and location focus discard old drag inertia without changing the chosen heading", (t) => {
  const { view, drag } = fixture(t);
  drag();
  const heading = direction(view);
  view.focus({ x: -72, z: 120 });
  assert.ok(direction(view).distanceTo(heading) < 1e-8);
  let position = view.camera.position.clone();
  for (let i = 0; i < 60; i++) view.controls.update();
  assert.ok(view.camera.position.distanceTo(position) < 1e-8);
  const distance = view.controls.getDistance();
  view.center({ x: 264, z: 264 });
  assert.ok(direction(view).distanceTo(heading) < 1e-8);
  assert.ok(Math.abs(view.controls.getDistance() - distance) < 1e-8);
  assert.deepEqual(view.controls.target.toArray(), [264, 0, 264]);
  drag();
  view.overview();
  position = view.camera.position.clone();
  for (let i = 0; i < 60; i++) view.controls.update();
  assert.ok(view.camera.position.distanceTo(position) < 1e-8);
  checkFrame(view, worldCorners);
});

test("placement targets stay in frame and ray picking reaches the same plots", (t) => {
  for (const [w, h] of [
    [1280, 588],
    [390, 718],
    [844, 258],
  ]) {
    const { view } = fixture(t, w, h);
    const points = BUILDABLE_PLOTS.flatMap((plot) =>
      [-1, 1].flatMap((dx) =>
        [-1, 1].map(
          (dz) =>
            new THREE.Vector3(
              plot.position.x + (dx * plot.width) / 2,
              0,
              plot.position.z + (dz * plot.depth) / 2,
            ),
        ),
      ),
    );
    const target = new THREE.Box3()
      .setFromPoints(points)
      .getCenter(new THREE.Vector3());
    view.frame(target, points, { x: 0.82, y: 0.52 });
    checkFrame(view, points, 0.82, 0.52);
    for (const plot of BUILDABLE_PLOTS) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(plot.width, plot.depth),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(plot.position.x, 0.83, plot.position.z);
      mesh.updateMatrixWorld();
      const anchor = mesh.position.clone().project(view.camera);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(anchor.x, anchor.y), view.camera);
      const hits = ray.intersectObject(mesh);
      assert.ok(hits.length > 0, plot.id);
      assert.ok(hits[0].point.distanceTo(mesh.position) < 1e-8, plot.id);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
});

test("resizing and cancelling a placement preserve heading, focus and relative zoom", (t) => {
  const { view, resize, drag } = fixture(t);
  resize(390, 718);
  checkFrame(view, worldCorners);
  resize(844, 258);
  checkFrame(view, worldCorners);
  drag();
  view.zoom(1.2);
  const saved = view.snapshot();
  view.focus({ x: 264, z: 264 });
  view.restore(saved);
  assert.ok(view.camera.position.distanceTo(saved.position) < 1e-8);
  assert.ok(view.controls.target.distanceTo(saved.target) < 1e-8);
  resize(390, 718);
  const expected = view.snapshot();
  resize(844, 258);
  view.focus({ x: -72, z: 120 });
  resize(390, 718);
  view.restore(saved);
  assert.ok(view.camera.position.distanceTo(expected.position) < 1e-8);
  assert.ok(view.controls.target.distanceTo(expected.target) < 1e-8);
});
