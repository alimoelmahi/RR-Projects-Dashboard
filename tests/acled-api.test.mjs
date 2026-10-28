import test from "node:test";
import assert from "node:assert/strict";
import { createAcledApiClient } from "../scripts/acled-api.mjs";
import {
  fetchAcledSnapshot,
  snapshotFromCsv,
  snapshotWindow,
} from "../scripts/fetch-acled-snapshot.mjs";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("ACLED snapshot defaults to the 365 days ending on the requested snapshot date", () => {
  assert.deepEqual(snapshotWindow("2026-10-20"), {
    start: "2025-10-21",
    end: "2026-10-20",
  });
  assert.deepEqual(snapshotWindow("2026-10-20", "2026-01-01"), {
    start: "2026-01-01",
    end: "2026-10-20",
  });
  assert.throws(() => snapshotWindow("2026-02-30"), /real YYYY-MM-DD date/);
});

test("ACLED snapshot fetch adds country and date metadata without exposing credentials", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname === "/oauth/token")
      return jsonResponse({ access_token: "snapshot-token", expires_in: 86400 });
    return jsonResponse({
      data: [{ event_id_cnty: "SDN-1", event_date: "2026-10-20" }],
      total_count: 1,
      next_cursor: null,
    });
  };
  const snapshot = await fetchAcledSnapshot({
    username: "snapshot-user@example.test",
    password: "test-only-secret",
    end: "2026-10-20",
    fetchImpl,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("country"), "Sudan");
  assert.equal(calls[1].searchParams.get("event_date"), "2025-10-21|2026-10-20");
  assert.deepEqual(
    {
      country: snapshot.country,
      source: snapshot.source,
      start: snapshot.start,
      end: snapshot.end,
      snapshotDate: snapshot.snapshotDate,
      events: snapshot.events.length,
    },
    {
      country: "Sudan",
      source: "ACLED API",
      start: "2025-10-21",
      end: "2026-10-20",
      snapshotDate: "2026-10-20",
      events: 1,
    },
  );
});

test("ACLED CSV snapshot filters Sudan dates, deduplicates actor rows, and keeps only dashboard fields", () => {
  const csv = [
    "event_id_cnty,event_date,event_type,sub_event_type,country,admin1,admin2,location,latitude,longitude,fatalities,actor1,notes",
    "SDN-1,2026-10-20,Battles,Armed clash,Sudan,Red Sea,Port Sudan,Port Sudan,19.6,37.2,2,Actor A,Private note",
    "SDN-1,2026-10-20,Battles,Armed clash,Sudan,Red Sea,Port Sudan,Port Sudan,19.6,37.2,2,Actor B,Private note",
    "SDN-2,2025-10-20,Riots,Riot,Sudan,Red Sea,Port Sudan,Port Sudan,19.6,37.2,0,Actor C,Outside date range",
    "SSD-1,2026-10-20,Battles,Armed clash,South Sudan,State,Locality,Place,4,29,1,Actor D,Other country",
  ].join("\n");
  const snapshot = snapshotFromCsv(csv, {
    start: "2025-10-21",
    end: "2026-10-20",
    sourceName: "ACLED test export",
  });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].event_id_cnty, "SDN-1");
  assert.equal(snapshot.duplicateRows, 1);
  assert.equal(snapshot.source, "ACLED test export");
  assert.equal("actor1" in snapshot.events[0], false);
  assert.equal("notes" in snapshot.events[0], false);
});

test("ACLED API client authenticates server-side and fetches Sudan date-filtered cursor pages", async () => {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname === "/oauth/token")
      return jsonResponse({
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        expires_in: 86400,
      });
    if (url.pathname === "/api/acled/read" && url.searchParams.get("cursor") === "0")
      return jsonResponse({
        data: [{ event_id_cnty: "SDN-1", event_date: "2026-01-02" }],
        total_count: 2,
        last_update: 4,
        next_cursor: "next-page",
      });
    if (url.pathname === "/api/acled/read" && url.searchParams.get("cursor") === "next-page")
      return jsonResponse({
        data: [{ event_id_cnty: "SDN-2", event_date: "2026-01-03" }],
        total_count: 2,
        last_update: 4,
        next_cursor: null,
      });
    return jsonResponse({ error: "unexpected request" }, 500);
  };
  const client = createAcledApiClient({
    username: "api-user@example.test",
    password: "test-only-secret",
    fetchImpl,
  });
  const result = await client.getEvents({ start: "2026-01-01", end: "2026-01-31" });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.href, "https://acleddata.com/oauth/token");
  assert.equal(calls[0].options.body.get("grant_type"), "password");
  assert.equal(calls[0].options.body.get("client_id"), "acled");
  assert.equal(calls[0].options.body.get("username"), "api-user@example.test");
  assert.equal(calls[1].options.headers.Authorization, "Bearer mock-access-token");
  assert.equal(calls[1].url.searchParams.get("country"), "Sudan");
  assert.equal(calls[1].url.searchParams.get("event_date"), "2026-01-01|2026-01-31");
  assert.equal(calls[1].url.searchParams.get("event_date_where"), "BETWEEN");
  assert.equal(calls[2].url.searchParams.get("cursor"), "next-page");
  assert.equal(result.events.length, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.truncated, false);
});

test("ACLED API client reports missing credentials and stops at the pagination safety cap", async () => {
  const missingCredentials = createAcledApiClient({ fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(
    missingCredentials.getEvents({ start: "2026-01-01", end: "2026-01-31" }),
    /credentials are not configured/,
  );

  let page = 0;
  const fetchImpl = async input => {
    const url = new URL(input);
    if (url.pathname === "/oauth/token")
      return jsonResponse({ access_token: "token", expires_in: 86400 });
    page++;
    return jsonResponse({
      data: [{ event_id_cnty: `SDN-${page}`, event_date: "2026-01-02" }],
      next_cursor: `cursor-${page + 1}`,
    });
  };
  const cappedClient = createAcledApiClient({ username: "u", password: "p", fetchImpl });
  const result = await cappedClient.getEvents({ start: "2026-01-01", end: "2026-01-31" });
  assert.equal(page, 10);
  assert.equal(result.events.length, 10);
  assert.equal(result.truncated, true);
});
