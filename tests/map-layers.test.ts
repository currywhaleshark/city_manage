import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { wasteColor, accessBand } from "../src/renderer/map-data";
import { BuildingColors } from "../src/renderer/building-colors";
import {
  facilityCoverage,
  coverageCells,
} from "../src/renderer/facility-coverage";
import { FacilitySimulation } from "../src/simulation/facilities";
import { WalkingNetwork } from "../src/simulation/facilities/walking";

test("waste uses a fixed white-to-brown scale and every channel darkens as bags accumulate", () => {
  assert.equal(wasteColor(0), 0xffffff);
  assert.equal(wasteColor(-2), 0xffffff);
  assert.equal(wasteColor(60), 0x542c18);
  assert.equal(wasteColor(120), wasteColor(60));
  for (let n = 1; n <= 60; n++)
    for (const shift of [16, 8, 0])
      assert.ok(
        ((wasteColor(n) >> shift) & 255) <=
          ((wasteColor(n - 1) >> shift) & 255),
      );
  assert.deepEqual(
    [0, 120, 120.01, 240, 240.01, 300, 300.01, null]
      .map(accessBand)
      .map((b) => b.id),
    ["green", "green", "yellow", "yellow", "orange", "orange", "red", "red"],
  );
});

test("merged building geometry tints only the measured blocks and restores original roof and wall colors", () => {
  const colors = new BuildingColors();
  const originals = [0xeeeecc, 0x998877, 0x336655];
  originals.forEach((color, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color }),
    );
    mesh.updateMatrixWorld();
    colors.capture(mesh, i < 2 ? "a" : "b");
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  const mesh = colors.build();
  const attribute = mesh.geometry.getAttribute("color");
  const before = [...attribute.array];
  colors.update(new Map([["a", wasteColor(60)]]));
  assert.equal(colors.snapshot.find((b) => b.id === "b")!.color, originals[2]);
  assert.equal(
    new THREE.Color().fromBufferAttribute(attribute, 24).getHex(),
    wasteColor(60),
  );
  colors.update(new Map([["b", accessBand(120).color]]));
  assert.equal(
    new THREE.Color().fromBufferAttribute(attribute, 24).getHex(),
    originals[1],
  );
  colors.update(new Map());
  assert.deepEqual([...attribute.array], before);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test("five-minute range clips the last walking edge, reserves crossing waits and excludes disconnected paths", () => {
  const walking = new WalkingNetwork();
  walking.addPoint("a", { x: 0, z: 0 });
  walking.addPoint("b", { x: 350, z: 0 });
  walking.addPoint("c", { x: 0, z: 400 });
  walking.addPoint("d", { x: 500, z: 500 });
  walking.addPoint("e", { x: 501, z: 500 });
  walking.connect("a", "b", true);
  walking.connect("a", "c");
  walking.connect("d", "e");
  const sim = {
    walking,
    facilities: [{ id: "a", kind: "library" }],
  } as FacilitySimulation;
  const { segments } = facilityCoverage(sim, "library");
  assert.deepEqual(segments, [
    { from: { x: 0, z: 0 }, to: { x: 342, z: 0 } },
    { from: { x: 0, z: 0 }, to: { x: 0, z: 360 } },
  ]);
  assert.equal(coverageCells(segments).has("250,250"), false);
  assert.equal(
    coverageCells([...segments, ...segments]).size,
    coverageCells(segments).size,
  );
});

test("capacity expansion preserves walking range, while an entrance or new facility can increase it", () => {
  const base = new FacilitySimulation(),
    expanded = new FacilitySimulation(2404, ["expand"]);
  const cells = (sim: FacilitySimulation) =>
    coverageCells(facilityCoverage(sim, "library").segments);
  assert.deepEqual(cells(base), cells(expanded));
  assert.ok(
    cells(new FacilitySimulation(2404, ["gate"])).size > cells(base).size,
  );
  const added = new FacilitySimulation(2404, ["library"], { siteId: "north" });
  assert.ok(cells(added).size > cells(base).size);
  assert.deepEqual(facilityCoverage(added, "library").facilityIds, [
    "library-existing",
    "facility-new",
  ]);
});
