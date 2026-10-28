import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as d3 from "d3";

const model = JSON.parse(fs.readFileSync("public/data/model.json"));
const boundaries = JSON.parse(
  fs.readFileSync("public/data/boundaries.geojson"),
);
const stateBoundaries = JSON.parse(
  fs.readFileSync("public/data/state-boundaries.geojson"),
);
test("all workbooks and sheets are inventoried without counting lookup rows as awards", () => {
  assert.equal(new Set(model.inventory.map((sheet) => sheet.file)).size, 13);
  assert.equal(
    new Set(
      model.inventory
        .filter((sheet) => sheet.file.endsWith(".xlsx"))
        .map((sheet) => sheet.file),
    ).size,
    12,
  );
  assert.equal(model.projects.length, 13);
  assert.equal(new Set(model.projects.map((project) => project.id)).size, 13);
  assert.ok(model.inventory.some((sheet) => sheet.file.includes("hdx")));
});
test("D3 polygons enclose their actual localities rather than the rest of the globe", () => {
  assert.ok(
    boundaries.features.every((feature) => d3.geoArea(feature) < 2 * Math.PI),
  );
  const feature = boundaries.features.find((feature) =>
    d3.geoContains(feature, [33.53151, 14.40785]),
  );
  assert.equal(feature.properties.state, "Al Jazirah");
});
test("state boundary layer dissolves ADM2 seams and retains valid state geometry", () => {
  assert.equal(stateBoundaries.features.length, 19);
  assert.ok(
    stateBoundaries.features.every(
      (feature) => d3.geoArea(feature) < 2 * Math.PI,
    ),
  );
  const redSea = stateBoundaries.features.find(
    (feature) => feature.properties.state === "Red Sea",
  );
  assert.equal(redSea.properties.localityCount, 10);
  assert.equal(d3.geoContains(redSea, [36.841209, 18.937048]), true);
});
test("source formatting separates currencies and repeat cost lines are not extra activities", () => {
  assert.equal(
    model.projects.find((project) => project.id === "ITALY").currency,
    "EUR",
  );
  assert.equal(
    model.projects.find((project) => project.id === "SDCL").currency,
    "CHF",
  );
  const revive = model.activities.filter(
    (activity) => activity.projectId === "REVIVE",
  );
  assert.equal(
    new Set(revive.map((activity) => activity.title)).size,
    revive.length,
  );
});
test("all normalized entities preserve source provenance and valid project links", () => {
  const ids = new Set(model.projects.map((project) => project.id));
  for (const activity of model.activities) {
    assert.ok(ids.has(activity.projectId));
    assert.ok(activity.source.row > 0);
  }
  for (const site of model.sites) {
    assert.ok(site.projectId === null || ids.has(site.projectId));
    assert.ok(site.sources.length > 0);
  }
});
test("monitoring narratives are risks, not geographic site records", () => {
  assert.ok(model.risks.length > 0);
  assert.ok(model.monitoring.some((record) => record.target === 500000));
  assert.equal(
    model.sites.filter((site) => site.projectId === "REVIVE").length,
    0,
  );
  assert.ok(
    model.inventory.every((sheet, index) =>
      fs.existsSync(`public/data/audit/${index}.json`),
    ),
  );
});
test("all new water-register rows, readiness fields and source provenance are preserved", () => {
  const waterSites = model.sites.filter(
    (site) => site.origin === "Evidence-based water projects register",
  );
  assert.equal(waterSites.length, 252);
  assert.equal(waterSites.filter((site) => site.coordinates).length, 231);
  assert.equal(waterSites.filter((site) => !site.coordinates).length, 21);
  assert.equal(model.waterRegister.mapProvided, 220);
  assert.equal(model.waterRegister.coordinatesReported, 220);
  assert.equal(model.waterRegister.boqReceived, 196);
  assert.ok(
    model.waterRegister.sourceStatuses.some(
      ({ status }) => status === "SOW Received – Incomplete",
    ),
  );
  assert.equal(
    waterSites.find((site) => site.sourceId === "KS-001").projectId,
    "KSRELIEF",
  );
  assert.equal(
    model.projects.find((project) => project.id === "KSRELIEF").budget,
    null,
  );
  assert.equal(
    waterSites.find((site) => site.sourceId === "CERF-01").projectId,
    "CERF",
  );
  assert.equal(
    waterSites.find((site) => site.sourceId === "CERF-01").status,
    "Completed",
  );
  assert.equal(
    waterSites.find((site) => site.sourceId === "CERF-01").registerStatus,
    "Delivered",
  );
  assert.ok(waterSites.every((site) => site.sources[0].row >= 2));
  assert.ok(
    model.inventory.some((sheet) =>
      sheet.file.endsWith("Tracker(Tracker).csv"),
    ),
  );
});
