import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeAcledCsv } from "../src/acled.js";
import {
  buildLocalityAssessment,
  monthlyConflictSeries,
} from "../src/vulnerability.js";

const boundaries = JSON.parse(
  fs.readFileSync("public/data/boundaries.geojson", "utf8"),
).features;
const model = JSON.parse(fs.readFileSync("public/data/model.json", "utf8"));

test("ACLED export normalizes coordinates, admin-name joins, dates and fatalities", () => {
  const csv = [
    "event_id_cnty,event_date,event_type,sub_event_type,admin1,admin2,location,latitude,longitude,fatalities",
    "RS-1,2026-07-01,Battles,Armed clash,Red Sea,Sinkat,Sinkat town,18.937048,36.841209,4",
    "RS-2,2026-07-12,Violence against civilians,Attack,Red Sea,Port Sudan,Port Sudan,,,2",
    "RS-3,not-a-date,Protests,Peaceful protest,Red Sea,Sinkat,Sinkat,,,,0",
  ].join("\n");
  const result = normalizeAcledCsv(csv, boundaries);
  assert.equal(result.events.length, 2);
  assert.equal(result.rejected, 1);
  assert.equal(result.events[0].locality, "Sinkat");
  assert.equal(result.events[0].state, "Red Sea");
  assert.deepEqual(result.events[0].coordinates, [36.841209, 18.937048]);
  assert.equal(result.events[0].fatalities, 4);
  assert.equal(result.events[1].locality, "Port Sudan");
  assert.equal(result.events[1].mapped, true);
  assert.equal(result.events[1].coordinates, null);
});

test("ACLED import refuses files without required date and event-type columns", () => {
  assert.throws(
    () => normalizeAcledCsv("name,lat,lon\nplace,14,33", boundaries),
    /event_date and event_type/,
  );
});

test("provisional locality index uses existing displacement and site data without fabricating conflict", () => {
  const assessments = buildLocalityAssessment(
    boundaries,
    model.sites,
    [],
    false,
  );
  const sinkat = assessments.find((row) => row.locality === "Sinkat");
  assert.ok(sinkat);
  assert.equal(sinkat.conflictEvents, 0);
  assert.match(sinkat.scoreBasis, /no ACLED events loaded/);
  assert.ok(sinkat.projectSites > 0);
});

test("monthly conflict series aggregates incident and fatality totals", () => {
  const series = monthlyConflictSeries([
    { date: "2026-07-01", fatalities: 2 },
    { date: "2026-07-14", fatalities: 3 },
    { date: "2026-08-02", fatalities: 0 },
  ]);
  assert.equal(series.length, 2);
  assert.equal(series[0].incidents, 2);
  assert.equal(series[0].fatalities, 5);
  assert.equal(series[1].incidents, 1);
});
