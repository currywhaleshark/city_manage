import { LogisticsSimulation } from "../src/simulation/economy";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const records = [];
for (const seed of [2404, 2405, 2406]) {
  for (const ids of [
    [],
    ["shortcut"],
    ["cargoTruck"],
    ["handling"],
    ["diversify"],
    ["shortcut", "cargoTruck", "handling"],
    ["cargoTruck", "handling", "diversify"],
  ]) {
    const sim = new LogisticsSimulation(seed, ids);
    sim.runUntil(600);
    const s = sim.logisticsStats;
    const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6);
    for (const shop of s.shops) {
      close(shop.initial + shop.delivered, shop.stock + shop.sold);
      close(shop.requested, shop.sold + shop.unmet);
      assert.ok(shop.stock >= 0 && shop.stock <= shop.capacity);
    }
    for (const source of s.sources)
      close(source.initial + source.generated, source.stock + source.loaded);
    close(
      s.sources.reduce((n, source) => n + source.loaded, 0),
      s.delivered + s.inTrucks,
    );
    close(s.localDelivered + s.externalDelivered, s.delivered);
    assert.equal(
      sim.stats.arrived +
        sim.stats.active +
        sim.stats.queued +
        sim.stats.unreleased,
      140,
    );
    records.push({ seed, policies: ids, ...s });
    console.log(
      JSON.stringify({
        seed,
        policies: ids,
        delivered: s.delivered.toFixed(1),
        unmet: s.unmet.toFixed(1),
        stockoutShops: s.stockoutShops,
        external: s.externalDelivered.toFixed(1),
        arrived: s.backgroundArrived,
        shops: s.shops.map((shop) => ({
          id: shop.id,
          delivered: shop.delivered.toFixed(1),
          unmet: shop.unmet.toFixed(1),
        })),
      }),
    );
  }
}
writeFileSync(
  "output/logistics-experiments.json",
  JSON.stringify(records, null, 2),
);
