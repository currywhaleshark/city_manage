import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import { CityCamera } from "../src/renderer/camera";
import { CityRenderer } from "../src/renderer/city";
import { PlaceInspector } from "../src/ui/place-inspector";

test("inspection reuses the canvas, zooms the real camera, and restores its view and focus after resize", () => {
  const dom = new JSDOM('<main><div class="city-view"><canvas tabindex="0"></canvas><div id="labels"></div></div><button id="return">이 장소 다시 보기</button></main>');
  const before = new Map(["document", "HTMLElement"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of before.keys()) Object.defineProperty(globalThis, key, {
    value: (dom.window as any)[key], configurable: true,
  });
  const document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const canvas = document.querySelector("canvas")!, map = document.querySelector<HTMLElement>(".city-view")!;
  let size = { width: 1280, height: 588 };
  map.getBoundingClientRect = () => ({ ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON() {} });
  const view = new CityCamera(canvas);
  view.resize(size.width, size.height);
  view.overview();
  const cameraBefore = view.snapshot();
  // Actual renderer inspection methods and OrbitControls, without a WebGL context.
  const renderer = Object.assign(Object.create(CityRenderer.prototype), {
    canvas, cameraView: view,
    renderer: { setSize() {} },
    ring: new THREE.Mesh(), inspectionRing: new THREE.Mesh(), policyView: new THREE.Group(),
  }) as CityRenderer;
  let toggles = 0;
  const inspector = new PlaceInspector(map, renderer, () => toggles++);
  try {
    const trigger = document.querySelector<HTMLButtonElement>("#return")!;
    trigger.focus();
    size = { width: 900, height: 500 };
    inspector.open("산책길 <현장>", { x: 104, z: 163 });
    inspector.update(375, false);
    assert.equal(inspector.isOpen, true);
    assert.equal(document.querySelectorAll("canvas").length, 1);
    assert.equal(inspector.dialog.querySelector("canvas"), canvas);
    assert.equal(document.querySelector("#inspection-title")!.textContent, "산책길 <현장>");
    assert.equal(document.querySelector("#inspection-title 현장"), null);
    assert.equal(document.activeElement?.id, "close-inspection");
    assert.ok(Math.abs(view.controls.target.x - 104) < 1e-7);
    assert.ok(Math.abs(view.controls.target.z - 163) < 1e-7);
    assert.ok(view.camera.position.distanceTo(view.controls.target) <
      cameraBefore.position.distanceTo(cameraBefore.target) / 2);
    assert.equal((renderer as any).inspectionRing.visible, true);
    assert.equal((renderer as any).policyView.visible, false);
    // Live resident updates must not pull the inspection camera elsewhere.
    (renderer as any).residentView = { activePosition: new THREE.Vector3(-500, 0, -500) };
    (renderer as any).ensureResidentVisible();
    assert.ok(Math.abs(view.controls.target.x - 104) < 1e-7);
    assert.ok(Math.abs(view.controls.target.z - 163) < 1e-7);
    assert.match(document.querySelector("#inspection-status")!.textContent!, /지금 모습.*6:15/);
    document.querySelector<HTMLButtonElement>("#inspection-pause")!.click();
    assert.equal(toggles, 1);
    inspector.update(375, true);
    assert.equal(document.querySelector("#inspection-pause")!.textContent, "계속 보기");
    const distance = view.camera.position.distanceTo(view.controls.target);
    document.querySelector<HTMLButtonElement>("#inspection-zoom-in")!.click();
    assert.ok(view.camera.position.distanceTo(view.controls.target) < distance);
    view.center({ x: 250, z: 250 });
    document.querySelector<HTMLButtonElement>("#inspection-center")!.click();
    assert.ok(Math.abs(view.controls.target.x - 104) < 1e-7);
    // Resize during inspection, then return to the previous map in portrait.
    size = { width: 390, height: 650 };
    view.resize(size.width, size.height);
    inspector.dialog.dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
    assert.equal(inspector.isOpen, false);
    assert.equal(map.parentElement?.tagName, "MAIN");
    assert.equal(map.nextElementSibling, trigger);
    assert.equal(document.activeElement, trigger);
    assert.ok(view.controls.target.distanceTo(cameraBefore.target) < 1e-7);
    assert.equal((renderer as any).inspectionRing.visible, false);
    assert.equal((renderer as any).policyView.visible, true);
    const expected = new CityCamera(document.createElement("canvas"));
    expected.resize(size.width, size.height);
    expected.restore(cameraBefore);
    assert.ok(view.camera.position.distanceTo(expected.camera.position) < 1e-7);
    expected.controls.dispose();
    assert.equal(document.body.hasAttribute("data-inspecting-place"), false);
    // Opening again must not overwrite the saved original view or duplicate DOM.
    inspector.open("주거지", { x: -50, z: 0 });
    inspector.open("중복", { x: 0, z: 0 });
    inspector.close();
    inspector.close();
    assert.equal(document.querySelectorAll("canvas").length, 1);
    assert.equal(document.querySelectorAll("dialog").length, 1);
  } finally {
    view.controls.dispose();
    dom.window.close();
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
