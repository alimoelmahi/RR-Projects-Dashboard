import fs from "node:fs/promises";
import path from "node:path";
import * as d3 from "d3";
import polygonClipping from "polygon-clipping";
import {
  clean,
  number,
  date,
  coordinates,
  stateName,
  sector,
  evidenceStatus,
  rag,
} from "./model.mjs";

const asOf = process.env.REPORT_DATE ?? "2026-10-19";
const audit = JSON.parse(await fs.readFile("data/workbook-audit.json", "utf8"));
const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const boundaries = await read(
  "Geo Assets/Sudan_Localities/Sudan_Khartoum_Localities.geojson",
);
for (const feature of boundaries.features) {
  if (d3.geoArea(feature) > 2 * Math.PI) {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) ring.reverse();
  }
}
const stateBoundaries = {
  type: "FeatureCollection",
  features: d3
    .groups(boundaries.features, (feature) =>
      stateName(feature.properties.state_en),
    )
    .map(([state, features]) => {
      const polygons = polygonClipping.union(
        ...features.map((feature) => feature.geometry.coordinates),
      );
      const feature = {
        type: "Feature",
        properties: { state, localityCount: features.length },
        geometry:
          polygons.length === 1
            ? { type: "Polygon", coordinates: polygons[0] }
            : { type: "MultiPolygon", coordinates: polygons },
      };
      if (d3.geoArea(feature) > 2 * Math.PI) {
        const rings =
          feature.geometry.type === "Polygon"
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
        for (const polygon of rings) for (const ring of polygon) ring.reverse();
      }
      return feature;
    }),
};
const humanitarian = await read(
  "Geo Assets/Sudan_Localities/humanitarian_indicators.json",
);
const population = await read(
  "Geo Assets/Sudan_Localities/population_overrides.json",
);
const projects = [];
const activities = [];
const sites = [];
const updates = [];
const locations = [];
const financialLines = [];
const issues = [];
const inventory = [];
const risks = [];
const monitoring = [];
const configs = [
  ["CERF", "CERF_Tracker.xlsx", "CERF_Tracker", 1, 4, [6, 5], 7, 3],
  ["EAA", "EAA_Tracker.xlsx", "EAA_Tracker", 2, 6, [42, 34], null, 4],
  ["FD", "FD-ER-FW_Tracker.xlsx", "FD_FW", 1, null, [], null, null],
  ["ER", "FD-ER-FW_Tracker.xlsx", "ER_FW", 1, null, [], null, null],
  ["ITALY", "ITALY_tracker.xlsx", "ITALY_WASH_GDKS", 1, 3, [4], 6, null],
  ["JSB", "JSB_tracker.xlsx", "JSB_Tracker", 1, 22, [24, 23], null, 3],
  ["KUWAIT", "Kuwait_Tracker.xlsx", "Kuwait_Tracker", 2, 4, [8, 7], 9, null],
  ["NKA", "NKuwait_Agri_Tracker.xlsx", "NKuwait_Tracker", 2, 3, [12], 13, null],
  [
    "STRIDES",
    "NKuwait_STRIDES_Tracker.xlsx",
    "NKuwait_STRIDES_Tracker",
    4,
    6,
    [7],
    null,
    1,
  ],
  [
    "SDCL",
    "SDCLivelihoods_Tracker.xlsx",
    "SDCLivelihoods_ActivityTracker",
    1,
    2,
    [44, 33, 22],
    43,
    null,
  ],
  [
    "SDCDS",
    "SDC_DurableSolutions_Tracker.xlsx",
    "SDC(DS)_Tracker",
    8,
    null,
    [],
    23,
    5,
  ],
];
const source = (file, sheet, row) => ({ file, sheet, row });
for (const config of configs) {
  const [
    id,
    file,
    sheetName,
    activityColumn,
    targetColumn,
    actualColumns,
    commentColumn,
    indicatorColumn,
  ] = config;
  const book = audit.workbooks.find((book) => book.file === file);
  const facts = book.sheets.find((sheet) => /fact/i.test(sheet.name));
  const factColumn = id === "ER" ? 2 : 1;
  const fact = (pattern) =>
    facts.rows.find((row) => pattern.test(clean(row.cells[0])))?.cells[
      factColumn
    ] ?? null;
  const budgetRaw = fact(/^total budget/i);
  const budgetText = clean(budgetRaw);
  const budgetFormat =
    facts.rows.find((row) => /^total budget/i.test(clean(row.cells[0])))
      ?.currencyFormats?.[factColumn] ?? "";
  const currencyEvidence = `${budgetText} ${budgetFormat}`;
  const currency = /CHF/i.test(currencyEvidence)
    ? "CHF"
    : /EUR|€/i.test(currencyEvidence)
      ? "EUR"
      : /USD|\$/i.test(currencyEvidence)
        ? "USD"
        : "Unspecified";
  const budget = number(budgetText.replace(/CHF|USD|EUR|[$€]/gi, "").trim());
  const project = {
    id,
    name: clean(fact(/^project name/i)) || id,
    donor: clean(fact(/^donor/i)) || "Not reported",
    award: clean(fact(/^award/i)) || null,
    budget,
    currency,
    budgetRaw,
    budgetFormat,
    start: date(fact(/^start/i)),
    end: date(fact(/^end/i)),
    updated: date(fact(/^last update/i)),
    targetLocations: clean(fact(/^target locations/i)),
    partners: clean(fact(/^implementing/i)) || "Not reported",
    source: source(file, facts.name, 1),
    sourceType: ["FD", "ER"].includes(id) ? "Workplan" : "Tracker",
    sector: "",
    states: [],
    progress: null,
    status: "Unknown",
    expenditure: null,
  };
  project.states = [
    ...new Set(
      boundaries.features.map((feature) =>
        stateName(feature.properties.state_en),
      ),
    ),
  ].filter((state) => {
    const text = stateName(project.targetLocations);
    return (
      text === state ||
      project.targetLocations.toLowerCase().includes(state.toLowerCase())
    );
  });
  for (const alias of project.targetLocations.split(/,| and /i)) {
    const normalized = stateName(alias);
    if (
      [
        "Al Jazirah",
        "Al Qadarif",
        "Red Sea",
        "River Nile",
        "White Nile",
        "Kassala",
        "Sennar",
      ].includes(normalized)
    )
      project.states.push(normalized);
  }
  const sheet = book.sheets.find((sheet) => sheet.name === sheetName);
  for (const row of sheet.rows) {
    const cells = row.cells;
    const title = clean(cells[activityColumn]);
    if (!/^(Activity\s*\d|\d+\.\d+\.?\d*\s|\d+\.\s)/i.test(title)) continue;
    const target = targetColumn == null ? null : number(cells[targetColumn]);
    const actualColumn = actualColumns.find(
      (index) => number(cells[index]) !== null,
    );
    const actual = actualColumn == null ? null : number(cells[actualColumn]);
    const comment = commentColumn == null ? "" : clean(cells[commentColumn]);
    const status = evidenceStatus(comment, target, actual);
    const activity = {
      id: `${id}-A${row.row}`,
      projectId: id,
      title,
      target,
      actual,
      actualLabel:
        actualColumn == null
          ? null
          : clean(
              sheet.rows.find(
                (row) =>
                  row.cells[actualColumn] &&
                  /actual|total|cum|ian/i.test(String(row.cells[actualColumn])),
              )?.cells[actualColumn],
            ),
      indicator: indicatorColumn == null ? null : clean(cells[indicatorColumn]),
      sector: sector(title),
      status,
      comment,
      progress:
        target > 0 && actual !== null
          ? Math.min(1, Math.max(0, actual / target))
          : null,
      source: source(file, sheetName, row.row),
      due: null,
      budget: null,
      currency: null,
    };
    if (id === "FD" || id === "ER") {
      activity.budget = number(cells[id === "FD" ? 2 : 3]);
      activity.currency = "Unspecified";
    }
    if (id === "KUWAIT") {
      activity.budget = number(cells[5]);
      activity.currency = "USD";
      financialLines.push({
        projectId: id,
        description: title,
        amount: number(cells[6]),
        type: "Reported actual (12.11); accounting basis unverified",
        currency: "USD",
        source: activity.source,
      });
    }
    activities.push(activity);
  }
  for (const sheet of book.sheets.filter((sheet) =>
    /weekly/i.test(sheet.name),
  )) {
    for (const row of sheet.rows.slice(1)) {
      const text = row.cells
        .slice(1)
        .filter((value) => clean(value))
        .map(clean)
        .join("\n");
      if (text)
        updates.push({
          projectId: id,
          period: clean(row.cells[0]),
          text,
          source: source(file, sheet.name, row.row),
        });
    }
  }
  for (const sheet of book.sheets.filter((sheet) =>
    /locations/i.test(sheet.name),
  )) {
    const header = sheet.rows.find((row) =>
      row.cells.some((value) => /^state\s*$/i.test(clean(value))),
    );
    if (!header) continue;
    const index = (pattern) =>
      header.cells.findIndex((value) => pattern.test(clean(value)));
    const stateIndex = index(/^state/i),
      localityIndex = index(/^locality/i),
      partnerIndex = index(/^(IP|Implementing Partner)$/i);
    let previousState = "";
    for (const row of sheet.rows.filter((row) => row.row > header.row)) {
      previousState = clean(row.cells[stateIndex]) || previousState;
      const locality = clean(row.cells[localityIndex]);
      if (locality)
        locations.push({
          projectId: id,
          state: stateName(previousState),
          locality,
          partner: clean(row.cells[partnerIndex]),
          source: source(file, sheet.name, row.row),
        });
    }
  }
  projects.push(project);
}

const reviveBook = audit.workbooks.find((book) => /REVIVE/.test(book.file));
const reviveSheet = reviveBook.sheets.find(
  (sheet) => sheet.name === "AWP 2026-2027",
);
projects.push({
  id: "REVIVE",
  name: "Relief, Employment and Vital Infrastructure for the Vulnerable in Emergencies (REVIVE II)",
  donor: "Not reported",
  award: "01004536",
  budget: null,
  currency: "Unspecified",
  start: "2026-07-15",
  end: "2027-07-14",
  updated: null,
  states: [],
  partners: "UNDP (workplan)",
  targetLocations: "",
  source: source(reviveBook.file, reviveSheet.name, 4),
  sourceType: "Workplan",
  status: "Unknown",
  progress: null,
  expenditure: null,
});
for (const row of reviveSheet.rows) {
  const title = clean(row.cells[2]);
  if (!/^Activity\s*\d/i.test(title)) continue;
  const rowSource = source(reviveBook.file, reviveSheet.name, row.row);
  const amount = number(row.cells[13]);
  financialLines.push({
    projectId: "REVIVE",
    description: title,
    amount,
    type: "Planned cost line; not award total or expenditure",
    currency: "Unspecified",
    source: rowSource,
  });
  const existing = activities.find(
    (activity) => activity.projectId === "REVIVE" && activity.title === title,
  );
  if (existing) {
    existing.sources.push(rowSource);
    if (amount !== null) existing.budget = (existing.budget ?? 0) + amount;
  } else
    activities.push({
      id: `REVIVE-A${row.row}`,
      projectId: "REVIVE",
      title,
      target: null,
      actual: null,
      status: "Planned",
      sector: sector(title),
      progress: null,
      comment: clean(row.cells[8]),
      budget: amount,
      currency: "Unspecified",
      source: rowSource,
      sources: [rowSource],
      due: null,
    });
}

for (const project of projects) {
  const book = audit.workbooks.find(
    (book) => book.file === project.source.file,
  );
  for (const sheet of book.sheets) {
    const header = sheet.rows.find(
      (row) =>
        row.cells.some((value) => /coordinates|GPS/i.test(clean(value))) &&
        row.cells.some((value) => /^(state|locality)\b/i.test(clean(value))),
    );
    if (!header) continue;
    const index = (pattern) =>
      header.cells.findIndex((value) => pattern.test(clean(value)));
    const coordIndex = index(/coordinates|GPS/i),
      stateIndex = index(/^state$/i),
      localityIndex = index(/^locality/i);
    const nameIndex = index(
      /location of|targeted area|site name|name of canals|^location$/i,
    );
    const beneficiaryIndex = index(/beneficiar/i),
      statusIndex = index(/^(status|implementation status|progress of work)/i);
    const handoverIndex = index(/handover.?date/i);
    const unit = /\bHH\b/i.test(clean(header.cells[beneficiaryIndex]))
      ? "households"
      : "people (source estimate)";
    let previousState = "";
    for (const row of sheet.rows.filter((row) => row.row > header.row)) {
      const cells = row.cells;
      if (
        cells.some((value) =>
          /^coordinates|^GPS coordinates/i.test(clean(value)),
        )
      )
        continue;
      previousState = clean(cells[stateIndex]) || previousState;
      const name = clean(cells[nameIndex]) || clean(cells[localityIndex]);
      const coordinateRaw = clean(cells[coordIndex]);
      if (!name && !coordinateRaw) continue;
      if (/^total|^no\.$/i.test(name)) continue;
      const point = coordinates(coordinateRaw);
      const statusRaw = clean(cells[statusIndex]);
      const handover = date(cells[handoverIndex]);
      sites.push({
        id: `${project.id}-S${sites.length + 1}`,
        projectId: project.id,
        name: name || `${sheet.name} / row ${row.row}`,
        state: stateName(
          previousState ||
            (project.states.length === 1 ? project.states[0] : ""),
        ),
        locality: clean(cells[localityIndex]),
        coordinates: point,
        coordinateRaw,
        sector: sector(sheet.name),
        beneficiaries: number(cells[beneficiaryIndex]),
        beneficiaryUnit: unit,
        status: handover ? "Completed" : evidenceStatus(statusRaw, null, null),
        statusRaw,
        handover,
        sources: [source(book.file, sheet.name, row.row)],
        origin: "Workbook",
      });
    }
  }
}

const waterRows = d3.csvParse(
  await fs.readFile("Geo Assets/All_water_Projects.csv", "utf8"),
);
const donorProject = {
  CERF: "CERF",
  EAA: "EAA",
  Italy: "ITALY",
  ITALY: "ITALY",
  JSB: "JSB",
  Kuwait: "KUWAIT",
  KUWAIT: "KUWAIT",
  NKUWAIT: "NKA",
  SDC: "SDCL",
};
for (const [index, row] of waterRows.entries()) {
  const fields = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [clean(key), clean(value)]),
  );
  const donor = fields.Donor;
  const projectId =
    donorProject[donor] ??
    (/cerf/i.test(donor)
      ? "CERF"
      : /kuwait/i.test(donor)
        ? "KUWAIT"
        : /sdc/i.test(donor)
          ? "SDCL"
          : null);
  const lat = number(fields.Latitude),
    lon = number(fields.Longitude);
  const point =
    lat !== null && lon !== null ? coordinates(`${lat},${lon}`) : null;
  const matching =
    point &&
    sites.find(
      (site) =>
        site.projectId === projectId &&
        site.coordinates &&
        d3.geoDistance(site.coordinates, point) < 0.00001,
    );
  const provenance = source(
    "Geo Assets/All_water_Projects.csv",
    "CSV",
    index + 2,
  );
  if (matching) {
    matching.sources.push(provenance);
    continue;
  }
  sites.push({
    id: `CSV-${index + 1}`,
    sourceId: fields["Project ID"],
    projectId,
    name: fields["Targeted area"] || fields["Sub-Project Name"],
    state: stateName(fields.State),
    locality: fields.Locality,
    coordinates: point,
    coordinateRaw:
      fields.Latitude || fields.Longitude
        ? `${fields.Latitude}, ${fields.Longitude}`
        : "",
    sector: "Water & sanitation",
    beneficiaries: number(fields["Approx. Beneficiaries"]),
    beneficiaryUnit: "people (source estimate)",
    status: "Unknown",
    statusRaw: "",
    handover: null,
    sources: [provenance],
    origin: "Water CSV",
  });
}

const waterRegisterFile =
  "Evidence-Based Planning and implementation Maps - Tracker(Tracker).csv";
const waterRegisterRows = d3.csvParse(
  new TextDecoder("windows-1252").decode(await fs.readFile(waterRegisterFile)),
);
const waterRegisterProject = {
  CERF: "CERF",
  EAA: "EAA",
  ITALY: "ITALY",
  JSB: "JSB",
  KUWAIT: "KUWAIT",
  NKUWAIT: "NKA",
  SDC: "SDCL",
  "KS RELIFE": "KSRELIEF",
};
const ksReliefRows = waterRegisterRows.filter(
  (row) => clean(row.Donor).toUpperCase() === "KS RELIFE",
);
if (
  ksReliefRows.length &&
  !projects.some((project) => project.id === "KSRELIEF")
) {
  const firstRow = ksReliefRows[0];
  const locations = [
    ...new Set(ksReliefRows.map((row) => stateName(row["State "]))),
  ];
  projects.push({
    id: "KSRELIEF",
    name: clean(firstRow["Project Name"]),
    donor: clean(firstRow.Donor),
    award: null,
    budget: null,
    currency: "Unspecified",
    budgetRaw: null,
    budgetFormat: "",
    start: null,
    end: null,
    updated: null,
    states: locations,
    targetLocations: locations.join(", "),
    partners: "Not reported",
    source: source(waterRegisterFile, "Water Projects", 2),
    sourceType: "Geographic register",
    sector: "Water & sanitation",
    progress: null,
    status: "Unknown",
    expenditure: null,
  });
}
for (const [index, row] of waterRegisterRows.entries()) {
  const donor = clean(row.Donor).toUpperCase();
  const projectId = waterRegisterProject[donor] ?? null;
  const project = projects.find((item) => item.id === projectId);
  const latitude = number(row.Latitude);
  const longitude = number(row.Longitude);
  const coordinateRaw =
    latitude !== null || longitude !== null
      ? `${clean(row.Latitude)}, ${clean(row.Longitude)}`
      : "";
  const point =
    latitude !== null && longitude !== null
      ? coordinates(`${latitude},${longitude}`)
      : null;
  const sourceRecord = source(waterRegisterFile, "Water Projects", index + 2);
  const sourceStatus = clean(row.Status);
  const implementationStatus = /^delivered$/i.test(sourceStatus)
    ? "Completed"
    : /^in progress$/i.test(sourceStatus)
      ? "Active"
      : "Unknown";
  const site = {
    id: `WTR-${clean(row["Project ID"]) || index + 1}`,
    sourceId: clean(row["Project ID"]),
    projectId,
    name:
      clean(row["Targeted area"]) ||
      clean(row["Sub-Project Name "]) ||
      `${clean(row.Donor)} water project ${index + 1}`,
    state: stateName(row["State "]),
    locality: clean(row["Locality "]),
    coordinates: point,
    coordinateRaw,
    sector: "Water & sanitation",
    beneficiaries: number(row["Approx. Beneficiaries"]),
    beneficiaryUnit: "people (source estimate)",
    status: implementationStatus,
    statusRaw: implementationStatus === "Unknown" ? "" : sourceStatus,
    registerStatus: sourceStatus,
    interventionType: clean(row["Type of water intervention "]),
    projectContact: clean(row["Project PoC"]),
    sowReference: clean(row["SOW Link"]),
    mapProvided: clean(row["Map Data Provided (Y/N)"]),
    coordinatesProvided: clean(row["Coordinates Provided (Y/N)"]),
    boqReceived: clean(row["BOQ Received (Y/N)"]),
    mapLink: clean(row["Map Link"]),
    notes: clean(row["Notes/Comments"]),
    handover: null,
    sources: [sourceRecord],
    origin: "Evidence-based water projects register",
  };
  sites.push(site);
  if (coordinateRaw && !point)
    issues.push({
      type: "Invalid coordinate",
      projectId,
      entityId: site.id,
      detail: coordinateRaw,
      source: sourceRecord,
    });
  if (site.coordinatesProvided.toLowerCase() === "yes" && !point)
    issues.push({
      type: "Coordinate register mismatch",
      projectId,
      entityId: site.id,
      detail:
        "Coordinates marked provided, but no valid coordinate pair is present.",
      source: sourceRecord,
    });
  if (site.coordinatesProvided.toLowerCase() === "no" && point)
    issues.push({
      type: "Coordinate register mismatch",
      projectId,
      entityId: site.id,
      detail:
        "A coordinate pair is present although the register marks coordinates as not provided.",
      source: sourceRecord,
    });
}

for (const site of sites) {
  const feature =
    site.coordinates &&
    boundaries.features.find((feature) =>
      d3.geoContains(feature, site.coordinates),
    );
  site.localityCode = feature?.properties.hrpcode ?? null;
  site.boundaryState = feature ? stateName(feature.properties.state_en) : null;
  if (!site.state && feature) site.state = site.boundaryState;
  if (site.state && site.boundaryState && site.state !== site.boundaryState)
    issues.push({
      type: "Spatial mismatch",
      projectId: site.projectId,
      entityId: site.id,
      detail: `${site.name}: source ${site.state}; boundary ${site.boundaryState}.`,
      source: site.sources[0],
    });
  if (site.coordinateRaw && !site.coordinates)
    issues.push({
      type: "Invalid coordinate",
      projectId: site.projectId,
      entityId: site.id,
      detail: site.coordinateRaw,
      source: site.sources[0],
    });
}
for (const project of projects) {
  const projectActivities = activities.filter(
    (activity) => activity.projectId === project.id,
  );
  const measured = projectActivities.filter(
    (activity) => activity.progress !== null,
  );
  project.progress = measured.length
    ? d3.mean(measured, (activity) => activity.progress)
    : null;
  project.measuredActivities = measured.length;
  project.activityCount = projectActivities.length;
  project.sector = sector(
    `${project.name} ${projectActivities.map((activity) => activity.title).join(" ")}`,
  );
  project.states = [
    ...new Set([
      ...project.states,
      ...locations
        .filter((location) => location.projectId === project.id)
        .map((location) => location.state),
      ...sites
        .filter((site) => site.projectId === project.id)
        .map((site) => site.state),
    ]),
  ].filter(Boolean);
  const allComplete =
    projectActivities.length > 0 &&
    projectActivities.every((activity) => activity.status === "Completed");
  project.status = allComplete
    ? "Completed"
    : projectActivities.some((activity) => activity.status === "Delayed")
      ? "Delayed"
      : project.start && project.start > asOf
        ? "Planned"
        : project.progress !== null ||
            projectActivities.some((activity) => activity.status === "Active")
          ? "Active"
          : project.sourceType === "Workplan"
            ? "Planned"
            : "Unknown";
  project.statusBasis = allComplete
    ? "All extracted activity evidence complete; project closure unverified"
    : "Derived from dates and extracted activity evidence; not an official closure status";
  project.rag = rag(project, asOf);
  project.alerts = [];
  if (project.end && project.end < asOf && project.status !== "Completed")
    project.alerts.push("End date passed; closure not evidenced");
  if (!project.updated)
    project.alerts.push("Reporting date missing or ambiguous");
  else if ((Date.parse(asOf) - Date.parse(project.updated)) / 86400000 > 90)
    project.alerts.push("Factsheet update more than 90 days old");
  if (!project.budget) project.alerts.push("Award budget not reported");
  if (project.currency === "Unspecified" && project.budget)
    project.alerts.push("Award currency not explicit");
  if (!sites.some((site) => site.projectId === project.id && site.coordinates))
    project.alerts.push("No verified project coordinates");
  if (project.progress === null)
    project.alerts.push("Comparable numeric progress unavailable");
}

for (const book of audit.workbooks) {
  for (const sheet of book.sheets) {
    const numericCells = sheet.rows.reduce(
      (sum, row) =>
        sum + row.cells.filter((value) => typeof value === "number").length,
      0,
    );
    inventory.push({
      file: book.file,
      sheet: sheet.name,
      rows: sheet.rows.length,
      columns: sheet.columns,
      numericCells,
      role: /hdx/i.test(book.file)
        ? "Reference schools register (not projects)"
        : /fact/i.test(sheet.name)
          ? "Award master"
          : /weekly|monthly/i.test(sheet.name)
            ? "Narrative reporting"
            : /budget|procurement|AWP|workplan|account|award list|PADF/i.test(
                  sheet.name,
                )
              ? "Planning / financial reference; not expenditure"
              : /location|water|solar|pump|canal|rehabilitation/i.test(
                    sheet.name,
                  )
                ? "Geographic / intervention register"
                : /indicator|result/i.test(sheet.name)
                  ? "Results framework"
                  : "Supporting / activity evidence",
    });
  }
}
const waterRegisterAuditRows = waterRegisterRows.map((row, index) => ({
  row: index + 2,
  cells: waterRegisterRows.columns.map((column) => row[column]),
}));
inventory.push({
  file: waterRegisterFile,
  sheet: "Water Projects",
  rows: waterRegisterAuditRows.length,
  columns: waterRegisterRows.columns.length,
  numericCells: waterRegisterAuditRows.reduce(
    (total, row) =>
      total + row.cells.filter((value) => number(value) !== null).length,
    0,
  ),
  role: "Geocoded water interventions and map / SOW / BOQ readiness register",
});
const waterRegister = {
  file: waterRegisterFile,
  rows: waterRegisterRows.length,
  mapped: sites.filter(
    (site) =>
      site.origin === "Evidence-based water projects register" &&
      site.coordinates,
  ).length,
  unmapped: sites.filter(
    (site) =>
      site.origin === "Evidence-based water projects register" &&
      !site.coordinates,
  ).length,
  mapProvided: waterRegisterRows.filter(
    (row) => clean(row["Map Data Provided (Y/N)"]).toLowerCase() === "yes",
  ).length,
  coordinatesReported: waterRegisterRows.filter(
    (row) => clean(row["Coordinates Provided (Y/N)"]).toLowerCase() === "yes",
  ).length,
  boqReceived: waterRegisterRows.filter(
    (row) => clean(row["BOQ Received (Y/N)"]).toLowerCase() === "yes",
  ).length,
  sourceStatuses: d3
    .rollups(
      waterRegisterRows,
      (rows) => rows.length,
      (row) => clean(row.Status) || "Not reported",
    )
    .map(([status, count]) => ({ status, count })),
};
const monitorSheet = reviveBook.sheets.find(
  (sheet) => sheet.name === "Monitoring Plan",
);
for (const row of monitorSheet.rows.filter(
  (row) => row.row >= 10 && /^Activity\s*\d/i.test(clean(row.cells[2])),
)) {
  const record = {
    projectId: "REVIVE",
    activity: clean(row.cells[2]),
    indicator: clean(row.cells[3]),
    baseline: number(row.cells[4]),
    target: number(row.cells[5]),
    actual: null,
    targetYear: 2027,
    femaleTarget: number(row.cells[6]),
    maleTarget: number(row.cells[7]),
    youthTarget: number(row.cells[8]),
    idpTarget: number(row.cells[9]),
    indirectTarget: number(row.cells[10]),
    methods: clean(row.cells[11]),
    frequency: clean(row.cells[12]),
    responsible: clean(row.cells[13]),
    verification: clean(row.cells[14]),
    source: source(reviveBook.file, monitorSheet.name, row.row),
  };
  monitoring.push(record);
  if (clean(row.cells[15]))
    risks.push({
      projectId: "REVIVE",
      description: clean(row.cells[15]),
      activity: record.activity,
      owner: record.responsible,
      rating: null,
      source: record.source,
    });
}
const beneficiaryRecords = [];
const beneficiarySheet = audit.workbooks
  .find((book) => /SDC_Durable/.test(book.file))
  .sheets.find((sheet) => sheet.name === "Beneficiaries_Reached");
for (const row of beneficiarySheet.rows.filter((row) => row.row > 3)) {
  if (!clean(row.cells[1]) || /total/i.test(clean(row.cells[1]))) continue;
  beneficiaryRecords.push({
    projectId: "SDCDS",
    projectName: clean(row.cells[1]),
    intervention: clean(row.cells[2]),
    state: stateName(row.cells[3]),
    locality: clean(row.cells[4]),
    directTarget: number(row.cells[7]),
    directActual: number(row.cells[10]),
    indirectTarget: number(row.cells[13]),
    indirectActual: number(row.cells[16]),
    reportingPeriod: "2026-09",
    source: source(
      "SDC_DurableSolutions_Tracker.xlsx",
      beneficiarySheet.name,
      row.row,
    ),
  });
}
const durableProject = projects.find((project) => project.id === "SDCDS");
durableProject.states = [
  ...new Set([
    ...durableProject.states,
    ...beneficiaryRecords.map((record) => record.state).filter(Boolean),
  ]),
];
const references = [];
const health = d3.csvParse(
  await fs.readFile("Geo Assets/Al_health_facilities.csv", "utf8"),
);
for (const row of health) {
  const point = coordinates(`${row.latitude},${row.longitude}`);
  if (point)
    references.push({
      name: row.name,
      coordinates: point,
      type: "Health",
      source: "Geo Assets/Al_health_facilities.csv",
    });
}
const schools = await read("Geo Assets/Schools.json");
for (const feature of schools.features)
  if (feature.geometry?.type === "Point")
    references.push({
      name: feature.properties.name_en || feature.properties.name || "School",
      coordinates: feature.geometry.coordinates,
      type: "Education",
      source: "Geo Assets/Schools.json",
    });
const externalLayers = [];
for (const file of [
  "Geo Assets/External/hotosm-education-gezira.geojson",
  "Geo Assets/External/hotosm-water-reference-gezira.geojson",
  "Geo Assets/External/education/education_facilities.geojson",
  "Geo Assets/External/poi/points_of_interest.geojson",
]) {
  const layer = await read(file);
  externalLayers.push({
    file,
    featureCount: layer.features.length,
    type: layer.type,
    role: "Reference only; not implementation evidence",
  });
}
const authorityRows = await read(
  "Geo Assets/External/schools-authority-gezira.json",
);
const authorityReference = {
  file: "Geo Assets/External/schools-authority-gezira.json",
  rows: authorityRows.length,
  role: "Education authority reference (2021); locality codes only, no point coordinates",
  byLocality: d3
    .rollups(
      authorityRows,
      (rows) => ({
        schools: rows.length,
        reportedStudents: d3.sum(
          rows,
          (row) => number(row.students_total) ?? 0,
        ),
        reportedTeachers: d3.sum(rows, (row) => number(row.teachers) ?? 0),
      }),
      (row) => row.locality_code,
    )
    .map(([code, totals]) => ({ code, ...totals })),
};
const milestones = sites
  .filter((site) => site.handover)
  .map((site) => ({
    projectId: site.projectId,
    title: `Handover: ${site.name}`,
    date: site.handover,
    type: "Observed site handover",
    status: "Completed",
    source: site.sources[0],
  }));
const deadlines = projects
  .filter((project) => project.end)
  .map((project) => ({
    projectId: project.id,
    title: "Award end / closure verification",
    date: project.end,
    type: "Award deadline; not activity deadline",
    state:
      project.end < asOf
        ? "Past award end"
        : (Date.parse(project.end) - Date.parse(asOf)) / 86400000 <= 90
          ? "Next 90 days"
          : "Future award end",
    source: project.source,
  }));
const schoolBook = audit.workbooks.find((book) => /hdx/i.test(book.file));
const schoolReference = {
  file: schoolBook.file,
  rows: schoolBook.sheets[0].rows.length,
  headers: schoolBook.sheets[0].rows.slice(0, 2),
  role: "National education reference; not project beneficiaries",
};
const model = {
  schemaVersion: 1,
  asOf,
  generatedAt: new Date().toISOString(),
  projects,
  activities,
  sites,
  locations,
  updates,
  financialLines,
  beneficiaryRecords,
  monitoring,
  risks,
  milestones,
  deadlines,
  issues,
  inventory,
  externalLayers,
  schoolReference,
  authorityReference,
  waterRegister,
  references,
  humanitarianSources: humanitarian.sources,
  notes: [
    "Award budgets remain in source currencies. Numeric factsheet budgets without explicit currency are Unspecified; no foreign-exchange conversion is applied.",
    "Currency formatting is retained as source evidence: euro-formatted awards are EUR, CHF text is CHF, and dollar-formatted awards are grouped as USD by convention; confirm dollar denomination with finance.",
    "Financial actuals in the Kuwait tracker are retained as reported actuals, not verified expenditure. No pillar utilization rate is asserted.",
    "Progress is an unweighted mean of capped numeric activity actual/target ratios, not an official project completion percentage. Different indicator units are not summed.",
    "Geography filters select associated awards. Award budgets and activity indices remain award-wide, not apportioned to the selected locality. Period filters select award-date overlap, not historical performance snapshots.",
    "Statuses and RAG are derived screening indicators. Red means end date passed without complete extracted activity evidence; Amber means missing/stale reporting or unknown status. No project closure is certified.",
    "Site beneficiary estimates are non-deduplicated service reach, not unique people reached. Households are kept separate. Overlap between interventions and awards is possible.",
    "The new evidence-based water register links donors to existing awards where unambiguous; the KS Relief award is separate and has no source budget. Its coordinate rows remain distinct, including repeated coordinate pairs. The earlier all-water CSV may merge same-award records within about 64 metres as potential duplicates.",
    "Missing coordinates are not replaced by locality centroids. Geographic coverage uses mapped observations, not inferred operational coverage.",
    "Reference polygons are displayed as D3 centroids after winding normalization; these are contextual feature centres, not project locations. The education-authority register has locality codes but no point coordinates.",
    "Humanitarian indicators are contextual source snapshots, not current verified needs or project performance measures. Source dates remain visible.",
    "National school workbook, lookup lists, procurement, HR, communications, results frameworks and workplan sheets remain available through the source audit; lookup values are not counted as projects.",
    "No reliable activity-level deadline register, verified spend ledger, or structured risk rating is uniformly available. These gaps are explicitly reported.",
  ],
};
await fs.mkdir("public/data", { recursive: true });
await fs.mkdir("public/data/audit", { recursive: true });
await fs.mkdir("public/data/reference", { recursive: true });
let sheetIndex = 0;
for (const book of audit.workbooks)
  for (const sheet of book.sheets)
    await fs.writeFile(
      `public/data/audit/${sheetIndex++}.json`,
      JSON.stringify(sheet.rows),
    );
await fs.writeFile(
  `public/data/audit/${sheetIndex}.json`,
  JSON.stringify(waterRegisterAuditRows),
);
for (const [index, layer] of externalLayers.entries())
  await fs.copyFile(layer.file, `public/data/reference/${index}.geojson`);
await fs.copyFile(
  authorityReference.file,
  "public/data/reference/authority.json",
);
await fs.writeFile("public/data/model.json", JSON.stringify(model));
await fs.writeFile(
  "public/data/boundaries.geojson",
  JSON.stringify({
    ...boundaries,
    features: boundaries.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        state: stateName(feature.properties.state_en),
        population:
          population.populations[feature.properties.hrpcode] ??
          feature.properties.total_pop,
        populationBasis: population.populations[feature.properties.hrpcode]
          ? "UNFPA 2024 override"
          : "Boundary source; reference year unspecified",
        needs: humanitarian.localities[feature.properties.hrpcode] ?? null,
      },
    })),
  }),
);
await fs.writeFile(
  "public/data/state-boundaries.geojson",
  JSON.stringify(stateBoundaries),
);
await fs.writeFile(
  "data/analysis-summary.json",
  JSON.stringify(
    {
      asOf,
      workbooks: audit.workbooks.length,
      worksheets: inventory.length,
      projects: projects.length,
      activities: activities.length,
      sites: sites.length,
      mappedSites: sites.filter((site) => site.coordinates).length,
      unmappedSites: sites.filter((site) => !site.coordinates).length,
      waterRegister,
      issues: issues.length,
      externalLayers,
      notes: model.notes,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      projects: projects.map((project) => ({
        id: project.id,
        budget: project.budget,
        currency: project.currency,
        activities: project.activityCount,
        progress: project.progress,
        status: project.status,
        states: project.states,
      })),
      activities: activities.length,
      sites: sites.length,
      mapped: sites.filter((site) => site.coordinates).length,
      waterRegister,
      issues: issues.length,
    },
    null,
    2,
  ),
);
