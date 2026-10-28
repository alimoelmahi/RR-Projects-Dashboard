import "dotenv/config";
import * as d3 from "d3";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAcledApiClient } from "./acled-api.mjs";

const dayMs = 24 * 60 * 60 * 1000;
const outputPath = path.resolve("public/data/acled-snapshot.json");
const defaultCsvPath = "ACLED Data_2026-10-20_event_date_from_2023-04-01_event_date_to_2026-10-20.csv";
const eventFields = [
  "event_id_cnty",
  "event_date",
  "event_type",
  "sub_event_type",
  "admin1",
  "admin2",
  "location",
  "latitude",
  "longitude",
  "fatalities",
];

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function snapshotWindow(end = new Date().toISOString().slice(0, 10), start) {
  if (!validDate(end)) throw new Error("ACLED_SNAPSHOT_END must be a real YYYY-MM-DD date.");
  const startDate = start ?? new Date(Date.parse(`${end}T00:00:00Z`) - 364 * dayMs)
    .toISOString()
    .slice(0, 10);
  if (!validDate(startDate) || startDate > end)
    throw new Error("ACLED_SNAPSHOT_START must be a real date no later than ACLED_SNAPSHOT_END.");
  return { start: startDate, end };
}

export function snapshotFromCsv(
  csvText,
  {
    start = process.env.ACLED_SNAPSHOT_START,
    end = process.env.ACLED_SNAPSHOT_END ?? new Date().toISOString().slice(0, 10),
    sourceName = "ACLED CSV",
  } = {},
) {
  const range = snapshotWindow(end, start);
  const rows = d3.csvParse(csvText);
  const headerKey = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headers = new Map(rows.columns.map((header) => [headerKey(header), header]));
  const column = (name) => headers.get(headerKey(name));
  const eventIdColumn = column("event_id_cnty");
  const eventDateColumn = column("event_date");
  const eventTypeColumn = column("event_type");
  const countryColumn = column("country");
  if (!eventIdColumn || !eventDateColumn || !eventTypeColumn)
    throw new Error("ACLED snapshot CSV must contain event_id_cnty, event_date, and event_type columns.");

  const includedFields = eventFields
    .map((field) => [field, column(field)])
    .filter(([, sourceColumn]) => sourceColumn);
  const events = [];
  const eventIds = new Set();
  let duplicateRows = 0;
  for (const row of rows) {
    const eventDate = row[eventDateColumn]?.trim();
    if (!validDate(eventDate) || eventDate < range.start || eventDate > range.end)
      continue;
    if (countryColumn && row[countryColumn]?.trim().toLowerCase() !== "sudan")
      continue;
    const eventId = row[eventIdColumn].trim();
    if (eventIds.has(eventId)) {
      duplicateRows++;
      continue;
    }
    eventIds.add(eventId);
    events.push(
      Object.fromEntries(
        includedFields.map(([field, sourceColumn]) => [field, row[sourceColumn]]),
      ),
    );
  }
  if (!events.length)
    throw new Error(`No unique Sudan ACLED events found between ${range.start} and ${range.end}.`);
  return {
    events,
    totalCount: events.length,
    lastUpdateHours: null,
    pages: 1,
    truncated: false,
    ...range,
    country: "Sudan",
    source: sourceName,
    snapshotDate: range.end,
    fetchedAt: new Date().toISOString(),
    duplicateRows,
  };
}

export async function fetchAcledSnapshot({
  username = process.env.ACLED_USERNAME,
  password = process.env.ACLED_PASSWORD,
  start = process.env.ACLED_SNAPSHOT_START,
  end = process.env.ACLED_SNAPSHOT_END,
  fetchImpl,
} = {}) {
  if (!username || !password)
    throw new Error("Set ACLED_USERNAME and ACLED_PASSWORD in .env or Netlify Build environment variables.");
  const range = snapshotWindow(end ?? new Date().toISOString().slice(0, 10), start);
  const client = createAcledApiClient({ username, password, fetchImpl });
  const result = await client.getEvents(range);
  return {
    ...result,
    country: "Sudan",
    source: "ACLED API",
    snapshotDate: range.end,
  };
}

async function main() {
  const configuredCsvPath = process.env.ACLED_SNAPSHOT_CSV;
  const csvPath = path.resolve(configuredCsvPath || defaultCsvPath);
  let csvText;
  try {
    csvText = await fs.readFile(csvPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT" || configuredCsvPath) throw error;
  }

  let snapshot;
  if (csvText !== undefined) {
    snapshot = snapshotFromCsv(csvText, { sourceName: `ACLED CSV: ${path.basename(csvPath)}` });
  } else if (process.env.ACLED_USERNAME && process.env.ACLED_PASSWORD) {
    snapshot = await fetchAcledSnapshot();
  } else {
    console.warn(
      `Skipping ACLED snapshot refresh: place ${defaultCsvPath} in the project root or configure ACLED credentials.`,
    );
    return;
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  console.log(
    `Saved ${snapshot.events.length} ACLED events for Sudan (${snapshot.start} to ${snapshot.end}) to ${outputPath}.`,
  );
  if (snapshot.truncated)
    console.warn("ACLED snapshot reached the 50,000-event cap; use a narrower date range.");
  if (snapshot.duplicateRows)
    console.log(`Removed ${snapshot.duplicateRows} duplicate actor rows from the ACLED CSV export.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });