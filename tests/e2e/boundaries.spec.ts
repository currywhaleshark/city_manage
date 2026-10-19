import { test, expect } from "@playwright/test";

test("rendered external roads end exactly at the city edge and riverbanks leave the bridge deck clear", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/tests/fixtures/performance.html");
  const geometry = await page.evaluate(async () => {
    const [
      { CityRenderer },
      { TrafficSimulation },
      { WORLD, RIVER },
      { Box3 },
    ] = await Promise.all([
      import("/src/renderer/city.ts"),
      import("/src/simulation.ts"),
      import("/src/city/world.ts"),
      import("/node_modules/three/build/three.module.js"),
    ]);
    const sim = new TrafficSimulation();
    const city = new CityRenderer(
      document.querySelector("canvas")!,
      document.querySelector("#map-labels")!,
      "light",
    );
    city.setSimulation(sim);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const roads: any[] = [];
    const banks: number[] = [];
    const junctions: string[] = [];
    city.scene.updateMatrixWorld(true);
    city.scene.traverse((o: any) => {
      const selection = o.userData.selection;
      if (selection?.kind === "road") {
        const box = new Box3().setFromObject(o);
        roads.push({ id: selection.id, min: box.min.x, max: box.max.x });
      }
      if (selection?.kind === "node") junctions.push(selection.id);
      if (o.isMesh && o.material.color?.getHex() === 0xa6bb9c) {
        const points = o.geometry.getAttribute("position");
        for (let i = 0; i < points.count; i++) banks.push(points.getZ(i));
      }
    });
    (window as any).__boundaryQA = { city, sim };
    city.focusPosition({ x: RIVER.x, z: 96 }, 180);
    city.render(sim, false, sim.stats.roads, true);
    await new Promise(requestAnimationFrame);
    city.render(sim, false, sim.stats.roads, true);
    return {
      roads,
      banks,
      junctions,
      min: WORLD.min,
      max: WORLD.max,
      bridges: RIVER.bridges.map((r: number) => (r - 2) * 48),
    };
  });
  expect(
    geometry.roads.filter(
      (r) => r.id.includes("supply") || r.id.includes("approach"),
    ),
  ).toHaveLength(0);
  for (const side of ["west", "east"]) {
    for (const part of ["in", "out"]) {
      const r = geometry.roads.find(
        (r) => r.id === `external-${side}-${part}`,
      )!;
      expect(side === "west" ? r.min : r.max).toBeCloseTo(
        side === "west" ? geometry.min : geometry.max,
        6,
      );
    }
  }
  expect(
    geometry.junctions.some(
      (id) => id.startsWith("boundary") || id.startsWith("outside"),
    ),
  ).toBe(false);
  expect(geometry.banks.length).toBeGreaterThan(0);
  for (const z of geometry.bridges)
    expect(geometry.banks.every((v) => v <= z - 6 || v >= z + 6)).toBe(true);
  await page.screenshot({
    path: "output/playwright/boundary-bridge-clear.png",
  });
  await page.evaluate(() => {
    const { city, sim } = (window as any).__boundaryQA;
    city.focusPosition({ x: -117, z: 24 }, 140);
    city.render(sim, false, sim.stats.roads, true);
  });
  await page.screenshot({ path: "output/playwright/boundary-west-edge.png" });
  expect(errors).toEqual([]);
});
