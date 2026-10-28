import * as d3 from "d3";
import { clean, coordinates, number, stateName } from "../scripts/model.mjs";

const normalizeHeader = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const normalizePlace = (value) =>
  clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const dateOnly = (value) => {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf())
    ? null
    : parsed.toISOString().slice(0, 10);
};

export function normalizeAcledCsv(csvText, boundaries) {
  return normalizeAcledRows(d3.csvParse(csvText), boundaries);
}

export function normalizeAcledRows(rows, boundaries) {
  const headers = new Map(
    (rows.columns ?? Object.keys(rows[0] ?? {})).map((header) => [
      normalizeHeader(header),
      header,
    ]),
  );
  const column = (...aliases) =>
    aliases.map((alias) => headers.get(normalizeHeader(alias))).find(Boolean);
  const columns = {
    date: column("event_date", "event date", "date"),
    type: column("event_type", "event type", "event category", "type"),
    fatalities: column("fatalities", "fatality", "deaths"),
    latitude: column("latitude", "lat"),
    longitude: column("longitude", "lon", "lng", "long"),
    state: column("admin1", "admin_1", "state", "region"),
    locality: column("admin2", "admin_2", "locality", "district"),
    location: column("location", "place"),
    id: column("event_id_cnty", "event id", "event_id", "id"),
    subType: column("sub_event_type", "sub event type", "subtype"),
  };
  if (!columns.date || !columns.type)
    throw new Error(
      "CSV needs event_date and event_type columns (ACLED export format).",
    );

  const events = [];
  let rejected = 0;
  for (const [index, row] of rows.entries()) {
    const date = dateOnly(row[columns.date]);
    const type = clean(row[columns.type]);
    if (!date || !type) {
      rejected++;
      continue;
    }
    const lat = columns.latitude ? number(row[columns.latitude]) : null;
    const lon = columns.longitude ? number(row[columns.longitude]) : null;
    const point =
      lat !== null && lon !== null ? coordinates(`${lat},${lon}`) : null;
    const adminState = columns.state ? stateName(row[columns.state]) : "";
    const adminLocality = columns.locality ? clean(row[columns.locality]) : "";
    let boundary =
      point && boundaries.find((feature) => d3.geoContains(feature, point));
    if (!boundary && adminLocality) {
      const candidate = normalizePlace(adminLocality);
      const matching = boundaries.filter(
        (feature) => normalizePlace(feature.properties.loc_en) === candidate,
      );
      boundary =
        matching.find(
          (feature) => !adminState || feature.properties.state === adminState,
        ) ?? (matching.length === 1 ? matching[0] : null);
    }
    events.push({
      id: columns.id ? clean(row[columns.id]) : `ACLED-${index + 2}`,
      row: index + 2,
      date,
      type,
      subType: columns.subType ? clean(row[columns.subType]) : "",
      fatalities: columns.fatalities
        ? Math.max(0, number(row[columns.fatalities]) ?? 0)
        : 0,
      coordinates: point,
      state: boundary?.properties.state ?? adminState,
      localityCode: boundary?.properties.hrpcode ?? null,
      locality: boundary?.properties.loc_en ?? adminLocality,
      location: columns.location ? clean(row[columns.location]) : "",
      mapped: Boolean(boundary),
    });
  }
  if (!events.length)
    throw new Error("No rows with valid event dates and types were found.");
  return { events, rejected };
}
