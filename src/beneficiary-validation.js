import * as d3 from "d3";

const session = {
  records: [],
  audit: [],
  evidenceFiles: new Map(),
  selectedId: null,
  nextId: 1,
  rate: 10,
  sampleMethod: "risk",
  filters: { search: "", project: "", partner: "", status: "" },
};
const statuses = [
  "Not Started",
  "In Progress",
  "Verified",
  "Failed Verification",
  "Unable to Reach",
];
const modalities = ["Call", "Field visit", "Survey", "Third party"];
const genders = new Set(["female", "male", "other", "prefer not to say", "unknown"]);
const requiredFields = [
  "Name",
  "Gender",
  "Age",
  "Phone",
  "ID number",
  "Project",
  "Activity",
  "Partner",
  "Reporting period",
  "Location",
];
const aliases = {
  recordId: ["beneficiary_id", "beneficiary id", "record_id", "record id", "case id"],
  name: ["name", "beneficiary name", "full name"],
  gender: ["gender", "sex"],
  age: ["age", "age years"],
  phone: ["phone", "phone_number", "telephone", "contact number", "mobile"],
  idNumber: ["id_number", "id number", "national id", "national_id", "identity number"],
  project: ["project_id", "project id", "project"],
  activity: ["activity_id", "activity id", "activity", "output"],
  partner: ["partner", "implementing partner", "ip"],
  period: ["reporting_period", "reporting period", "period"],
  location: ["location", "address", "community", "targeted area"],
  state: ["state", "admin1", "admin_1"],
  locality: ["locality", "district", "admin2", "admin_2"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon", "lng"],
  participationDate: ["participation_date", "participation date", "activity date"],
};
const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalize = (value) => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const digits = (value) => clean(value).replace(/\D/g, "");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const numberFormat = d3.format(",");
const csvColumns = [
  "beneficiary_id", "name", "gender", "age", "phone", "id_number",
  "project_id", "activity_id", "partner", "reporting_period", "state",
  "locality", "location", "latitude", "longitude", "participation_date",
];

function findBoundary(stateName, localityName, boundaries) {
  const localityKey = normalize(localityName);
  const stateKey = normalize(stateName);
  if (localityKey) {
    const candidates = boundaries.filter((feature) =>
      normalize(feature.properties.loc_en) === localityKey ||
      normalize(feature.properties.hrpcode) === localityKey,
    );
    return candidates.find((feature) => !stateKey || normalize(feature.properties.state) === stateKey) ??
      (candidates.length === 1 ? candidates[0] : null);
  }
  return null;
}

export function parseBeneficiaryCsv(csvText, {
  projects = [],
  activities = [],
  boundaries = [],
  sourceName = "Beneficiary upload",
} = {}) {
  const parsed = d3.csvParse(csvText);
  if (!parsed.columns.length || !parsed.length)
    throw new Error("The selected CSV has no beneficiary rows.");
  const headers = new Map(parsed.columns.map((header) => [normalize(header), header]));
  const sourceColumn = (field) => aliases[field].map(normalize).map((key) => headers.get(key)).find(Boolean);
  const columns = Object.fromEntries(Object.keys(aliases).map((field) => [field, sourceColumn(field)]));
  const projectsById = new Map(projects.map((project) => [normalize(project.id), project]));
  const activitiesById = new Map(activities.map((activity) => [normalize(activity.id), activity]));
  const activitiesByTitle = new Map(activities.map((activity) => [normalize(activity.title), activity]));
  const importId = `upload-${Date.now()}`;

  return parsed.map((row, index) => {
    const value = (field) => columns[field] ? clean(row[columns[field]]) : "";
    const rawProject = value("project");
    const project = projectsById.get(normalize(rawProject)) ??
      projects.find((candidate) => normalize(candidate.name) === normalize(rawProject));
    const rawActivity = value("activity");
    let activity = activitiesById.get(normalize(rawActivity)) ?? activitiesByTitle.get(normalize(rawActivity));
    if (activity && project && activity.projectId !== project.id) activity = null;
    if (!activity && project) {
      const candidates = activities.filter((candidate) => candidate.projectId === project.id);
      activity = candidates.find((candidate) => normalize(candidate.title).includes(normalize(rawActivity)) && normalize(rawActivity)) ?? null;
    }
    const ageText = value("age");
    const age = /^\d{1,3}$/.test(ageText) ? Number(ageText) : null;
    const rawGender = value("gender").toLowerCase();
    const gender = ({ f: "Female", m: "Male", woman: "Female", man: "Male" })[rawGender] ??
      (rawGender ? rawGender.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "");
    const phoneRaw = value("phone");
    const phoneNormalized = digits(phoneRaw);
    const idNumber = value("idNumber");
    const idNormalized = normalize(idNumber);
    const latitudeText = value("latitude");
    const longitudeText = value("longitude");
    const latitude = latitudeText !== "" && Number.isFinite(Number(latitudeText)) ? Number(latitudeText) : null;
    const longitude = longitudeText !== "" && Number.isFinite(Number(longitudeText)) ? Number(longitudeText) : null;
    const coordinates = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
      ? [longitude, latitude]
      : null;
    const rawState = value("state") || "";
    const rawLocality = value("locality") || value("location");
    const boundary = findBoundary(rawState, rawLocality, boundaries);
    const linkedActivity = activity;
    const linkedProject = project ?? (linkedActivity ? projectsById.get(normalize(linkedActivity.projectId)) : null);
    const record = {
      id: `${importId}-${index + 1}`,
      beneficiaryId: value("recordId"),
      name: value("name"),
      gender,
      age,
      phone: phoneRaw,
      phoneNormalized,
      idNumber,
      idNormalized,
      projectId: linkedProject?.id ?? rawProject,
      projectName: linkedProject?.name ?? rawProject,
      projectBudget: linkedProject?.budget ?? null,
      activityId: linkedActivity?.id ?? rawActivity,
      activityTitle: linkedActivity?.title ?? rawActivity,
      partner: value("partner") || linkedProject?.partners || "",
      reportingPeriod: value("period"),
      state: boundary?.properties.state ?? rawState,
      locality: boundary?.properties.loc_en ?? rawLocality,
      localityCode: boundary?.properties.hrpcode ?? null,
      coordinates: coordinates ?? (boundary ? d3.geoCentroid(boundary) : null),
      locationPrecision: coordinates ? "Coordinates" : boundary ? "Locality centroid" : "Unmapped",
      participationDate: value("participationDate"),
      sourceName,
      sourceRow: index + 2,
      status: "Not Started",
      sampleSelected: false,
      followUp: {
        modality: "Call",
        participation: "Unknown",
        serviceReceived: "",
        satisfaction: "",
        verificationDate: "",
        verificationLocation: "",
        evidence: "",
        notes: "",
      },
      issues: [],
      duplicateFlags: [],
      completeness: 0,
    };
    record.completenessFields = {
      name: Boolean(record.name),
      gender: genders.has(record.gender.toLowerCase()),
      age: age !== null && age >= 0 && age <= 110,
      phone: phoneNormalized.length >= 7 && phoneNormalized.length <= 15,
      idNumber: Boolean(idNormalized),
      project: Boolean(linkedProject),
      activity: Boolean(linkedActivity),
      partner: Boolean(record.partner),
      period: Boolean(record.reportingPeriod),
      location: Boolean(record.coordinates),
    };
    return record;
  });
}

export function assessBeneficiaries(records) {
  const issuesByRecord = new Map(records.map((record) => [record.id, new Set()]));
  const duplicateFlagsByRecord = new Map(records.map((record) => [record.id, new Set()]));
  const flag = (record, message, duplicateType) => {
    issuesByRecord.get(record.id).add(message);
    if (duplicateType) duplicateFlagsByRecord.get(record.id).add(duplicateType);
  };
  for (const record of records) {
    const fields = record.completenessFields;
    for (const [field, label] of requiredFields.map((label, index) => [
      ["name", "gender", "age", "phone", "idNumber", "project", "activity", "partner", "period", "location"][index], label,
    ])) {
      if (!fields[field]) {
        const issue = field === "age" && record.age !== null
          ? "Invalid age"
          : field === "phone" && record.phone
            ? "Invalid phone format"
            : field === "activity" && record.activityId
              ? "Activity not linked"
              : field === "project" && record.projectId
                ? "Project not linked"
                : `Missing ${label.toLowerCase()}`;
        flag(record, issue);
      }
    }
  }
  const groups = (keyFn) => {
    const result = new Map();
    for (const record of records) {
      const key = keyFn(record);
      if (!key) continue;
      result.set(key, [...(result.get(key) ?? []), record]);
    }
    return result.values();
  };
  for (const group of groups((record) => record.idNormalized)) {
    if (group.length < 2) continue;
    const projectIds = new Set(group.map((record) => record.projectId).filter(Boolean));
    const activities = new Set(group.map((record) => `${record.projectId}|${record.activityId}`));
    for (const record of group) {
      if (activities.size < group.length) flag(record, "Duplicate ID within activity", "ID duplicate");
      if (projectIds.size > 1) flag(record, "ID repeated across projects", "Cross-project ID");
    }
  }
  for (const group of groups((record) => record.phoneNormalized)) {
    if (group.length < 2) continue;
    const projectIds = new Set(group.map((record) => record.projectId).filter(Boolean));
    const activityKeys = new Set(group.map((record) => `${record.projectId}|${record.activityId}`));
    for (const record of group) {
      if (activityKeys.size < group.length) flag(record, "Duplicate phone within activity", "Phone duplicate");
      if (projectIds.size > 1) flag(record, "Phone repeated across projects", "Cross-project phone");
    }
  }
  return records.map((record) => {
    record.issues = [...issuesByRecord.get(record.id)];
    record.duplicateFlags = [...duplicateFlagsByRecord.get(record.id)];
    const values = Object.values(record.completenessFields);
    record.completeness = values.length ? values.filter(Boolean).length / values.length : 0;
    return record;
  });
}

export function selectVerificationSample(records, { percentage = 10, method = "risk", projects = [] } = {}) {
  const eligible = records.filter((record) => !record.sampleSelected);
  if (!eligible.length) return [];
  const size = Math.min(eligible.length, Math.max(1, Math.ceil(eligible.length * percentage / 100)));
  if (method === "random") {
    for (let index = eligible.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [eligible[index], eligible[swap]] = [eligible[swap], eligible[index]];
    }
    return eligible.slice(0, size);
  }
  const countsByProject = d3.rollup(eligible, (rows) => rows.length, (record) => record.projectId);
  const maxCount = d3.max([...countsByProject.values()]) || 1;
  const budgets = projects.map((project) => project.budget).filter(Number.isFinite);
  const maxBudget = d3.max(budgets) || 1;
  const partnerHistory = partnerScores(records);
  const partnerScore = new Map(partnerHistory.map((partner) => [normalize(partner.partner), partner.score]));
  const risk = (record) => {
    const project = projects.find((candidate) => candidate.id === record.projectId);
    const partnerQuality = partnerScore.get(normalize(record.partner));
    return record.issues.length * 5 +
      ((countsByProject.get(record.projectId) ?? 0) / maxCount) * 25 +
      ((project?.budget ?? 0) / maxBudget) * 20 +
      (partnerQuality == null ? 10 : 100 - partnerQuality) * 0.3 +
      Math.random() * 0.01;
  };
  return eligible.sort((a, b) => risk(b) - risk(a)).slice(0, size);
}

export function partnerScores(records) {
  return d3.groups(records, (record) => record.partner || "Unspecified partner")
    .map(([partner, rows]) => {
      const verified = rows.filter((record) => record.status === "Verified").length;
      const attempts = rows.filter((record) => ["Verified", "Failed Verification"].includes(record.status)).length;
      const completeness = d3.mean(rows, (record) => record.completeness) ?? 0;
      const duplicateRate = rows.filter((record) => record.duplicateFlags.length).length / rows.length;
      const passRate = attempts ? verified / attempts : null;
      const score = Math.round(100 * (0.55 * completeness + 0.25 * (1 - duplicateRate) + 0.2 * (passRate ?? 0.5)));
      return {
        partner,
        rows: rows.length,
        completeness,
        duplicateRate,
        verified,
        attempts,
        passRate,
        score,
        rating: score >= 85 ? "High" : score >= 65 ? "Medium" : "Low",
      };
    })
    .sort((a, b) => b.score - a.score);
}

function addAudit(action, record, detail) {
  session.audit.unshift({
    at: new Date().toISOString(),
    action,
    recordId: record?.id ?? "",
    beneficiary: record?.name ?? "",
    projectId: record?.projectId ?? "",
    activityId: record?.activityId ?? "",
    detail,
  });
}

function downloadCsv(filename, rows, columns) {
  const csv = rows.length
    ? d3.csvFormat(
        rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => {
          const value = row[column];
          const formatted = Array.isArray(value)
            ? value.join("; ")
            : value && typeof value === "object"
              ? JSON.stringify(value)
              : value;
          return [column, formatted ?? ""];
        }),
      ),
        ),
      )
    : d3.csvFormatRows([columns]);
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawBeneficiaryMap(root, records, boundaries, projectSites, onSelect) {
  const width = 760;
  const height = 330;
  root.innerHTML = "";
  if (!records.length) {
    root.innerHTML = '<p class="empty-state">Upload a beneficiary list to map verification coverage.</p>';
    return;
  }
  const points = records.filter((record) => record.coordinates);
  if (!points.length) {
    root.innerHTML = '<p class="empty-state">No beneficiary coordinates or locality matches are available for this selection.</p>';
    return;
  }
  const projection = d3.geoMercator().fitExtent([[12, 12], [width - 12, height - 12]], {
    type: "FeatureCollection",
    features: boundaries,
  });
  const path = d3.geoPath(projection);
  const svg = d3.select(root).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Beneficiary verification map");
  svg.append("g").selectAll("path").data(boundaries).join("path")
    .attr("d", path).attr("fill", "#f4f6f8").attr("stroke", "#cbd3da").attr("stroke-width", 0.7);
  const interventionSites = projectSites.filter((site) =>
    site.coordinates && (!session.filters.project || site.projectId === session.filters.project),
  );
  svg.append("g").attr("class", "intervention-sites")
    .selectAll("circle").data(interventionSites).join("circle")
    .attr("class", "intervention-site")
    .attr("cx", (site) => projection(site.coordinates)[0])
    .attr("cy", (site) => projection(site.coordinates)[1])
    .attr("r", 5).attr("fill", "#fff").attr("stroke", "#006eb5")
    .attr("stroke-width", 2)
    .append("title").text((site) => `${site.projectId}: ${site.name} / intervention site`);
  const color = (record) => ({
    "Verified": "#25876e",
    "Failed Verification": "#bd4b51",
    "Unable to Reach": "#c79b35",
    "In Progress": "#006eb5",
    "Not Started": "#687782",
  })[record.status] ?? "#687782";
  svg.append("g").selectAll("circle").data(points).join("circle")
    .attr("cx", (record) => projection(record.coordinates)[0])
    .attr("cy", (record) => projection(record.coordinates)[1])
    .attr("r", 4).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 1)
    .attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", (record) => `${record.name}, ${record.state} / ${record.locality}, ${record.status}`)
    .on("click", (_event, record) => onSelect(record.id))
    .on("keydown", (event, record) => {
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        onSelect(record.id);
      }
    });
  root.insertAdjacentHTML("beforeend", '<div class="map-legend"><span><i class="legend-dot" style="background:#25876e"></i>Verified beneficiary</span><span><i class="legend-dot" style="background:#bd4b51"></i>Failed</span><span><i class="legend-dot" style="background:#c79b35"></i>Unable to reach</span><span><i class="legend-dot" style="background:#687782"></i>Not started</span><span><i class="legend-dot" style="background:#fff;border:2px solid #006eb5"></i>Intervention site</span></div>');
}

export function renderBeneficiaryValidation(root, { projects, activities, sites, boundaries }) {
  const rerender = () => renderBeneficiaryValidation(root, { projects, activities, sites, boundaries });
  const terminalStatuses = ["Verified", "Failed Verification", "Unable to Reach"];
  const all = assessBeneficiaries(session.records);
  const stats = partnerScores(all);
  const verified = all.filter((record) => record.status === "Verified").length;
  const terminal = all.filter((record) => terminalStatuses.includes(record.status)).length;
  const duplicateRecords = all.filter((record) => record.duplicateFlags.length).length;
  const completeness = all.length ? d3.mean(all, (record) => record.completeness) : null;
  const passRate = terminal ? verified / terminal : null;
  const score = all.length
    ? Math.round(100 * ((completeness ?? 0) * 0.55 + (1 - duplicateRecords / all.length) * 0.25 + (passRate ?? 0.5) * 0.2))
    : null;
  const rating = score == null ? "No data" : score >= 85 ? "High" : score >= 65 ? "Medium" : "Low";
  const matches = all.filter((record) => {
    const text = `${record.name} ${record.idNumber} ${record.projectId} ${record.activityTitle} ${record.partner} ${record.locality}`.toLowerCase();
    return (!session.filters.search || text.includes(session.filters.search.toLowerCase())) &&
      (!session.filters.project || record.projectId === session.filters.project) &&
      (!session.filters.partner || record.partner === session.filters.partner) &&
      (!session.filters.status || record.status === session.filters.status);
  });
  const selected = all.find((record) => record.id === session.selectedId) ?? null;
  const statusRows = statuses.map((status) => [status, all.filter((record) => record.status === status).length]);
  const duplicateRateByActivity = d3.rollups(
    all,
    (rows) => rows.filter((record) => record.duplicateFlags.length).length / rows.length,
    (record) => `${record.projectId}|${record.activityId}`,
  );
  const failureByActivity = d3.rollups(
    all.filter((record) => terminalStatuses.includes(record.status)),
    (rows) => rows.filter((record) => record.status === "Failed Verification").length / rows.length,
    (record) => `${record.projectId}|${record.activityId}`,
  );
  const alerts = [];
  for (const [activity, rate] of duplicateRateByActivity)
    if (rate >= 0.05) alerts.push(`${activity}: duplicate rate ${d3.format(".0%")(rate)} exceeds 5%.`);
  for (const [activity, rate] of failureByActivity)
    if (rate >= 0.2) alerts.push(`${activity}: verification failures ${d3.format(".0%")(rate)} exceed 20%.`);
  if (all.length && score < 65) alerts.push(`Beneficiary list reliability is low (${score}/100).`);

  root.innerHTML = `<div class="beneficiary-module">
    <p class="beneficiary-privacy" role="note">Beneficiary files are processed in this browser session only; they are not uploaded or saved. Use only authorized lists on an approved device. Exported files contain personal data.</p>
    <div class="beneficiary-toolbar"><label class="beneficiary-upload">Upload IP beneficiary CSV<input id="beneficiary-file" type="file" accept=".csv,text/csv"></label><button type="button" id="beneficiary-template">Download template</button><label>Sampling method<select id="beneficiary-sample-method"><option value="risk" ${session.sampleMethod === "risk" ? "selected" : ""}>Risk-based</option><option value="random" ${session.sampleMethod === "random" ? "selected" : ""}>Random</option></select></label><label>Sample %<input id="beneficiary-sample-rate" type="number" min="1" max="100" value="${session.rate}"></label><button type="button" id="beneficiary-generate-sample" ${all.length ? "" : "disabled"}>Generate verification sample</button><button type="button" id="beneficiary-export" ${all.length ? "" : "disabled"}>Export records</button><button type="button" id="beneficiary-audit-export" ${session.audit.length ? "" : "disabled"}>Export audit trail</button><button type="button" id="beneficiary-clear" ${all.length ? "" : "disabled"}>Clear session</button></div>
    <div id="beneficiary-message" class="beneficiary-message" role="status"></div>
    <section class="kpis beneficiary-kpis" aria-label="Beneficiary validation summary"><article class="kpi"><div class="kpi-label">Reported beneficiaries</div><div class="kpi-value">${numberFormat(all.length)}</div><div class="kpi-note">Across ${numberFormat(new Set(all.map((record) => record.partner)).size)} IPs / current session</div></article><article class="kpi"><div class="kpi-label">Successfully verified</div><div class="kpi-value">${numberFormat(verified)}</div><div class="kpi-note">${passRate == null ? "No completed verifications" : `${d3.format(".0%")(passRate)} pass rate`}</div></article><article class="kpi"><div class="kpi-label">Verification coverage</div><div class="kpi-value">${terminal ? d3.format(".0%")(terminal / Math.max(1, all.length)) : "0%"}</div><div class="kpi-note">Verified, failed, or unable to reach</div></article><article class="kpi"><div class="kpi-label">Record completeness</div><div class="kpi-value">${completeness == null ? "N/A" : d3.format(".0%")(completeness)}</div><div class="kpi-note">Required fields present and valid</div></article><article class="kpi"><div class="kpi-label">List reliability</div><div class="kpi-value">${score == null ? "N/A" : `${score}/100`}</div><div class="kpi-note">${rating} / deduplication, completeness, verification</div></article></section>
    <div class="beneficiary-grid"><section class="beneficiary-section"><div class="panel-head"><div><h2>Data quality and alerts</h2><p>Duplicate detection, validation, and threshold flags</p></div></div><div class="beneficiary-quality"><span>${numberFormat(duplicateRecords)} records with duplicate flags</span><span>${numberFormat(all.filter((record) => record.issues.length).length)} records need review</span><span>${numberFormat(all.filter((record) => record.status === "In Progress").length)} verifications in progress</span><span>Quality rating: ${escapeHtml(rating)}</span></div><ul class="beneficiary-alerts">${alerts.slice(0, 10).map((alert) => `<li>${escapeHtml(alert)}</li>`).join("") || `<li>${all.length ? "No threshold alerts for the current session." : "Upload an IP list to run checks and generate alerts."}</li>`}</ul></section><section class="beneficiary-section"><div class="panel-head"><div><h2>Verification status</h2><p>Session-wide follow-up status</p></div></div><div class="beneficiary-statuses">${statusRows.map(([status, count]) => `<div><span>${escapeHtml(status)}</span><strong>${numberFormat(count)}</strong></div>`).join("")}</div></section></div>
    <div class="beneficiary-grid"><section class="beneficiary-section"><div class="panel-head"><div><h2>Implementing partner performance</h2><p>Current imported records; historical reliability requires prior lists in this session</p></div></div><div class="table-wrap"><table><thead><tr><th>Partner</th><th>Reported</th><th>Completeness</th><th>Duplicate rate</th><th>Pass rate</th><th>Reliability</th><th>Rating</th></tr></thead><tbody>${stats.map((partner) => `<tr><td>${escapeHtml(partner.partner)}</td><td>${numberFormat(partner.rows)}</td><td>${d3.format(".0%")(partner.completeness)}</td><td>${d3.format(".0%")(partner.duplicateRate)}</td><td>${partner.passRate == null ? "N/A" : d3.format(".0%")(partner.passRate)}</td><td>${partner.score}/100</td><td>${escapeHtml(partner.rating)}</td></tr>`).join("") || '<tr><td colspan="7">No partner data loaded</td></tr>'}</tbody></table></div></section><section class="beneficiary-section"><div class="panel-head"><div><h2>Beneficiary geography</h2><p>Filled markers show beneficiary verification status; hollow blue markers show mapped intervention sites.</p></div></div><div id="beneficiary-map" class="beneficiary-map"></div></section></div>
    <section class="beneficiary-section"><div class="panel-head"><div><h2>Beneficiary repository</h2><p>${numberFormat(matches.length)} of ${numberFormat(all.length)} records / up to 200 shown / row issues include missing fields, invalid formats, and duplicates</p></div></div><div class="beneficiary-filters"><input id="beneficiary-search" type="search" placeholder="Search name, ID, activity, partner, locality" value="${escapeHtml(session.filters.search)}"><select id="beneficiary-filter-project"><option value="">All projects</option>${projects.map((project) => `<option value="${escapeHtml(project.id)}" ${session.filters.project === project.id ? "selected" : ""}>${escapeHtml(project.id)} / ${escapeHtml(project.name)}</option>`).join("")}</select><select id="beneficiary-filter-partner"><option value="">All partners</option>${[...new Set(all.map((record) => record.partner).filter(Boolean))].sort().map((partner) => `<option ${session.filters.partner === partner ? "selected" : ""}>${escapeHtml(partner)}</option>`).join("")}</select><select id="beneficiary-filter-status"><option value="">All statuses</option>${statuses.map((status) => `<option ${session.filters.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></div><div class="table-wrap"><table><thead><tr><th>Beneficiary</th><th>Project / activity</th><th>Partner / period</th><th>Quality flags</th><th>Completeness</th><th>Sample</th><th>Verification</th><th>Review</th></tr></thead><tbody>${matches.slice(0, 200).map((record) => `<tr><td>${escapeHtml(record.name || "Missing name")}<div class="project-name">ID: ${escapeHtml(record.beneficiaryId || "Missing")}</div></td><td>${escapeHtml(record.projectId || "Unlinked")}<div class="project-name">${escapeHtml(record.activityTitle || "Activity not linked")}</div></td><td>${escapeHtml(record.partner || "Missing partner")}<div class="project-name">${escapeHtml(record.reportingPeriod || "Missing period")}</div></td><td>${record.issues.length ? escapeHtml(record.issues.join("; ")) : "No flags"}</td><td>${d3.format(".0%")(record.completeness)}</td><td>${record.sampleSelected ? "Selected" : "—"}</td><td><select data-record-status="${escapeHtml(record.id)}">${statuses.map((status) => `<option ${record.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></td><td><button type="button" data-review-record="${escapeHtml(record.id)}">Review</button></td></tr>`).join("") || '<tr><td colspan="8">Upload a standardized beneficiary CSV to begin validation.</td></tr>'}</tbody></table></div>${matches.length > 200 ? '<p class="footnote">Export records to review the complete list.</p>' : ""}</section>
    ${selected ? `<section class="beneficiary-section beneficiary-review"><div class="panel-head"><div><h2>Verification follow-up</h2><p>${escapeHtml(selected.name)} / ${escapeHtml(selected.projectId)} / ${escapeHtml(selected.activityTitle)}</p></div></div><div class="beneficiary-review-grid"><label>Status<select id="review-status">${statuses.map((status) => `<option ${selected.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></label><label>Method<select id="review-modality">${modalities.map((method) => `<option ${selected.followUp.modality === method ? "selected" : ""}>${method}</option>`).join("")}</select></label><label>Participation<select id="review-participation">${["Unknown", "Yes", "No", "Partial"].map((value) => `<option ${selected.followUp.participation === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Service received<input id="review-service" value="${escapeHtml(selected.followUp.serviceReceived)}"></label><label>Satisfaction (1-5)<input id="review-satisfaction" type="number" min="1" max="5" value="${escapeHtml(selected.followUp.satisfaction)}"></label><label>Participation date<input id="review-date" type="date" value="${escapeHtml(selected.followUp.verificationDate)}"></label><label>Verification location<input id="review-location" value="${escapeHtml(selected.followUp.verificationLocation)}"></label><label>Evidence reference<input id="review-evidence" value="${escapeHtml(selected.followUp.evidence)}"></label><label class="wide">Attach supporting evidence<input id="review-evidence-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"><span id="review-evidence-name">${escapeHtml(session.evidenceFiles.get(selected.id)?.name ?? "No evidence attached")}</span></label><label class="wide">Notes<textarea id="review-notes" rows="3">${escapeHtml(selected.followUp.notes)}</textarea></label></div>${session.evidenceFiles.has(selected.id) ? '<button type="button" id="download-review-evidence">Download attached evidence</button>' : ""}<button type="button" id="save-verification">Save verification</button></section>` : ""}
    <section class="beneficiary-section"><div class="panel-head"><div><h2>Audit trail</h2><p>${numberFormat(session.audit.length)} actions recorded in this browser session</p></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Beneficiary</th><th>Project / activity</th><th>Details</th></tr></thead><tbody>${session.audit.slice(0, 50).map((entry) => `<tr><td>${escapeHtml(entry.at)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.beneficiary)}</td><td>${escapeHtml(entry.projectId)} / ${escapeHtml(entry.activityId)}</td><td>${escapeHtml(entry.detail)}</td></tr>`).join("") || '<tr><td colspan="5">No actions recorded</td></tr>'}</tbody></table></div></section>
  </div>`;

  drawBeneficiaryMap(root.querySelector("#beneficiary-map"), matches, boundaries, sites, (id) => {
    session.selectedId = id;
    rerender();
  });
  const message = (text) => { root.querySelector("#beneficiary-message").textContent = text; };
  root.querySelector("#beneficiary-file").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = assessBeneficiaries(parseBeneficiaryCsv(await file.text(), { projects, activities, boundaries, sourceName: file.name }));
      for (const record of imported) record.id = `${Date.now()}-${session.nextId++}`;
      session.records.push(...imported);
      session.selectedId = imported[0]?.id ?? session.selectedId;
      addAudit("List imported", null, `${file.name}: ${imported.length} rows`);
      rerender();
      message(`Imported ${numberFormat(imported.length)} records from ${file.name}.`);
    } catch (error) {
      message(error.message);
    }
    event.target.value = "";
  };
  root.querySelector("#beneficiary-template").onclick = () => downloadCsv("beneficiary-validation-template.csv", [], csvColumns);
  root.querySelector("#beneficiary-clear").onclick = () => {
    session.records = [];
    session.audit = [];
    session.evidenceFiles.clear();
    session.selectedId = null;
    rerender();
  };
  root.querySelector("#beneficiary-sample-method").onchange = (event) => {
    session.sampleMethod = event.target.value;
  };
  root.querySelector("#beneficiary-sample-rate").onchange = (event) => {
    session.rate = Math.max(1, Math.min(100, Number(event.target.value) || 10));
  };
  root.querySelector("#beneficiary-generate-sample").onclick = () => {
    for (const record of session.records) record.sampleSelected = false;
    const sample = selectVerificationSample(session.records, { percentage: session.rate, method: session.sampleMethod, projects });
    for (const record of sample) record.sampleSelected = true;
    addAudit("Sample generated", null, `${sample.length} records / ${session.sampleMethod} / ${session.rate}%`);
    rerender();
  };
  root.querySelector("#beneficiary-export").onclick = () => downloadCsv("beneficiary-validation-report.csv", all, [
    "beneficiaryId", "name", "gender", "age", "phone", "idNumber", "projectId", "activityId", "partner", "reportingPeriod", "state", "locality", "locationPrecision", "status", "completeness", "issues", "duplicateFlags", "sampleSelected", "followUp", "evidenceFileName",
  ].map((key) => key === "issues" || key === "duplicateFlags" ? key : key));
  root.querySelector("#beneficiary-audit-export").onclick = () => downloadCsv("beneficiary-validation-audit.csv", session.audit, ["at", "action", "recordId", "beneficiary", "projectId", "activityId", "detail"]);
  root.querySelector("#beneficiary-search").oninput = (event) => { session.filters.search = event.target.value; rerender(); };
  root.querySelector("#beneficiary-filter-project").onchange = (event) => { session.filters.project = event.target.value; rerender(); };
  root.querySelector("#beneficiary-filter-partner").onchange = (event) => { session.filters.partner = event.target.value; rerender(); };
  root.querySelector("#beneficiary-filter-status").onchange = (event) => { session.filters.status = event.target.value; rerender(); };
  root.querySelectorAll("[data-record-status]").forEach((select) => {
    select.onchange = () => {
      const record = session.records.find((item) => item.id === select.dataset.recordStatus);
      if (!record) return;
      const previous = record.status;
      record.status = select.value;
      addAudit("Status changed", record, `${previous} -> ${record.status}`);
      rerender();
    };
  });
  root.querySelectorAll("[data-review-record]").forEach((button) => {
    button.onclick = () => { session.selectedId = button.dataset.reviewRecord; rerender(); };
  });
  if (selected) {
    root.querySelector("#review-evidence-file").onchange = (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      session.evidenceFiles.set(selected.id, file);
      selected.evidenceFileName = file.name;
      addAudit("Evidence attached", selected, file.name);
      rerender();
    };
    root.querySelector("#download-review-evidence")?.addEventListener("click", () => {
      const file = session.evidenceFiles.get(selected.id);
      if (!file) return;
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    root.querySelector("#save-verification").onclick = () => {
      const record = session.records.find((item) => item.id === session.selectedId);
      if (!record) return;
      const previous = record.status;
      record.status = root.querySelector("#review-status").value;
      record.followUp = {
        modality: root.querySelector("#review-modality").value,
        participation: root.querySelector("#review-participation").value,
        serviceReceived: root.querySelector("#review-service").value,
        satisfaction: root.querySelector("#review-satisfaction").value,
        verificationDate: root.querySelector("#review-date").value,
        verificationLocation: root.querySelector("#review-location").value,
        evidence: root.querySelector("#review-evidence").value,
        notes: root.querySelector("#review-notes").value,
      };
      addAudit("Verification updated", record, `${previous} -> ${record.status}; ${record.followUp.modality}; participation ${record.followUp.participation}`);
      rerender();
    };
  }
}
