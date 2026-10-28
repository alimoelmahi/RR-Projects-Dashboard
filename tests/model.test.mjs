import test from "node:test";
import assert from "node:assert/strict";
import {
  coordinates,
  number,
  date,
  stateName,
  evidenceStatus,
  rag,
} from "../scripts/model.mjs";

test("strict numeric extraction preserves missing and refuses prose or arithmetic", () => {
  assert.equal(number(""), null);
  assert.equal(number("1,200"), 1200);
  assert.equal(number("1000 (635 F)"), null);
  assert.equal(number("2267+100"), null);
  assert.equal(number(0), 0);
});
test("coordinates support decimal and DMS without silently reversing axes", () => {
  assert.deepEqual(
    coordinates("N: 14.40785 E: 33.53151"),
    [33.53151, 14.40785],
  );
  assert.deepEqual(
    coordinates("13.592920 N 32.498924 E"),
    [32.498924, 13.59292],
  );
  const point = coordinates("15°23'48.2\"N 36°23'10.0\"E");
  assert.ok(Math.abs(point[0] - 36.386111) < 0.00001);
  assert.equal(coordinates("0,0"), null);
  assert.equal(coordinates("unknown"), null);
});
test("date and geographic aliases are conservative", () => {
  assert.equal(date("23.04.2026"), "2026-04-23");
  assert.equal(date("3/02/026"), null);
  assert.equal(date("31/02/2026"), null);
  assert.equal(stateName("Al Jazeera"), "Al Jazirah");
  assert.equal(stateName("Gadaref"), "Al Qadarif");
});
test("derived screening does not equate missing information with completion", () => {
  assert.equal(evidenceStatus("", null, null), "Unknown");
  assert.equal(evidenceStatus("2026", null, null), "Unknown");
  assert.equal(evidenceStatus("", 10, 10), "Completed");
  assert.equal(
    rag({ end: "2026-01-01", status: "Active", updated: null }, "2026-10-19"),
    "Red",
  );
});
