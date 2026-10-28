import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { normalizeAcledCsv, normalizeAcledRows } from "./acled.js";
import { renderBeneficiaryValidation } from "./beneficiary-validation.js";
import {
  buildLocalityAssessment,
  monthlyConflictSeries,
  riskCategory,
  summarizeStates,
} from "./vulnerability.js";
import {
  createIcons,
  LayoutDashboard,
  Map as MapIcon,
  ListChecks,
  ChartNoAxesCombined,
  Database,
  Download,
  Menu,
  SlidersHorizontal,
  RotateCcw,
  ArrowUpRight,
  ArrowLeft,
  Plus,
  Minus,
  Maximize,
  X,
  LogOut,
  FolderKanban,
  CircleCheck,
  Users,
  MapPin,
  ShieldAlert,
  Wallet,
  Lightbulb,
  CalendarDays,
  Search,
  ChevronRight,
  FileText,
} from "lucide";
import "./style.css";

const iconSet = {
  LayoutDashboard,
  Map: MapIcon,
  ListChecks,
  ChartNoAxesCombined,
  Database,
  Download,
  Menu,
  SlidersHorizontal,
  RotateCcw,
  ArrowUpRight,
  ArrowLeft,
  Plus,
  Minus,
  Maximize,
  X,
  LogOut,
  FolderKanban,
  CircleCheck,
  Users,
  MapPin,
  ShieldAlert,
  Wallet,
  Lightbulb,
  CalendarDays,
  Search,
  ChevronRight,
  FileText,
};
const icons = () => createIcons({ icons: iconSet });
const staticDeployment = import.meta.env.MODE === "static";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const fmt = d3.format(",");
const compact = d3.format(".3~s");
const pct = (value) =>
  value === null || value === undefined ? "N/A" : d3.format(".0%")(value);
const money = (value, currency) =>
  value == null ? "Not reported" : `${currency} ${compact(value)}`;
const colors = {
  "Water & sanitation": "#277fa4",
  "Food & livelihoods": "#69a663",
  Energy: "#d6ac3e",
  "Capacity building": "#aa8dba",
  Governance: "#cf7882",
  "Recovery & resilience": "#72939b",
  Health: "#bc6376",
  Education: "#b48c4f",
  Active: "#25876e",
  Completed: "#25876e",
  Planned: "#c4a345",
  Delayed: "#c66a6d",
  Unknown: "#90a09a",
  Red: "#bd4b51",
  Amber: "#c79b35",
  Green: "#24845f",
};
const state = {
  view: "overview",
  search: "",
  donor: "",
  region: "",
  locality: "",
  geographyLevel: "state",
  gisPanel: "monitoring",
  analysisMapMode: "vulnerability",
  conflictEvents: [],
  conflictSourceName: "",
  conflictError: "",
  conflictStart: "",
  conflictEnd: "",
  conflictRejections: 0,
  conflictLoading: false,
  conflictApiMeta: null,
  conflictApiMeta: null,
  sector: "",
  status: "",
  partner: "",
  type: "",
  period: "",
  project: "",
  more: false,
  mapMode: "sites",
  showProjectPoints: false,
  reference: "",
  trackerMode: "projects",
  sort: "risk",
  activityStatus: "",
  sourceIndex: 0,
  sourceSearch: "",
};
let model, boundaries, stateBoundaries, authSession;
const projectById = new Map();
const sourceCache = new Map();
const referenceCache = new Map();
let currentMapCleanup = () => {};
const headings = {
  overview: ["Executive Overview", "Recovery & resilience pillar | Sudan"],
  gis: [
    "Geospatial Intelligence",
    "Operational footprint and contextual needs",
  ],
  tracker: [
    "Project Tracker",
    "Implementation evidence, deliverables and reporting exceptions",
  ],
  analytics: [
    "Pillar Analytics",
    "Performance, resource allocation and delivery relationships",
  ],
  sources: [
    "Evidence & Sources",
    "Workbook register, source records and data quality",
  ],
  beneficiaries: [
    "Beneficiary Validation & Verification",
    "Beneficiary data quality, verification follow-up and partner reliability",
  ],
};
const badge = (text, title = "") =>
  `<span class="badge ${String(text).toLowerCase()}" title="${esc(title)}">${esc(text)}</span>`;

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function filtered() {
  const projects = model.projects.filter((project) => {
    if (state.project && project.id !== state.project) return false;
    if (
      state.search &&
      !`${project.id} ${project.name} ${project.donor} ${project.partners}`
        .toLowerCase()
        .includes(state.search.toLowerCase())
    )
      return false;
    if (state.donor && project.donor !== state.donor) return false;
    if (state.region && !project.states.includes(state.region)) return false;
    if (state.status && project.status !== state.status) return false;
    if (state.type && project.sourceType !== state.type) return false;
    if (
      state.partner &&
      ![
        project.partners,
        ...model.locations
          .filter((location) => location.projectId === project.id)
          .map((location) => location.partner),
      ].some((partner) => partner.includes(state.partner))
    )
      return false;
    if (state.period) {
      const [year, quarter] = state.period.split("-Q").map(Number);
      const start = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
      const end = new Date(Date.UTC(year, quarter * 3, 0))
        .toISOString()
        .slice(0, 10);
      if (
        !project.start ||
        !project.end ||
        project.start > end ||
        project.end < start
      )
        return false;
    }
    if (
      state.sector &&
      !model.activities.some(
        (activity) =>
          activity.projectId === project.id && activity.sector === state.sector,
      ) &&
      !model.sites.some(
        (site) => site.projectId === project.id && site.sector === state.sector,
      )
    )
      return false;
    if (
      state.locality &&
      !model.sites.some(
        (site) =>
          site.projectId === project.id && site.localityCode === state.locality,
      )
    )
      return false;
    return true;
  });
  const ids = new Set(projects.map((project) => project.id));
  const sites = model.sites
    .filter((site) => ids.has(site.projectId))
    .filter(
      (site) =>
        !state.region ||
        site.state === state.region ||
        site.boundaryState === state.region,
    )
    .filter((site) => !state.locality || site.localityCode === state.locality)
    .filter((site) => !state.sector || site.sector === state.sector);
  const activities = model.activities
    .filter((activity) => ids.has(activity.projectId))
    .filter((activity) => !state.sector || activity.sector === state.sector);
  return { projects, ids, sites, activities };
}

function options(values, selected, placeholder) {
  return `<option value="">${esc(placeholder)}</option>${values
    .map((value) => {
      const [key, label] = Array.isArray(value) ? value : [value, value];
      return `<option value="${esc(key)}" ${key === selected ? "selected" : ""}>${esc(label)}</option>`;
    })
    .join("")}`;
}
const unique = (values) =>
  [...new Set(values.filter(Boolean))].sort(d3.ascending);
function selectFilter(key, label, values, placeholder) {
  return `<div class="filter"><label for="filter-${key}">${label}</label><select id="filter-${key}" data-filter="${key}" class="${state[key] ? "is-active" : ""}">${options(values, state[key], placeholder)}</select></div>`;
}

function frame() {
  const [title, subtitle] = headings[state.view];
  const navItems = [
    ["overview", "Executive overview"],
    ["gis", "GIS monitoring"],
    ["tracker", "Project tracker"],
    ["beneficiaries", "Beneficiary verification"],
    ["analytics", "Pillar analytics"],
    ["sources", "Evidence & sources"],
  ];
  document.querySelector("#app").innerHTML = `
    <header class="topbar"><div class="brand"><img class="brandmark" src="/undp-logo-blue.svg" alt="United Nations Development Programme" width="60" height="122"><div><strong>Recovery & Resilience</strong><small>Sudan / Pillar Intelligence</small></div></div><nav class="header-nav" aria-label="Main navigation">${navItems.map(([view, label]) => `<button type="button" data-view="${view}" class="${state.view === view ? "active" : ""}" ${state.view === view ? 'aria-current="page"' : ""}>${label}</button>`).join("")}</nav><div class="header-actions">${authSession?.user ? `<div class="auth-account"><span>${esc(authSession.user.name)}</span><form method="post" action="/auth/logout"><input type="hidden" name="csrfToken" value="${esc(authSession.csrfToken)}"><button type="submit" class="signout-button" title="Sign out">${icon("log-out")}<span>Sign out</span></button></form></div>` : ""}</div></header>
    <div class="shell"><aside class="sidebar ${state.menuOpen ? "menu-open" : ""}"><p class="nav-label">Management workspace</p><nav class="nav" aria-label="Main navigation">${[
      ["overview", "layout-dashboard", "Executive overview"],
      ["gis", "map", "GIS monitoring"],
      ["tracker", "list-checks", "Project tracker"],
      ["beneficiaries", "users", "Beneficiary verification"],
      ["analytics", "chart-no-axes-combined", "Pillar analytics"],
      ["sources", "database", "Evidence & sources"],
    ]
      .map(
        ([view, name, label]) =>
          `<button data-view="${view}" class="${state.view === view ? "active" : ""}" ${state.view === view ? 'aria-current="page"' : ""}>${icon(name)}${label}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-footer"><strong>Sudan pillar overview</strong>${model.projects.length} project records<br>${new Set(model.inventory.map((sheet) => sheet.file)).size} source workbooks<br><br>Reporting cutoff<br><span class="number">${esc(model.asOf)}</span></div></aside>
    <main class="workspace"><div class="page-heading"><div class="hero-copy"><div class="eyebrow">Sudan / Recovery &amp; Resilience Pillar</div><h1>${title}</h1><p>${subtitle}</p></div><div class="page-actions"><span class="snapshot">PILLAR SNAPSHOT / ${model.asOf}</span></div></div>
    <section class="filters" aria-label="Pillar filters"><div class="filter"><label for="filter-search">Search pillar</label><input id="filter-search" type="search" class="${state.search ? "is-active" : ""}" placeholder="Project, donor or partner" value="${esc(state.search)}"></div>
    ${selectFilter("region", "Geography", unique(boundaries.features.map((feature) => feature.properties.state)), "All states")}
    ${selectFilter("donor", "Funding partner", unique(model.projects.map((project) => project.donor)), "All donors")}
    ${selectFilter("sector", "Sector", unique([...model.activities, ...model.sites].map((item) => item.sector)), "All sectors")}
    ${selectFilter("status", "Project status", ["Active", "Completed", "Planned", "Delayed", "Unknown"], "All statuses")}
    <div class="filter-buttons"><button id="more-filters" class="icon-button" title="Additional filters" aria-expanded="${state.more}">${icon("sliders-horizontal")}</button><button id="reset" class="icon-button" title="Reset all filters">${icon("rotate-ccw")}</button></div>
    ${
      state.more
        ? `<div class="filters-extra">${selectFilter(
            "locality",
            "Mapped locality",
            boundaries.features
              .filter(
                (feature) =>
                  !state.region || feature.properties.state === state.region,
              )
              .map((feature) => [
                feature.properties.hrpcode,
                `${feature.properties.loc_en} / ${feature.properties.state}`,
              ])
              .sort((a, b) => a[1].localeCompare(b[1])),
            "All localities",
          )}${selectFilter("partner", "Implementing partner", unique(model.locations.map((location) => location.partner)), "All partners")}${selectFilter("type", "Evidence type", ["Tracker", "Workplan"], "All types")}${selectFilter("period", "Award date overlap", ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4"], "All periods")}${selectFilter(
            "project",
            "Project",
            model.projects.map((project) => [project.id, project.id]),
            "All projects",
          )}</div>`
        : ""
    }</section>
    <div id="filter-summary" class="filter-summary" aria-live="polite"></div><div id="view-content"></div>
    <footer class="page-footer"><span>RECOVERY & RESILIENCE / MANAGEMENT INFORMATION</span><span>Source-backed snapshot. Derived indicators are not certified project closure or expenditure.</span></footer></main></div>`;
  document.querySelectorAll("[data-view]").forEach(
    (button) =>
      (button.onclick = () => {
        state.view = button.dataset.view;
        frame();
      }),
  );
  document.querySelectorAll("[data-filter]").forEach(
    (select) =>
      (select.onchange = () => {
        state[select.dataset.filter] = select.value;
        if (select.dataset.filter === "region") {
          state.locality = "";
          state.geographyLevel = "state";
        }
        frame();
      }),
  );
  let timer;
  document.querySelector("#filter-search").oninput = (event) => {
    state.search = event.target.value;
    event.target.classList.toggle("is-active", Boolean(state.search));
    clearTimeout(timer);
    timer = setTimeout(renderView, 160);
  };
  document.querySelector("#more-filters").onclick = () => {
    state.more = !state.more;
    frame();
  };
  document.querySelector("#reset").onclick = () => {
    for (const key of [
      "search",
      "donor",
      "region",
      "locality",
      "sector",
      "status",
      "partner",
      "type",
      "period",
      "project",
    ])
      state[key] = "";
    frame();
  };
  renderView();
}

function renderView() {
  currentMapCleanup();
  currentMapCleanup = () => {};
  hideTooltip();
  const data = filtered();
  document.querySelector("#filter-summary").innerHTML =
    `<span><strong>${data.projects.length} of ${model.projects.length}</strong> projects &nbsp;/&nbsp; ${fmt(data.activities.length)} activities &nbsp;/&nbsp; ${fmt(data.sites.length)} site observations</span><span>${state.region ? esc(state.region) : "Sudan"}${state.locality ? ` / ${esc(boundaries.features.find((feature) => feature.properties.hrpcode === state.locality)?.properties.loc_en)}` : ""}${state.period ? ` / award overlap ${state.period}` : ""}</span>`;
  const views = {
    overview,
    gis,
    tracker,
    beneficiaries: () =>
      renderBeneficiaryValidation(document.querySelector("#view-content"), {
        projects: model.projects,
        activities: model.activities,
        sites: model.sites,
        boundaries: boundaries.features,
      }),
    analytics,
    sources,
  };
  views[state.view](data);
  icons();
  bindProjectLinks();
}
function panel(title, subtitle, id, extra = "") {
  return `<section class="panel"><div class="panel-head"><div><h2>${title}</h2><p>${subtitle}</p></div>${extra}</div><div class="panel-body"><div id="${id}" class="chart"></div></div></section>`;
}
function bindProjectLinks() {
  document
    .querySelectorAll("[data-project]")
    .forEach(
      (button) => (button.onclick = () => showProject(button.dataset.project)),
    );
}
function svgChart(id, width = 520, height = 260) {
  const root = d3.select(`#${id}`);
  root.selectAll("*").remove();
  return root
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr(
      "aria-label",
      root.node()?.closest(".panel")?.querySelector("h2")?.textContent || id,
    );
}
function emptyChart(
  id,
  message = "No comparable records in the current selection",
) {
  d3.select(`#${id}`).html(`<div class="chart-empty">${esc(message)}</div>`);
}
function showTooltip(event, text) {
  const tip = document.querySelector("#tooltip");
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = `${Math.max(8, Math.min(event.clientX + 14, innerWidth - 310))}px`;
  tip.style.top = `${Math.max(8, Math.min(event.clientY + 10, innerHeight - tip.offsetHeight - 10))}px`;
}
function hideTooltip() {
  document.querySelector("#tooltip").hidden = true;
}
function interactive(selection, describe, action) {
  selection
    .attr("tabindex", 0)
    .attr("role", action ? "button" : "img")
    .attr("aria-label", describe)
    .on("pointermove", (event, datum) => showTooltip(event, describe(datum)))
    .on("pointerleave", hideTooltip);
  if (action)
    selection
      .on("click", (event, datum) => {
        hideTooltip();
        action(datum);
      })
      .on("keydown", (event, datum) => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          action(datum);
        }
      });
}
function filterProject(id) {
  state.project = state.project === id ? "" : id;
  frame();
}

function footprintControls() {
  const stateCounts = d3.rollup(
    model.sites.filter((site) => site.boundaryState),
    (sites) => sites.length,
    (site) => site.boundaryState,
  );
  const localityCounts = d3.rollup(
    model.sites.filter((site) => site.localityCode),
    (sites) => sites.length,
    (site) => site.localityCode,
  );
  const states = unique(
    boundaries.features.map((feature) => feature.properties.state),
  )
    .map((name) => [
      name,
      `${name} (${fmt(stateCounts.get(name) ?? 0)} observations)`,
    ])
    .sort(
      (a, b) =>
        d3.descending(stateCounts.get(a[0]) ?? 0, stateCounts.get(b[0]) ?? 0) ||
        d3.ascending(a[0], b[0]),
    );
  const localities = state.region
    ? boundaries.features
        .filter((feature) => feature.properties.state === state.region)
        .map((feature) => [
          feature.properties.hrpcode,
          `${feature.properties.loc_en} (${fmt(localityCounts.get(feature.properties.hrpcode) ?? 0)} observations)`,
        ])
        .sort((a, b) => {
          const countA = localityCounts.get(a[0]) ?? 0;
          const countB = localityCounts.get(b[0]) ?? 0;
          return d3.descending(countA, countB) || d3.ascending(a[1], b[1]);
        })
    : [];
  return `<div class="footprint-controls" aria-label="Choose operational geography"><div class="segmented footprint-level" role="group" aria-label="Administrative level"><button type="button" data-footprint-level="state" class="${state.geographyLevel === "state" ? "active" : ""}" aria-pressed="${state.geographyLevel === "state"}">State</button><button type="button" data-footprint-level="locality" class="${state.geographyLevel === "locality" ? "active" : ""}" aria-pressed="${state.geographyLevel === "locality"}">Locality</button></div><label for="footprint-state">State<select id="footprint-state">${options(states, state.region, "All states")}</select></label><label for="footprint-locality">Locality<select id="footprint-locality" ${state.region && state.geographyLevel === "locality" ? "" : "disabled"}>${options(localities, state.locality, state.region ? "All localities" : "Select a state first")}</select></label><button id="footprint-reset" ${!state.region ? "disabled" : ""}>Sudan-wide</button></div>`;
}

function overview(data) {
  const mapped = data.sites.filter((site) => site.coordinates);
  const statesCovered = new Set(
    mapped.map((site) => site.boundaryState || site.state).filter(Boolean),
  ).size;
  const localitiesCovered = new Set(
    mapped.map((site) => site.localityCode).filter(Boolean),
  ).size;
  const reach = d3.sum(
    data.sites.filter(
      (site) => site.beneficiaryUnit === "people (source estimate)",
    ),
    (site) => site.beneficiaries ?? 0,
  );
  const budgets = d3.rollups(
    data.projects.filter((project) => project.budget !== null),
    (group) => d3.sum(group, (project) => project.budget),
    (project) => project.currency,
  );
  const red = data.projects.filter((project) => project.rag === "Red");
  const active = data.projects.filter(
    (project) => project.status === "Active",
  ).length;
  const kpis = [
    [
      "Pillar projects",
      fmt(data.projects.length),
      "Project / award records",
      "folder-kanban",
    ],
    [
      "Active projects",
      fmt(active),
      `${data.projects.filter((project) => project.status === "Completed").length} activity-complete / ${data.projects.filter((project) => project.status === "Planned").length} planned`,
      "circle-check",
    ],
    [
      "Award allocation",
      budgets.find(([key]) => key === "USD")
        ? money(budgets.find(([key]) => key === "USD")[1], "USD")
        : "N/A",
      budgets
        .filter(([key]) => key !== "USD")
        .map(([currency, value]) => money(value, currency))
        .join(" + ") || "Other currencies not reported",
      "wallet",
    ],
    [
      "Est. service reach",
      reach ? compact(reach) : "N/A",
      "Non-unique people; site estimates",
      "users",
    ],
    [
      "States covered",
      fmt(statesCovered),
      "States with mapped project observations",
      "map",
    ],
    [
      "Localities covered",
      fmt(localitiesCovered),
      "Localities with mapped project observations",
      "map-pin",
    ],
    [
      "Closure exceptions",
      fmt(red.length),
      `${data.projects.filter((project) => project.rag === "Amber").length} reporting-watch projects`,
      "shield-alert",
    ],
  ];
  document.querySelector("#view-content").innerHTML =
    `<section class="kpis" aria-label="Executive scorecards">${kpis.map(([label, value, note, name], index) => `<article class="kpi"><div class="kpi-label">${label}${icon(name)}</div><div class="kpi-value ${index === 5 ? "danger" : ""}">${value}</div><div class="kpi-note">${esc(note)}</div></article>`).join("")}</section>
    <div class="grid-main"><section class="panel"><div class="panel-head footprint-head"><div><h2>Operational footprint</h2><p>Project observations & administrative boundaries</p></div>${footprintControls()}</div><div id="overview-map"></div></section><div class="right-stack">${panel("Implementation scorecard", "Measured activity actual / target index", "progress-chart", '<span class="tag">SOURCE EVIDENCE</span>')}<section class="panel"><div class="panel-head"><div><h2>Management attention</h2><p>Priority follow-up from current evidence</p></div><span class="tag">${red.length} CLOSURE</span></div><div id="alerts" class="alert-list"></div></section></div></div>
    <div class="section-heading"><h2>Pillar watchlist</h2><small>Derived status / evidence-based exceptions</small></div>${projectTable(
      data.projects
        .slice()
        .sort((a, b) => riskOrder(a) - riskOrder(b))
        .slice(0, 6),
    )}
    <div class="insight-band">${icon("lightbulb")}<div><strong>${red.length ? "Prioritize closure verification and refreshed delivery evidence" : "Prioritize evidence completeness before expanding investment"}</strong><p>${red.length} award end dates have passed without complete extracted activity evidence. ${data.projects.filter((project) => project.progress === null).length} projects lack a comparable numeric delivery index; ${data.sites.length - mapped.length} site observations lack valid coordinates. Request signed closure reports, a verified spend ledger and updated site registers.</p></div></div>
    <p class="footnote">Award allocation is not expenditure. Service estimates may overlap across sites and projects. Activity-complete is not certified project closure. Numeric dollar formats are grouped as USD pending finance confirmation.</p>`;
  drawMap("overview-map", data, false);
  document.querySelector("#footprint-state").onchange = (event) => {
    state.region = event.target.value;
    state.locality = "";
    frame();
  };
  document.querySelectorAll("[data-footprint-level]").forEach((button) => {
    button.onclick = () => {
      state.geographyLevel = button.dataset.footprintLevel;
      if (state.geographyLevel === "state") state.locality = "";
      frame();
    };
  });
  document.querySelector("#footprint-locality").onchange = (event) => {
    state.locality = event.target.value;
    frame();
  };
  document.querySelector("#footprint-reset").onclick = () => {
    state.region = "";
    state.locality = "";
    state.geographyLevel = "state";
    frame();
  };
  drawProgress("progress-chart", data.projects);
  drawAlerts(data.projects);
}
const riskOrder = (project) => ({ Red: 0, Amber: 1, Green: 2 })[project.rag];
function drawAlerts(projects) {
  const selected = projects
    .slice()
    .sort((a, b) => riskOrder(a) - riskOrder(b))
    .slice(0, 3);
  document.querySelector("#alerts").innerHTML = selected.length
    ? selected
        .map(
          (project) =>
            `<div class="alert ${project.rag === "Red" ? "red" : ""}"><span class="marker"></span><div><strong>${esc(project.id)} / ${esc(project.alerts[0] || "Delivery evidence current")}</strong><p>${project.end ? `Award end: ${project.end}. ` : ""}${project.progress === null ? "Numeric delivery evidence incomplete." : "Validate activity evidence and closure documentation."}</p></div><button data-project="${project.id}" title="Open ${project.id}">${icon("arrow-up-right")}</button></div>`,
        )
        .join("")
    : '<div class="empty">No selected projects</div>';
}
function drawProgress(id, projects) {
  if (!projects.length) return emptyChart(id);
  const values = projects
    .slice()
    .sort((a, b) => d3.descending(a.progress ?? -1, b.progress ?? -1));
  const width = 460,
    height = Math.max(205, values.length * 23 + 22);
  const svg = svgChart(id, width, height);
  const x = d3.scaleLinear([0, 1], [95, width - 45]);
  const y = d3
    .scaleBand(
      values.map((project) => project.id),
      [8, height - 10],
    )
    .padding(0.55);
  svg
    .selectAll(".track")
    .data(values)
    .join("rect")
    .attr("x", 95)
    .attr("y", (project) => y(project.id))
    .attr("width", width - 140)
    .attr("height", y.bandwidth())
    .attr("rx", 2)
    .attr("fill", "#eef2ef");
  const bars = svg
    .selectAll(".bar")
    .data(values)
    .join("rect")
    .attr("x", 95)
    .attr("y", (project) => y(project.id))
    .attr("width", (project) => Math.max(0, x(project.progress ?? 0) - 95))
    .attr("height", y.bandwidth())
    .attr("rx", 2)
    .attr("fill", (project) =>
      project.progress === null
        ? "#d2dcd6"
        : project.rag === "Red"
          ? "#c9a858"
          : "#429679",
    );
  interactive(
    bars,
    (project) =>
      `${project.id}: ${pct(project.progress)} from ${project.measuredActivities}/${project.activityCount} comparable activities`,
    (project) => filterProject(project.id),
  );
  svg
    .selectAll(".label")
    .data(values)
    .join("text")
    .attr("x", 0)
    .attr("y", (project) => y(project.id) + y.bandwidth() / 2 + 3)
    .text((project) => project.id);
  svg
    .selectAll(".value")
    .data(values)
    .join("text")
    .attr("x", width - 32)
    .attr("y", (project) => y(project.id) + y.bandwidth() / 2 + 3)
    .text((project) => pct(project.progress));
}
function projectTable(projects) {
  return `<div class="table-wrap"><table><thead><tr><th>Project / award</th><th>Status</th><th>Award allocation</th><th>Activity index</th><th>End date</th><th>RAG</th><th></th></tr></thead><tbody>${projects.map((project) => `<tr><td><button data-project="${project.id}" class="project-link">${esc(project.id)}</button><div class="project-name" title="${esc(project.name)}">${esc(project.name)}</div></td><td>${badge(project.status, project.statusBasis)}</td><td class="number">${esc(money(project.budget, project.currency))}</td><td><div class="progress-cell"><svg class="progress-svg" viewBox="0 0 65 5" aria-label="${pct(project.progress)}"><rect width="65" height="5" rx="2" fill="#e9efea"/><rect width="${65 * (project.progress ?? 0)}" height="5" rx="2" fill="#5a9a7a"/></svg><span class="number">${pct(project.progress)}</span></div></td><td class="number">${project.end ?? "Not reported"}</td><td>${badge(project.rag, project.alerts.join("; "))}</td><td><button data-project="${project.id}" class="icon-button" title="Open ${project.id}">${icon("arrow-up-right")}</button></td></tr>`).join("") || '<tr><td colspan="7">No matching projects. Reset filters to widen the selection.</td></tr>'}</tbody></table></div>`;
}

function gisPanelTabs() {
  return `<div class="gis-panel-tabs" role="tablist" aria-label="GIS workspace"><button type="button" role="tab" data-gis-panel="monitoring" aria-selected="${state.gisPanel === "monitoring"}" class="${state.gisPanel === "monitoring" ? "active" : ""}">GIS Monitoring</button><button type="button" role="tab" data-gis-panel="analysis" aria-selected="${state.gisPanel === "analysis"}" class="${state.gisPanel === "analysis" ? "active" : ""}">Analysis & Vulnerability</button></div>`;
}

function bindGisPanelTabs() {
  document.querySelectorAll("[data-gis-panel]").forEach((button) => {
    button.onclick = () => {
      state.gisPanel = button.dataset.gisPanel;
      renderView();
    };
  });
}

function gis(data) {
  if (state.gisPanel === "analysis") return vulnerabilityAnalysis(data);
  const displaySites = data.sites
    .slice()
    .sort(
      (a, b) =>
        Number(b.origin === "Evidence-based water projects register") -
        Number(a.origin === "Evidence-based water projects register"),
    );
  document.querySelector("#view-content").innerHTML =
    `<div class="view-intro"><span>${fmt(data.sites.filter((site) => site.coordinates).length)} mapped observations / ${fmt(data.sites.filter((site) => !site.coordinates).length)} excluded without coordinates</span><span>${new Set(data.sites.map((site) => site.localityCode).filter(Boolean)).size} observed localities</span></div><div class="water-register-summary"><strong>New water-project register</strong><span>${fmt(model.waterRegister.rows)} source rows</span><span>${fmt(model.waterRegister.mapped)} mapped / ${fmt(model.waterRegister.unmapped)} without coordinates</span><span>Maps: ${fmt(model.waterRegister.mapProvided)} / BOQs: ${fmt(model.waterRegister.boqReceived)}</span><small>Register status tracks mapping and documentation readiness; it is not project implementation status.</small></div><section class="panel"><div class="map-controls"><div class="segmented" aria-label="Map display">${[
      ["sites", "Sites"],
      ["clusters", "Clusters"],
      ["density", "Service density"],
      ["needs", "Contextual needs"],
      ["activities", "Project outputs"],
    ]
      .map(
        ([key, label]) =>
          `<button data-map-mode="${key}" class="${state.mapMode === key ? "active" : ""}" aria-pressed="${state.mapMode === key}">${label}</button>`,
      )
      .join(
        "",
      )}</div><label>Reference layer <select id="reference-layer">${options([["Education", "Schools / local reference"], ["Health", "Health facilities"], ...model.externalLayers.map((layer, index) => [`external-${index}`, layer.file.split("/").at(-1)])], state.reference, "None")}</select></label></div><div id="gis-map"></div></section><div class="analytics-grid" style="margin-top:20px">${panel("Regional intervention comparison", "Mapped observations by source / boundary state", "regional-chart")}${panel("Coverage & needs screening", "High-severity context with low mapped project presence", "gap-chart")}</div><div class="section-heading"><h2>Site register</h2><small>Source observations, not unique facilities</small></div><div class="table-wrap"><table><thead><tr><th>Site / locality</th><th>Project</th><th>Sector</th><th>Coordinates</th><th>Service estimate</th><th>Status</th></tr></thead><tbody>${
      displaySites
        .map(
          (site) =>
            `<tr><td><button class="project-link" data-site="${site.id}">${esc(site.name)}</button><div class="project-name">${esc(site.state)} / ${esc(site.locality)}</div></td><td>${esc(site.projectId ?? "Unlinked")}</td><td>${esc(site.sector)}</td><td class="number">${site.coordinates ? site.coordinates.map((value) => value.toFixed(5)).join(", ") : "Not mapped"}</td><td>${site.beneficiaries === null ? "Not reported" : `${fmt(site.beneficiaries)} ${site.beneficiaryUnit.includes("household") ? "HH" : "est. people"}`}</td><td>${badge(site.registerStatus || site.status, site.registerStatus ? "Source register status; not necessarily implementation status" : "")}${site.registerStatus ? `<div class="project-name">Implementation: ${esc(site.status)}</div>` : ""}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="6">No matching site observations</td></tr>'
    }</tbody></table></div><p class="footnote">Showing all ${fmt(displaySites.length)} rows in current filters. Rows without valid coordinates remain in the register but are not drawn on the map. Site estimates are not unique people. Density uses source population estimates with mixed reference years. Cluster counts indicate spatial concentration, not statistical significance. Context: ${esc(model.humanitarianSources.displacement)}; ${esc(model.humanitarianSources.needs)}.</p>`;
  document
    .querySelector("#view-content")
    .insertAdjacentHTML("afterbegin", gisPanelTabs());
  if (!['Education', 'Health'].includes(state.reference)) state.reference = '';
  document.querySelector("#reference-layer").innerHTML = options(
    [
      ["Education", "Schools / local reference"],
      ["Health", "Health facilities"],
    ],
    state.reference,
    "None",
  );
  document.querySelector("#view-content .analytics-grid")?.remove();
  const siteRegisterHeading = [...document.querySelectorAll(".section-heading")]
    .find((heading) => heading.textContent.includes("Site register"));
  if (siteRegisterHeading) {
    const registerTable = siteRegisterHeading.nextElementSibling;
    const registerNote = registerTable?.nextElementSibling;
    siteRegisterHeading.remove();
    registerTable?.remove();
    registerNote?.remove();
  }
  if (["density", "needs", "activities"].includes(state.mapMode)) {
    document
      .querySelector("#reference-layer")
      .closest("label")
      .insertAdjacentHTML(
        "afterend",
        `<label class="checkbox-label"><input id="show-project-points" type="checkbox" ${state.showProjectPoints ? "checked" : ""}>Show project points</label>`,
      );
  }
  document.querySelectorAll("[data-map-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        state.mapMode = button.dataset.mapMode;
        state.showProjectPoints = false;
        renderView();
      }),
  );
  document.querySelector("#reference-layer").onchange = (event) => {
    state.reference = event.target.value;
    renderView();
  };
  document.querySelector("#show-project-points")?.addEventListener("change", (event) => {
    state.showProjectPoints = event.target.checked;
    renderView();
  });
  document
    .querySelectorAll("[data-site]")
    .forEach(
      (button) => (button.onclick = () => showSite(button.dataset.site)),
    );
  bindGisPanelTabs();
  drawMap("gis-map", data, true);
}

function vulnerabilityAnalysis(data) {
  const inPeriod = state.conflictEvents.filter(
    (event) =>
      (!state.conflictStart || event.date >= state.conflictStart) &&
      (!state.conflictEnd || event.date <= state.conflictEnd) &&
      (!state.region || event.state === state.region) &&
      (!state.locality || event.localityCode === state.locality),
  );
  const acledLoaded = state.conflictEvents.length > 0;
  const conflictAvailable = state.conflictEvents.some(
    (event) => event.localityCode,
  );
  const assessments = buildLocalityAssessment(
    boundaries.features,
    data.sites,
    inPeriod,
    conflictAvailable,
  );
  const localities = assessments.filter(
    (item) =>
      (!state.region || item.state === state.region) &&
      (!state.locality || item.code === state.locality),
  );
  const mappedEvents = inPeriod.filter((event) => event.localityCode);
  const totalIdps = d3.sum(localities, (item) => item.idps ?? 0);
  const totalReturnees = d3.sum(localities, (item) => item.returnees ?? 0);
  const highRisk = localities.filter((item) =>
    ["Very High", "High"].includes(item.category),
  );
  const gapAreas = highRisk
    .filter((item) => item.projectSites === 0)
    .sort((a, b) => d3.descending(a.score, b.score));
  const increasingAreas = increasingConflictAreas(inPeriod);
  const sources = `${model.humanitarianSources.displacement} / ${model.humanitarianSources.needs}`;

  document.querySelector("#view-content").innerHTML =
    `${gisPanelTabs()}<div class="analysis-heading"><div><div class="eyebrow">Sudan / Humanitarian intelligence</div><h2>Analysis &amp; Vulnerability Assessment</h2><p>Locality-level exposure, displacement and intervention coverage.</p></div><span class="analysis-source">Needs & movement snapshot: 30 Jul 2026</span></div>
    <div class="analysis-toolbar"><div class="analysis-upload"><label for="acled-upload">ACLED event export (CSV)</label><input id="acled-upload" type="file" accept=".csv,text/csv"><span>${state.conflictSourceName ? esc(state.conflictSourceName) : "No conflict event file loaded"}</span></div><div class="analysis-period"><label>Event date range <input id="conflict-start" type="date" value="${esc(state.conflictStart)}"></label><label>to <input id="conflict-end" type="date" value="${esc(state.conflictEnd)}"></label><button type="button" id="clear-conflict-period">Reset dates</button></div></div>
    <div class="analysis-callout ${conflictAvailable ? "available" : "provisional"}" role="status">${!acledLoaded ? "<strong>Provisional assessment — ACLED conflict events are not loaded.</strong><span>Conflict intensity and trend layers are unavailable. Index categories use available displacement, needs and mapped project coverage only. Accessibility data is also unavailable. Fetch from the ACLED API or import an authorized CSV.</span>" : conflictAvailable ? `<strong>ACLED loaded: ${fmt(state.conflictEvents.length)} rows / ${fmt(inPeriod.length)} in current filters / ${fmt(mappedEvents.length)} locality-matched</strong><span>${fmt(inPeriod.length - mappedEvents.length)} selected events lack locality matching; ${fmt(state.conflictRejections)} malformed rows were skipped. Source: ${esc(state.conflictSourceName)}.</span>` : `<strong>ACLED loaded: ${fmt(state.conflictEvents.length)} rows, but none match a locality.</strong><span>Conflict events are not included in the mapped vulnerability index. Check event coordinates and admin1/admin2 names.</span>`}${state.conflictApiMeta ? `<span>${state.conflictApiMeta.lastUpdateHours != null ? `ACLED last update: ${state.conflictApiMeta.lastUpdateHours} hours before fetch.` : `Snapshot date: ${esc(state.conflictApiMeta.snapshotDate ?? state.conflictApiMeta.end)}.`} ${fmt(state.conflictApiMeta.pages)} ${state.conflictSourceName.startsWith("ACLED API") ? "API page(s)" : "snapshot source file"}${state.conflictApiMeta.truncated ? "; 50,000-event server cap reached; narrow the date range" : ""}.</span>` : ""}${state.conflictError ? `<span class="analysis-error">${esc(state.conflictError)}</span>` : ""}</div>
    <section class="kpis analysis-kpis"><article class="kpi"><div class="kpi-label">Conflict incidents</div><div class="kpi-value">${acledLoaded ? fmt(inPeriod.length) : "N/A"}</div><div class="kpi-note">${conflictAvailable ? `${fmt(mappedEvents.length)} matched to locality` : acledLoaded ? "No localities matched" : "ACLED CSV required"}</div></article><article class="kpi"><div class="kpi-label">IDPs</div><div class="kpi-value">${fmt(totalIdps)}</div><div class="kpi-note">IOM DTM snapshot / locality sum</div></article><article class="kpi"><div class="kpi-label">Returnees</div><div class="kpi-value">${fmt(totalReturnees)}</div><div class="kpi-note">IOM DTM snapshot / locality sum</div></article><article class="kpi"><div class="kpi-label">High / very high</div><div class="kpi-value">${fmt(highRisk.length)}</div><div class="kpi-note">${fmt(gapAreas.length)} with no mapped project site</div></article></section>
    <section class="panel analysis-map-panel"><div class="panel-head"><div><h2>Humanitarian vulnerability &amp; exposure</h2><p>${state.geographyLevel === "locality" ? "Locality" : "State"} boundaries / click a boundary to drill down</p></div><div class="analysis-map-controls"><label class="analysis-layer">Map layer<select id="analysis-map-mode">${options(
      [
        ["vulnerability", "Vulnerability index"],
        ["conflict", "Conflict exposure"],
        ["idps", "IDP concentration"],
        ["returnees", "Returnee concentration"],
        ["projects", "Project presence"],
      ],
      state.analysisMapMode,
      "Select map layer",
    )}</select></label><div class="segmented" role="group" aria-label="Administrative boundary level"><button type="button" data-analysis-level="state" class="${state.geographyLevel === "state" ? "active" : ""}" aria-pressed="${state.geographyLevel === "state"}">State</button><button type="button" data-analysis-level="locality" class="${state.geographyLevel === "locality" ? "active" : ""}" aria-pressed="${state.geographyLevel === "locality"}">Locality</button></div></div></div><div id="analysis-map"></div></section>
    <div class="analytics-grid analysis-charts">${panel("Conflict events over time", "Monthly ACLED incidents and fatality estimates / source date", "conflict-trend")}${panel("Conflict event types", "Incident counts in selected period and geography", "conflict-types")}${panel("Displacement by state", "IOM DTM snapshot / IDPs and returnees shown separately", "movement-chart")}${panel("Priority coverage gaps", "Higher provisional vulnerability with no mapped project site", "priority-gaps")}</div>
    <div class="insight-band analysis-insights">${icon("lightbulb")}<div><strong>Decision support</strong><p>${
      gapAreas.length
        ? `${gapAreas
            .slice(0, 3)
            .map((item) => `${esc(item.locality)} (${item.state})`)
            .join(
              ", ",
            )} combine elevated available indicators with no mapped site. Validate partner presence and access before prioritizing expansion.`
        : "No high/very-high assessed locality is currently identified without mapped site presence in the selected geography."
    } ${
      conflictAvailable
        ? increasingAreas.length
          ? `Conflict events increased in the recent 90-day window in ${increasingAreas
              .slice(0, 3)
              .map((item) => `${esc(item.locality)}, ${item.state}`)
              .join("; ")}.`
          : "No locality meets the increasing-conflict screen, or the imported date range is too short for comparison."
        : "Increasing security-risk trends require date-stamped, locality-matched ACLED data."
    }</p></div></div>
    <div class="section-heading"><h2>Administrative vulnerability summary</h2><small>Site observations are not unique projects or beneficiaries</small></div><div id="vulnerability-table" class="table-wrap"></div><p class="footnote">${esc(sources)}. Displacement is a single snapshot, not a movement time series. The partial index is a screening aid, not a validated humanitarian severity model; ${conflictAvailable ? "accessibility constraints are excluded because no dataset is supplied." : "conflict and accessibility dimensions are excluded until locality-matched source data is available."} State totals sum locality figures; beneficiary categories may overlap.</p>`;

  bindGisPanelTabs();
  const acledApiEnabled = !import.meta.env.DEV && !staticDeployment;
  const fetchAcledButton = document.createElement("button");
  fetchAcledButton.type = "button";
  fetchAcledButton.id = "fetch-acled-api";
  fetchAcledButton.className = "fetch-acled-button";
  fetchAcledButton.disabled = !acledApiEnabled || state.conflictLoading;
  fetchAcledButton.title = staticDeployment
    ? "Direct ACLED API access is unavailable in the static site; import an authorized CSV."
    : import.meta.env.DEV
      ? "Use npm run dev:sso to test the authenticated ACLED API proxy."
      : "Fetch Sudan conflict events through the authenticated server-side ACLED API proxy.";
  fetchAcledButton.textContent = state.conflictLoading
    ? "Fetching ACLED…"
    : staticDeployment
      ? "ACLED API (server required)"
      : !acledApiEnabled
      ? "ACLED API (SSO server required)"
      : "Fetch from ACLED API";
  document.querySelector(".analysis-upload").prepend(fetchAcledButton);
  fetchAcledButton.onclick = async () => {
    if (!acledApiEnabled || state.conflictLoading) return;
    const end = state.conflictEnd || model.asOf;
    const start = state.conflictStart || d3.utcFormat("%Y-%m-%d")(
      d3.utcDay.offset(new Date(`${end}T00:00:00Z`), -364),
    );
    state.conflictStart = start;
    state.conflictEnd = end;
    state.conflictLoading = true;
    state.conflictError = "";
    renderView();
    try {
      const query = new URLSearchParams({ start, end });
      const response = await fetch(`/api/acled/events?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(result?.error || `ACLED API request failed (${response.status}).`);
      const normalized = normalizeAcledRows(result.events ?? [], boundaries.features);
      state.conflictEvents = normalized.events;
      state.conflictSourceName = `ACLED API / ${result.start} to ${result.end}`;
      state.conflictRejections = normalized.rejected;
      state.conflictApiMeta = result;
    } catch (error) {
      state.conflictError = error.message;
    } finally {
      state.conflictLoading = false;
      renderView();
    }
  };
  document.querySelector("#analysis-map-mode").onchange = (event) => {
    state.analysisMapMode = event.target.value;
    renderView();
  };
  document.querySelectorAll("[data-analysis-level]").forEach((button) => {
    button.onclick = () => {
      state.geographyLevel = button.dataset.analysisLevel;
      if (state.geographyLevel === "state") state.locality = "";
      renderView();
    };
  });
  document.querySelector("#conflict-start").onchange = (event) => {
    state.conflictStart = event.target.value;
    renderView();
  };
  document.querySelector("#conflict-end").onchange = (event) => {
    state.conflictEnd = event.target.value;
    renderView();
  };
  document.querySelector("#clear-conflict-period").onclick = () => {
    state.conflictStart = "";
    state.conflictEnd = "";
    renderView();
  };
  document.querySelector("#acled-upload").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("ACLED CSV exceeds the 50 MB local import limit.");
      const result = normalizeAcledCsv(await file.text(), boundaries.features);
      state.conflictEvents = result.events;
      state.conflictSourceName = file.name;
      state.conflictRejections = result.rejected;
      state.conflictApiMeta = null;
      state.conflictError = "";
    } catch (error) {
      state.conflictEvents = [];
      state.conflictSourceName = "";
      state.conflictApiMeta = null;
      state.conflictError = error.message;
    }
    renderView();
  };
  drawVulnerabilityMap("analysis-map", data, localities, inPeriod);
  drawConflictTimeline("conflict-trend", inPeriod, acledLoaded);
  drawConflictTypes("conflict-types", inPeriod);
  drawMovementChart("movement-chart", summarizeStates(localities));
  drawPriorityGaps("priority-gaps", gapAreas);
  renderVulnerabilityTable(
    "vulnerability-table",
    localities,
    conflictAvailable,
  );
}

function increasingConflictAreas(events) {
  if (!events.length) return [];
  const latest = d3.max(events, (event) => new Date(`${event.date}T00:00:00Z`));
  const recentStart = d3.utcDay.offset(latest, -90);
  const previousStart = d3.utcDay.offset(latest, -180);
  const recent = d3.rollup(
    events.filter(
      (event) =>
        new Date(`${event.date}T00:00:00Z`) > recentStart && event.localityCode,
    ),
    (rows) => rows.length,
    (event) => event.localityCode,
  );
  const previous = d3.rollup(
    events.filter((event) => {
      const date = new Date(`${event.date}T00:00:00Z`);
      return date > previousStart && date <= recentStart && event.localityCode;
    }),
    (rows) => rows.length,
    (event) => event.localityCode,
  );
  return [...recent]
    .filter(
      ([code, count]) => count >= 3 && count > (previous.get(code) ?? 0) * 1.2,
    )
    .map(([code, recentCount]) => {
      const feature = boundaries.features.find(
        (item) => item.properties.hrpcode === code,
      );
      return feature
        ? {
            locality: feature.properties.loc_en,
            state: feature.properties.state,
            recent: recentCount,
            previous: previous.get(code) ?? 0,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) =>
      d3.descending(a.recent - a.previous, b.recent - b.previous),
    );
}

function drawVulnerabilityMap(id, data, localities, events) {
  const width = 900;
  const height = 560;
  const localityLayer = state.geographyLevel === "locality";
  const features = state.locality
    ? boundaries.features.filter(
        (feature) => feature.properties.hrpcode === state.locality,
      )
    : localityLayer
      ? boundaries.features.filter(
          (feature) =>
            !state.region || feature.properties.state === state.region,
        )
      : stateBoundaries.features.filter(
          (feature) =>
            !state.region || feature.properties.state === state.region,
        );
  const rows = localityLayer ? localities : summarizeStates(localities);
  const rowByArea = new Map(
    rows.map((row) => [localityLayer ? row.code : row.state, row]),
  );
  const valuesForMode = rows.map((row) => {
    if (state.analysisMapMode === "conflict") return row.conflictEvents;
    if (state.analysisMapMode === "idps") return row.idpRate ?? 0;
    if (state.analysisMapMode === "returnees") return row.returneeRate ?? 0;
    if (state.analysisMapMode === "projects") return row.projectSites;
    return row.score ?? 0;
  });
  const maxValue = d3.max(valuesForMode) || 1;
  const interpolate =
    state.analysisMapMode === "conflict"
      ? d3.interpolateReds
      : state.analysisMapMode === "idps" ||
          state.analysisMapMode === "returnees"
        ? d3.interpolateYlOrBr
        : d3.interpolateBlues;
  const projection = d3.geoMercator().fitExtent(
    [
      [28, 28],
      [width - 28, height - 28],
    ],
    {
      type: "FeatureCollection",
      features: features.length ? features : stateBoundaries.features,
    },
  );
  const path = d3.geoPath(projection);
  const root = d3.select(`#${id}`);
  const scope = state.locality
    ? boundaries.features.find(
        (feature) => feature.properties.hrpcode === state.locality,
      )?.properties.loc_en
    : state.region || "Sudan";
  root.html(
    `<div class="map-wrap large"><div class="map-status">${localityLayer ? "LOCALITY BOUNDARIES" : "STATE BOUNDARIES"} / ${esc(scope)} &nbsp; | &nbsp; ${fmt(data.sites.filter((site) => site.coordinates).length)} sites${events.length ? ` / ${fmt(events.length)} conflict events` : ""}</div><div class="map-watermark">${state.analysisMapMode === "vulnerability" ? "PROVISIONAL / LOCALITY INDICATORS" : esc(state.analysisMapMode.toUpperCase())}</div></div><div class="analysis-map-legend">${
      state.analysisMapMode === "vulnerability"
        ? [
            ["Very High", "#a9273d"],
            ["High", "#de7051"],
            ["Medium", "#e8bb55"],
            ["Low", "#4c9c79"],
            ["No data", "#e6e9eb"],
          ]
            .map(
              ([label, color]) =>
                `<span><i class="legend-dot" style="background:${color}"></i>${label}</span>`,
            )
            .join("")
        : `<span>Relative ${esc(state.analysisMapMode)} intensity</span><span>Blue project dots show mapped intervention sites</span>`
    }<span>Gray indicates unavailable data</span></div>`,
  );
  const wrap = root.select(".map-wrap");
  const svg = wrap
    .insert("svg", ":first-child")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr(
      "aria-label",
      `${localityLayer ? "Locality" : "State"} vulnerability and project exposure map`,
    );
  const map = svg.append("g");
  const areas = map
    .append("g")
    .selectAll("path")
    .data(features)
    .join("path")
    .attr("class", "analysis-boundary")
    .attr("d", path)
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.9)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("fill", (feature) => {
      const key = localityLayer
        ? feature.properties.hrpcode
        : feature.properties.state;
      const row = rowByArea.get(key);
      if (!row) return "#e6e9eb";
      if (state.analysisMapMode === "vulnerability") {
        return (
          {
            "Very High": "#a9273d",
            High: "#de7051",
            Medium: "#e8bb55",
            Low: "#4c9c79",
          }[row.category] ?? "#e6e9eb"
        );
      }
      const value = localityLayer
        ? (row[
            state.analysisMapMode === "conflict"
              ? "conflictEvents"
              : state.analysisMapMode === "idps"
                ? "idpRate"
                : state.analysisMapMode === "returnees"
                  ? "returneeRate"
                  : "projectSites"
          ] ?? 0)
        : (valuesForMode.find((_, index) => rows[index].state === key) ?? 0);
      if (state.analysisMapMode === "conflict" && !events.length)
        return "#e6e9eb";
      return value ? interpolate(0.15 + (0.75 * value) / maxValue) : "#e6e9eb";
    });
  interactive(
    areas,
    (feature) => {
      const key = localityLayer
        ? feature.properties.hrpcode
        : feature.properties.state;
      const row = rowByArea.get(key);
      if (!row)
        return `${feature.properties.loc_en ?? feature.properties.state}: no linked assessment data`;
      return localityLayer
        ? `${row.locality}, ${row.state}: ${row.category}; ${fmt(row.conflictEvents)} events; ${fmt(row.idps ?? 0)} IDPs; ${fmt(row.projectSites)} mapped sites`
        : `${row.state}: ${row.category}; ${fmt(row.conflictEvents)} events; ${fmt(row.idps ?? 0)} IDPs; ${fmt(row.projectSites)} mapped sites`;
    },
    (feature) => {
      if (localityLayer) {
        state.region = feature.properties.state;
        state.locality =
          state.locality === feature.properties.hrpcode
            ? ""
            : feature.properties.hrpcode;
        state.geographyLevel = "locality";
      } else {
        state.region = feature.properties.state;
        state.locality = "";
        state.geographyLevel = "locality";
      }
      renderView();
    },
  );
  map
    .insert("path", ":first-child")
    .datum(d3.geoGraticule10())
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#b5ccc0")
    .attr("opacity", 0.22)
    .attr("stroke-width", 0.5)
    .attr("pointer-events", "none");
  const projectPoints = data.sites
    .filter((site) => site.coordinates)
    .map((site) => ({ ...site, point: projection(site.coordinates) }));
  map
    .append("g")
    .selectAll("circle.project-point")
    .data(projectPoints)
    .join("circle")
    .attr("class", "project-point")
    .attr("cx", (site) => site.point[0])
    .attr("cy", (site) => site.point[1])
    .attr("r", 3)
    .attr("fill", "#126eab")
    .attr("stroke", "white")
    .attr("stroke-width", 0.8)
    .attr("opacity", 0.8);
  const conflictPoints = events
    .filter((event) => event.coordinates)
    .map((event) => ({ ...event, point: projection(event.coordinates) }));
  if (state.analysisMapMode === "conflict") {
    const dots = map
      .append("g")
      .selectAll("circle.conflict-point")
      .data(conflictPoints)
      .join("circle")
      .attr("class", "conflict-point")
      .attr("cx", (event) => event.point[0])
      .attr("cy", (event) => event.point[1])
      .attr("r", (event) => Math.min(8, 3 + Math.sqrt(event.fatalities ?? 0)))
      .attr("fill", "#9f1d36")
      .attr("stroke", "white")
      .attr("stroke-width", 0.8)
      .attr("opacity", 0.82);
    interactive(
      dots,
      (event) =>
        `${event.date}: ${event.type}; ${event.fatalities} fatalities; ${event.locality || "locality not matched"}`,
    );
  }
  const zoom = d3
    .zoom()
    .scaleExtent([1, 24])
    .on("zoom", (event) => map.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
}

function drawConflictTimeline(id, events, acledLoaded) {
  if (!events.length)
    return emptyChart(
      id,
      acledLoaded
        ? "No ACLED events in the selected date/geography filters."
        : "No ACLED events loaded. Import an authorized event CSV to view monthly incident and fatality trends.",
    );
  const values = monthlyConflictSeries(events);
  const width = 560,
    height = 280;
  const svg = svgChart(id, width, height);
  const x = d3.scaleUtc(
    d3.extent(values, (value) => value.month),
    [48, width - 26],
  );
  const y = d3
    .scaleLinear(
      [0, d3.max(values, (value) => value.incidents) || 1],
      [height - 40, 20],
    )
    .nice();
  const fatalityScale = d3
    .scaleLinear(
      [0, d3.max(values, (value) => value.fatalities) || 1],
      [height - 40, 20],
    )
    .nice();
  svg
    .append("g")
    .attr("transform", `translate(0,${height - 40})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.utcFormat("%b %y")));
  svg
    .append("g")
    .attr("transform", "translate(48,0)")
    .call(d3.axisLeft(y).ticks(4));
  svg
    .append("g")
    .attr("transform", `translate(${width - 26},0)`)
    .call(d3.axisRight(fatalityScale).ticks(4));
  svg
    .selectAll("rect.incidents")
    .data(values)
    .join("rect")
    .attr("class", "incidents")
    .attr("x", (value) => x(value.month) - 4)
    .attr("y", (value) => y(value.incidents))
    .attr("width", 8)
    .attr("height", (value) => y(0) - y(value.incidents))
    .attr("fill", "#cf765c");
  const line = d3
    .line()
    .x((value) => x(value.month))
    .y((value) => fatalityScale(value.fatalities));
  svg
    .append("path")
    .datum(values)
    .attr("d", line)
    .attr("fill", "none")
    .attr("stroke", "#a43c4c")
    .attr("stroke-width", 2);
  const points = svg
    .selectAll("circle")
    .data(values)
    .join("circle")
    .attr("cx", (value) => x(value.month))
    .attr("cy", (value) => fatalityScale(value.fatalities))
    .attr("r", 3)
    .attr("fill", "#a43c4c");
  interactive(
    points,
    (value) =>
      `${d3.utcFormat("%B %Y")(value.month)}: ${value.incidents} incidents, ${value.fatalities} estimated fatalities`,
  );
}

function drawConflictTypes(id, events) {
  if (!events.length)
    return emptyChart(id, "Conflict event type breakdown requires ACLED data.");
  const values = d3
    .rollups(
      events,
      (rows) => rows.length,
      (event) => event.type,
    )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 8);
  horizontalBars(id, values, "conflict events");
}

function drawMovementChart(id, states) {
  const values = states
    .filter((row) => row.idps || row.returnees)
    .sort((a, b) =>
      d3.descending(
        (a.idps ?? 0) + (a.returnees ?? 0),
        (b.idps ?? 0) + (b.returnees ?? 0),
      ),
    )
    .slice(0, 8);
  if (!values.length)
    return emptyChart(id, "No displacement snapshot values in this geography.");
  const width = 560,
    height = Math.max(230, values.length * 30 + 35);
  const svg = svgChart(id, width, height);
  const max =
    d3.max(values, (row) => Math.max(row.idps ?? 0, row.returnees ?? 0)) || 1;
  const x = d3.scaleLinear([0, max], [115, width - 30]);
  const y = d3
    .scaleBand(
      values.map((row) => row.state),
      [12, height - 24],
    )
    .padding(0.2);
  svg
    .selectAll("text.state-label")
    .data(values)
    .join("text")
    .attr("class", "state-label")
    .attr("x", 0)
    .attr("y", (row) => y(row.state) + y.bandwidth() / 2 + 3)
    .text((row) => row.state);
  const bars = values.flatMap((row) => [
    { ...row, kind: "IDPs", value: row.idps ?? 0, offset: 0 },
    {
      ...row,
      kind: "Returnees",
      value: row.returnees ?? 0,
      offset: y.bandwidth() / 2,
    },
  ]);
  const rects = svg
    .selectAll("rect")
    .data(bars)
    .join("rect")
    .attr("x", 115)
    .attr("y", (row) => y(row.state) + row.offset)
    .attr("width", (row) => Math.max(0, x(row.value) - 115))
    .attr("height", y.bandwidth() / 2 - 2)
    .attr("fill", (row) => (row.kind === "IDPs" ? "#3f88b6" : "#d49a4d"));
  interactive(rects, (row) => `${row.state} ${row.kind}: ${fmt(row.value)}`);
  svg
    .append("text")
    .attr("x", 118)
    .attr("y", height - 4)
    .attr("fill", "#3f88b6")
    .text("IDPs");
  svg
    .append("text")
    .attr("x", 162)
    .attr("y", height - 4)
    .attr("fill", "#d49a4d")
    .text("Returnees");
}

function drawPriorityGaps(id, rows) {
  if (!rows.length)
    return emptyChart(
      id,
      "No high-vulnerability localities without mapped project sites in this selection.",
    );
  const selected = rows.slice(0, 8);
  const svg = svgChart(id, 560, Math.max(190, selected.length * 28 + 20));
  const groups = svg
    .selectAll("g")
    .data(selected)
    .join("g")
    .attr("transform", (_, index) => `translate(0,${index * 28 + 14})`);
  groups
    .append("circle")
    .attr("cx", 6)
    .attr("cy", 0)
    .attr("r", 4)
    .attr("fill", (row) =>
      row.category === "Very High" ? "#a9273d" : "#de7051",
    );
  groups
    .append("text")
    .attr("x", 18)
    .attr("y", 4)
    .text((row) => `${row.locality} / ${row.state}`);
  groups
    .append("text")
    .attr("x", 550)
    .attr("y", 4)
    .attr("text-anchor", "end")
    .text((row) => `${row.category} · ${pct(row.score)}`);
  interactive(
    groups,
    (row) =>
      `${row.locality}, ${row.state}: ${row.category} provisional vulnerability; no mapped project site`,
    (row) => {
      state.region = row.state;
      state.locality = row.code;
      state.geographyLevel = "locality";
      renderView();
    },
  );
}

function renderVulnerabilityTable(id, rows, conflictAvailable) {
  const sorted = rows
    .slice()
    .sort((a, b) => d3.descending(a.score ?? -1, b.score ?? -1));
  document.querySelector(`#${id}`).innerHTML =
    `<table><thead><tr><th>Locality / state</th><th>Index</th><th>Severity</th><th>IDPs</th><th>Returnees</th><th>ACLED events</th><th>Fatalities</th><th>Mapped sites</th></tr></thead><tbody>${
      sorted
        .slice(0, 100)
        .map(
          (row) =>
            `<tr><td><button type="button" class="project-link" data-assessment-locality="${esc(row.code)}">${esc(row.locality)}</button><div class="project-name">${esc(row.state)}</div></td><td>${badge(row.category, row.scoreBasis)}<div class="project-name">${pct(row.score)}</div></td><td>${row.severity ?? "N/A"}${row.severity !== null ? "/5" : ""}</td><td class="number">${row.idps === null ? "N/A" : fmt(row.idps)}</td><td class="number">${row.returnees === null ? "N/A" : fmt(row.returnees)}</td><td class="number">${conflictAvailable ? fmt(row.conflictEvents) : "N/A"}</td><td class="number">${conflictAvailable ? fmt(row.fatalities) : "N/A"}</td><td class="number">${fmt(row.projectSites)}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="8">No locality records in this selection</td></tr>'
    }</tbody></table><p class="footnote">Showing ${Math.min(sorted.length, 100)} of ${sorted.length} administrative units.</p>`;
  document.querySelectorAll("[data-assessment-locality]").forEach((button) => {
    button.onclick = () => {
      const feature = boundaries.features.find(
        (item) => item.properties.hrpcode === button.dataset.assessmentLocality,
      );
      if (!feature) return;
      state.region = feature.properties.state;
      state.locality = feature.properties.hrpcode;
      state.geographyLevel = "locality";
      renderView();
    };
  });
}

function drawMap(id, data, large) {
  const width = 900,
    height = large ? 620 : 450;
  const root = d3.select(`#${id}`);
  const selectedLocality = state.locality
    ? boundaries.features.find(
        (feature) => feature.properties.hrpcode === state.locality,
      )?.properties.loc_en
    : null;
  const mapScope = state.locality
    ? `LOCALITY / ${selectedLocality}`
    : state.geographyLevel === "locality"
      ? `LOCALITIES / ${state.region || "Sudan"}`
      : state.region
        ? `STATE / ${state.region}`
        : "STATES / Sudan";
  const mode = large ? state.mapMode : "sites";
  const mappedPointCount = data.sites.filter((site) => site.coordinates).length;
  const pointsVisible = mode === "sites" || mode === "clusters" || state.showProjectPoints;
  const coordinateCounts = d3.rollup(
    data.sites.filter((site) => site.coordinates),
    (sites) => sites.length,
    (site) => site.coordinates.map((coordinate) => coordinate.toFixed(5)).join(","),
  );
  const hasCoLocatedSites = [...coordinateCounts.values()].some((count) => count > 1);
  const mapLegend =
    mode === "activities"
      ? `<span><i class="legend-dot" style="background:#d12800"></i>Lower activity index</span><span><i class="legend-dot" style="background:#006eb5"></i>Higher activity index</span><span>Gray: no numeric output</span><span>Project-level, not site-level results</span>${hasCoLocatedSites ? "<span>Co-located markers are offset visually; source coordinates are unchanged</span>" : ""}`
      : `${Object.entries(colors)
          .filter(([key]) =>
            ["Water & sanitation", "Food & livelihoods", "Energy"].includes(key),
          )
          .map(
            ([key, color]) =>
              `<span><i class="legend-dot" style="background:${color}"></i>${key}</span>`,
          )
          .join("")}<span>Gray: no mapped observation</span>${hasCoLocatedSites ? "<span>Co-located markers are offset visually; source coordinates are unchanged</span>" : ""}`;
  root.html(
    `<div class="map-wrap ${large ? "large" : ""}"><div class="map-status">${esc(mapScope)} &nbsp; | &nbsp; ${pointsVisible ? `${mappedPointCount} points` : `${mappedPointCount} project points hidden`}</div><div class="map-tools"><button class="icon-button" data-zoom="in" title="Zoom in">${icon("plus")}</button><button class="icon-button" data-zoom="out" title="Zoom out">${icon("minus")}</button><button class="icon-button" data-zoom="reset" title="Fit selected extent">${icon("maximize")}</button></div><div class="map-watermark">WGS84 / ADMINISTRATIVE REFERENCE</div></div><div class="map-legend">${mapLegend}</div>`,
  );
  if (["density", "needs", "activities"].includes(mode))
    root
      .select(".map-legend")
      .append("span")
      .text(state.showProjectPoints ? "Project point overlay enabled" : "Project points hidden");
  const wrap = root.select(".map-wrap");
  const svg = wrap
    .insert("svg", ":first-child")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr(
      "aria-label",
      "Interactive Sudan map with administrative boundaries and project sites",
    );
  const mapGroup = svg.append("g");
  const localityLayer = state.geographyLevel === "locality";
  const boundaryFeatures = state.locality
    ? boundaries.features.filter(
        (feature) => feature.properties.hrpcode === state.locality,
      )
    : localityLayer
      ? boundaries.features.filter(
          (feature) =>
            !state.region || feature.properties.state === state.region,
        )
      : stateBoundaries.features.filter(
          (feature) =>
            !state.region || feature.properties.state === state.region,
        );
  const projection = d3.geoMercator().fitExtent(
    [
      [24, 25],
      [width - 24, height - 24],
    ],
    {
      type: "FeatureCollection",
      features: boundaryFeatures.length
        ? boundaryFeatures
        : stateBoundaries.features,
    },
  );
  const path = d3.geoPath(projection);
  const counts = d3.rollup(
    data.sites.filter((site) => site.coordinates),
    (sites) => sites.length,
    (site) => site.localityCode,
  );
  const reach = d3.rollup(
    data.sites.filter(
      (site) => site.beneficiaryUnit === "people (source estimate)",
    ),
    (sites) => d3.sum(sites, (site) => site.beneficiaries ?? 0),
    (site) => site.localityCode,
  );
  const stateCounts = d3.rollup(
    data.sites.filter((site) => site.coordinates),
    (sites) => sites.length,
    (site) => site.boundaryState || site.state,
  );
  const stateReach = d3.rollup(
    data.sites.filter(
      (site) =>
        site.beneficiaryUnit === "people (source estimate)" &&
        (site.boundaryState || site.state),
    ),
    (sites) => d3.sum(sites, (site) => site.beneficiaries ?? 0),
    (site) => site.boundaryState || site.state,
  );
  const projectsByArea = d3.rollups(
    data.sites.filter(
      (site) =>
        site.coordinates &&
        site.projectId &&
        (localityLayer ? site.localityCode : site.boundaryState || site.state),
    ),
    (sites) => {
      const projects = [
        ...new Set(sites.map((site) => site.projectId)),
      ].map((projectId) => projectById.get(projectId)).filter(Boolean);
      const measured = projects.filter((project) => project.progress !== null);
      return {
        projectCount: projects.length,
        progress: d3.mean(measured, (project) => project.progress) ?? null,
        measuredActivities: d3.sum(projects, (project) => project.measuredActivities ?? 0),
        activityCount: d3.sum(projects, (project) => project.activityCount ?? 0),
      };
    },
    (site) => localityLayer ? site.localityCode : site.boundaryState || site.state,
  );
  const activitySummaryByArea = new Map(projectsByArea);
  const maxCount =
    d3.max(localityLayer ? [...counts.values()] : [...stateCounts.values()]) ||
    1;
  const color = d3
    .scaleSequential(d3.interpolateRgb("#e5eee6", "#45876d"))
    .domain([0, maxCount]);
  const featureFill = (feature) => {
    const code = feature.properties.hrpcode;
    const key = localityLayer ? code : feature.properties.state;
    if (mode === "activities") {
      const summary = activitySummaryByArea.get(key);
      return summary?.progress == null
        ? "#e6e9eb"
        : d3.interpolateRgb("#d12800", "#006eb5")(summary.progress);
    }
    if (mode === "needs") {
      const severity = localityLayer
        ? feature.properties.needs?.severity
        : d3.max(
            boundaries.features
              .filter((locality) => locality.properties.state === key)
              .map((locality) => locality.properties.needs?.severity)
              .filter(Number.isFinite),
          );
      return severity ? d3.interpolateYlOrRd(severity / 6) : "#eef2ee";
    }
    if (mode === "density") {
      const population = localityLayer
        ? feature.properties.population
        : d3.sum(
            boundaries.features.filter(
              (locality) => locality.properties.state === key,
            ),
            (locality) => locality.properties.population ?? 0,
          );
      const value =
        (((localityLayer ? reach.get(code) : stateReach.get(key)) || 0) /
          (population || Infinity)) *
        1000;
      return value
        ? d3.interpolateYlGnBu(Math.min(1, value / 1000))
        : "#edf1ee";
    }
    const count = localityLayer ? counts.get(code) : stateCounts.get(key);
    return count ? color(count) : "#e4ebe5";
  };
  const shapes = mapGroup
    .append("g")
    .selectAll("path")
    .data(boundaryFeatures)
    .join("path")
    .classed("map-boundary", true)
    .attr("d", path)
    .attr("fill", featureFill)
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.65)
    .attr("vector-effect", "non-scaling-stroke");
  interactive(
    shapes,
    (feature) => {
      const area = localityLayer
        ? feature.properties.hrpcode
        : feature.properties.state;
      if (mode === "activities") {
        const summary = activitySummaryByArea.get(area);
        return summary
          ? `${feature.properties.loc_en ?? area}: ${summary.projectCount} mapped projects; ${summary.measuredActivities} of ${summary.activityCount} activities have numeric outputs; mean project activity index ${pct(summary.progress)}. Project-level, not site-level results.`
          : `${feature.properties.loc_en ?? area}: no mapped project output data`;
      }
      return localityLayer
        ? `${feature.properties.loc_en}, ${feature.properties.state}: ${counts.get(feature.properties.hrpcode) || 0} mapped observations${mode === "needs" ? `; contextual severity ${feature.properties.needs?.severity ?? "not reported"}` : ""}${mode === "density" ? `; ${d3.format(".1f")(((reach.get(feature.properties.hrpcode) || 0) / (feature.properties.population || Infinity)) * 1000)} estimated service instances / 1,000 source population` : ""}`
        : `${feature.properties.state}: ${stateCounts.get(feature.properties.state) || 0} mapped observations`;
    },
    (feature) => {
      state.region = feature.properties.state;
      if (localityLayer) {
        state.locality =
          state.locality === feature.properties.hrpcode
            ? ""
            : feature.properties.hrpcode;
        state.geographyLevel = "locality";
      } else {
        state.locality = "";
        state.geographyLevel = "state";
      }
      frame();
    },
  );
  const graticule = mapGroup
    .insert("path", ":first-child")
    .datum(d3.geoGraticule10())
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#b5ccc0")
    .attr("opacity", 0.25)
    .attr("stroke-width", 0.5);
  graticule.attr("pointer-events", "none");
  const stateGroups = d3.groups(
    boundaries.features,
    (feature) => feature.properties.state,
  );
  mapGroup
    .append("g")
    .attr("pointer-events", "none")
    .selectAll("text")
    .data(
      stateGroups.filter(([name]) => !state.region || name === state.region),
    )
    .join("text")
    .attr(
      "transform",
      ([, features]) =>
        `translate(${projection(d3.geoCentroid({ type: "FeatureCollection", features }))})`,
    )
    .attr("text-anchor", "middle")
    .attr("font-family", "DM Sans")
    .attr("font-size", state.region ? 12 : 10)
    .attr("font-weight", 600)
    .attr("fill", "#6f897a")
    .attr("stroke", "#edf3ed")
    .attr("stroke-width", 2.5)
    .attr("paint-order", "stroke")
    .text(([name]) => name.toUpperCase());
  const referenceGroup = mapGroup.append("g");
  const pointGroup = mapGroup.append("g");
  let transform = d3.zoomIdentity;
  const points = data.sites
    .filter((site) => site.coordinates)
    .map((site) => ({ ...site, xy: projection(site.coordinates) }));
  for (const group of d3.group(
    points,
    (point) => point.coordinates.map((coordinate) => coordinate.toFixed(5)).join(","),
  ).values()) {
    if (group.length < 2) continue;
    group.forEach((point, index) => {
      const ring = Math.floor(index / 8);
      const ringIndex = index % 8;
      const ringCount = Math.min(8, group.length - ring * 8);
      const angle = (2 * Math.PI * ringIndex) / ringCount + ring * 0.2;
      const radius = 10 + ring * 6;
      point.displayOffset = [Math.cos(angle) * radius, Math.sin(angle) * radius];
      point.coincidentCount = group.length;
    });
  }
  function plot() {
    pointGroup.selectAll("*").remove();
    if (mode === "clusters") {
      const clusters = d3
        .groups(
          points,
          (point) =>
            `${Math.floor(transform.apply(point.xy)[0] / 44)},${Math.floor(transform.apply(point.xy)[1] / 44)}`,
        )
        .map(([, members]) => ({
          members,
          xy: [
            d3.mean(members, (point) => point.xy[0]),
            d3.mean(members, (point) => point.xy[1]),
          ],
        }));
      const groups = pointGroup
        .selectAll("g")
        .data(clusters)
        .join("g")
        .attr("transform", (cluster) => `translate(${cluster.xy})`);
      groups
        .append("circle")
        .attr(
          "r",
          (cluster) =>
            (cluster.members.length === 1
              ? 5
              : Math.min(24, 9 + Math.sqrt(cluster.members.length) * 2)) /
            transform.k,
        )
        .attr("fill", "#147b68")
        .attr("fill-opacity", 0.82)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5 / transform.k);
      groups
        .filter((cluster) => cluster.members.length > 1)
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", ".35em")
        .attr("font-size", 11 / transform.k)
        .attr("fill", "white")
        .text((cluster) => cluster.members.length);
      interactive(
        groups,
        (cluster) =>
          `${cluster.members.length} site observations in this screen-grid cluster`,
        (cluster) => {
          if (cluster.members.length === 1) showSite(cluster.members[0].id);
          else
            svg
              .transition()
              .duration(350)
              .call(
                zoom.transform,
                d3.zoomIdentity
                  .translate(width / 2, height / 2)
                  .scale(Math.min(32, transform.k * 2))
                  .translate(-cluster.xy[0], -cluster.xy[1]),
              );
        },
      );
    } else if (mode === "sites" || state.showProjectPoints) {
      const circles = pointGroup
        .selectAll("circle")
        .data(points)
        .join("circle")
        .attr("data-site", (point) => point.id)
        .attr(
          "cx",
          (point) => point.xy[0] + (point.displayOffset?.[0] ?? 0) / transform.k,
        )
        .attr(
          "cy",
          (point) => point.xy[1] + (point.displayOffset?.[1] ?? 0) / transform.k,
        )
        .attr("r", (point) => (mode === "activities" ? 5.5 : 4) / transform.k)
        .attr("fill", (point) => {
          if (mode !== "activities") return colors[point.sector] || "#819a8e";
          const progress = projectById.get(point.projectId)?.progress;
          return progress == null
            ? "#9099a1"
            : d3.interpolateRgb("#d12800", "#006eb5")(
                Math.max(0, Math.min(1, progress)),
              );
        })
        .attr("stroke", "#fff")
        .attr("stroke-width", 1 / transform.k)
        .attr("fill-opacity", 0.9);
      interactive(
        circles,
        (point) => {
          if (mode !== "activities")
            return `${point.projectId}: ${point.name}. ${point.beneficiaries === null ? "Beneficiaries not reported" : `${fmt(point.beneficiaries)} ${point.beneficiaryUnit}`}${point.coincidentCount ? ` Co-located with ${point.coincidentCount - 1} other mapped observation(s); displayed offset, source coordinate unchanged.` : ""}`;
          const project = projectById.get(point.projectId);
          return project
            ? `${point.projectId}: ${project.name}; ${project.measuredActivities} of ${project.activityCount} activities have numeric outputs; project activity index ${pct(project.progress)}. This is project-level evidence, not a result assigned to this site.`
            : `${point.projectId}: ${point.name}; no linked project activity data.`;
        },
        (point) =>
          mode === "activities" && point.projectId
            ? showProject(point.projectId)
            : showSite(point.id),
      );
    }
  }
  const zoom = d3
    .zoom()
    .scaleExtent([1, 40])
    .on("zoom", (event) => {
      transform = event.transform;
      mapGroup.attr("transform", transform);
      plot();
      referenceGroup.selectAll("circle").attr("r", 2 / transform.k);
    });
  svg.call(zoom).on("dblclick.zoom", null);
  plot();
  wrap.selectAll("[data-zoom]").on("click", function () {
    const direction = this.dataset.zoom;
    if (direction === "reset")
      svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
    else
      svg
        .transition()
        .duration(250)
        .call(zoom.scaleBy, direction === "in" ? 1.65 : 0.6);
  });
  let disposed = false;
  currentMapCleanup = () => {
    disposed = true;
    svg.on(".zoom", null);
  };
  if (large && state.reference) {
    const key = state.reference;
    const load = async () => {
      let references;
      if (key.startsWith("external-")) {
        const index = Number(key.split("-")[1]);
        if (!referenceCache.has(key))
          referenceCache.set(
            key,
            await json(`/data/reference/${index}.geojson`),
          );
        references = referenceCache.get(key).features.map((feature) => ({
          coordinates:
            feature.geometry?.type === "Point"
              ? feature.geometry.coordinates
              : referenceCentroid(feature),
          name:
            feature.properties?.name ||
            feature.properties?.name_en ||
            "Reference feature",
        }));
      } else
        references = model.references.filter(
          (reference) => reference.type === key,
        );
      if (disposed) return;
      const visible = references
        .filter((reference) => reference.coordinates?.every(Number.isFinite))
        .filter((reference) => {
          const point = projection(reference.coordinates);
          return (
            point[0] >= 0 &&
            point[0] <= width &&
            point[1] >= 0 &&
            point[1] <= height
          );
        });
      const circles = referenceGroup
        .selectAll("circle")
        .data(visible.slice(0, 7000))
        .join("circle")
        .attr("cx", (reference) => projection(reference.coordinates)[0])
        .attr("cy", (reference) => projection(reference.coordinates)[1])
        .attr("r", 2 / transform.k)
        .attr("fill", key === "Health" ? "#b35879" : "#7f75a4")
        .attr("opacity", 0.65);
      interactive(
        circles,
        (reference) =>
          `${reference.name} / reference point or feature centroid; not project evidence`,
      );
      root
        .select(".map-status")
        .text(
          `${visible.length} reference features in extent${visible.length > 7000 ? " / display capped at 7,000" : ""}`,
        );
    };
    load().catch((error) => {
      if (!disposed)
        root
          .select(".map-status")
          .text(`Reference layer unavailable: ${error.message}`);
    });
  }
}

function referenceCentroid(feature) {
  if (
    feature.geometry?.type.includes("Polygon") &&
    d3.geoArea(feature) > 2 * Math.PI
  ) {
    const working = structuredClone(feature);
    const polygons =
      working.geometry.type === "Polygon"
        ? [working.geometry.coordinates]
        : working.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) ring.reverse();
    return d3.geoCentroid(working);
  }
  return d3.geoCentroid(feature);
}

function drawRegional(id, data) {
  const values = d3
    .rollups(
      data.sites.filter((site) => site.coordinates),
      (sites) => sites.length,
      (site) => site.boundaryState || site.state,
    )
    .sort((a, b) => b[1] - a[1]);
  if (!values.length) return emptyChart(id);
  horizontalBars(id, values, "mapped observations", (region) => {
    state.region = region;
    state.locality = "";
    frame();
  });
}
function horizontalBars(id, values, unit, action) {
  const width = 530,
    height = Math.max(230, values.length * 31 + 15),
    svg = svgChart(id, width, height);
  const x = d3.scaleLinear(
    [0, d3.max(values, (value) => value[1]) || 1],
    [125, width - 45],
  );
  const y = d3
    .scaleBand(
      values.map((value) => value[0]),
      [8, height - 20],
    )
    .padding(0.48);
  const bars = svg
    .selectAll("rect")
    .data(values)
    .join("rect")
    .attr("x", 125)
    .attr("y", (value) => y(value[0]))
    .attr("width", (value) => x(value[1]) - 125)
    .attr("height", y.bandwidth())
    .attr("fill", "#61a185")
    .attr("rx", 2);
  interactive(
    bars,
    (value) => `${value[0]}: ${fmt(value[1])} ${unit}`,
    action ? (value) => action(value[0]) : null,
  );
  svg
    .selectAll(".name")
    .data(values)
    .join("text")
    .attr("x", 0)
    .attr("y", (value) => y(value[0]) + y.bandwidth() / 2 + 3)
    .text((value) =>
      value[0].length > 19 ? value[0].slice(0, 18) + "..." : value[0],
    );
  svg
    .selectAll(".n")
    .data(values)
    .join("text")
    .attr("x", (value) => x(value[1]) + 7)
    .attr("y", (value) => y(value[0]) + y.bandwidth() / 2 + 3)
    .text((value) => compact(value[1]));
}
function drawGaps(id, data) {
  const counts = d3.rollup(
    data.sites,
    (sites) => sites.length,
    (site) => site.localityCode,
  );
  const candidates = boundaries.features
    .filter((feature) => feature.properties.needs?.severity >= 4)
    .filter(
      (feature) => !state.region || feature.properties.state === state.region,
    )
    .map((feature) => ({
      feature,
      count: counts.get(feature.properties.hrpcode) || 0,
    }))
    .sort((a, b) => a.count - b.count)
    .slice(0, 7);
  if (!candidates.length)
    return emptyChart(
      id,
      "No high-severity contextual records for this geography",
    );
  const svg = svgChart(id, 530, 255);
  const groups = svg
    .selectAll("g")
    .data(candidates)
    .join("g")
    .attr("transform", (_, index) => `translate(0,${index * 33 + 15})`);
  groups
    .append("circle")
    .attr("cx", 7)
    .attr("cy", 0)
    .attr("r", 4)
    .attr("fill", "#ce9554");
  groups
    .append("text")
    .attr("x", 19)
    .attr("y", 4)
    .text(
      (value) =>
        `${value.feature.properties.loc_en} / ${value.feature.properties.state}`,
    );
  groups
    .append("text")
    .attr("x", 518)
    .attr("y", 4)
    .attr("text-anchor", "end")
    .text(
      (value) =>
        `${value.count} sites | severity ${value.feature.properties.needs.severity}`,
    );
  interactive(
    groups,
    (value) =>
      `${value.feature.properties.loc_en}: ${value.count} selected site observations. Contextual severity ${value.feature.properties.needs.severity}; absence of mapped records does not prove lack of services.`,
    (value) => {
      state.region = value.feature.properties.state;
      state.locality = value.feature.properties.hrpcode;
      frame();
    },
  );
}

function tracker(data) {
  const sorted = data.projects
    .slice()
    .sort((a, b) =>
      state.sort === "risk"
        ? riskOrder(a) - riskOrder(b)
        : state.sort === "end"
          ? d3.ascending(a.end || "9999", b.end || "9999")
          : d3.ascending(a.id, b.id),
    );
  document.querySelector("#view-content").innerHTML =
    `<div class="tracker-toolbar"><div class="segmented">${[
      ["projects", "Project register"],
      ["activities", "Activities & deliverables"],
      ["timeline", "Award timeline"],
      ["milestones", "Milestones & deadlines"],
      ["indicators", "Monitoring KPIs"],
      ["risks", "Risks & issues"],
    ]
      .map(
        ([key, label]) =>
          `<button data-tracker-mode="${key}" class="${state.trackerMode === key ? "active" : ""}">${label}</button>`,
      )
      .join(
        "",
      )}</div><label for="tracker-sort">Order</label><select id="tracker-sort">${options(
      [
        ["risk", "RAG priority"],
        ["end", "End date"],
        ["name", "Project ID"],
      ],
      state.sort,
      "Select order",
    )}</select></div><div class="status-strip">${["Active", "Completed", "Planned", "Delayed", "Unknown"].map((status) => `<button data-status="${status}">${badge(status)} &nbsp;${data.projects.filter((project) => project.status === status).length}</button>`).join("")}</div><div id="tracker-content"></div>`;
  document.querySelectorAll("[data-tracker-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        state.trackerMode = button.dataset.trackerMode;
        renderView();
      }),
  );
  document.querySelector("#tracker-sort").onchange = (event) => {
    state.sort = event.target.value;
    renderView();
  };
  document.querySelectorAll("[data-status]").forEach(
    (button) =>
      (button.onclick = () => {
        state.status =
          state.status === button.dataset.status ? "" : button.dataset.status;
        frame();
      }),
  );
  const content = document.querySelector("#tracker-content");
  if (state.trackerMode === "projects")
    content.innerHTML = projectTable(sorted);
  if (state.trackerMode === "activities")
    content.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Project / deliverable</th><th>Target</th><th>Actual</th><th>Status / index</th><th>Deadline</th><th>Source</th></tr></thead><tbody>${data.activities.map((activity) => `<tr><td><button class="project-link" data-project="${activity.projectId}">${activity.projectId}</button><div style="max-width:390px;line-height:1.6;margin-top:6px">${esc(activity.title)}</div></td><td class="number">${activity.target ?? "Not numeric"}</td><td class="number">${activity.actual ?? "Not numeric"}</td><td>${badge(activity.status)}<div class="footnote">${pct(activity.progress)}</div></td><td>Not recorded</td><td class="source-ref">${esc(activity.source.sheet)}<br>Row ${activity.source.row}</td></tr>`).join("") || '<tr><td colspan="6">No selected activity evidence</td></tr>'}</tbody></table></div><p class="footnote">Targets and actuals use the selected source column; mixed units are not aggregated. Numeric text inside narrative cells is not parsed as an actual. Activity deadlines are not inferred from award end dates.</p>`;
  if (state.trackerMode === "timeline") {
    content.innerHTML = panel(
      "Award timeline",
      "Source dates / reporting cutoff; not a milestone completion history",
      "timeline-chart",
    );
    drawTimeline("timeline-chart", sorted);
  }
  if (state.trackerMode === "risks") {
    const issues = model.issues.filter((issue) =>
      data.ids.has(issue.projectId),
    );
    content.innerHTML = `<div class="section-heading"><h2>Evidence-driven exceptions</h2><small>No formal risk register supplied</small></div><div class="table-wrap"><table><thead><tr><th>Project</th><th>RAG</th><th>Exception</th><th>Management action</th></tr></thead><tbody>${sorted.flatMap((project) => project.alerts.map((alert) => `<tr><td><button class="project-link" data-project="${project.id}">${project.id}</button></td><td>${badge(project.rag)}</td><td>${esc(alert)}</td><td>${/closure/.test(alert) ? "Request closure report and acceptance documentation" : /coordinate/.test(alert) ? "Validate the site register and GPS observations" : /budget|currency/.test(alert) ? "Reconcile with finance and the award agreement" : "Request a dated, validated tracker refresh"}</td></tr>`)).join("")}</tbody></table></div><div class="section-heading"><h2>Spatial data issues</h2><small>${issues.length} flagged records</small></div><div class="table-wrap"><table><thead><tr><th>Project</th><th>Issue</th><th>Evidence</th><th>Source</th></tr></thead><tbody>${issues.map((issue) => `<tr><td>${esc(issue.projectId)}</td><td>${esc(issue.type)}</td><td>${esc(issue.detail)}</td><td class="source-ref">${esc(issue.source.sheet)} / row ${issue.source.row}</td></tr>`).join("") || '<tr><td colspan="4">No flagged issues in this selection</td></tr>'}</tbody></table></div>`;
  }
  if (state.trackerMode === "milestones")
    content.innerHTML = milestoneTable(data);
  if (state.trackerMode === "indicators")
    content.innerHTML = monitoringTable(data);
  if (state.trackerMode === "risks")
    content.insertAdjacentHTML("beforeend", sourceRiskTable(data));
  icons();
  bindProjectLinks();
}
function milestoneTable(data) {
  const rows = [...model.deadlines, ...model.milestones]
    .filter((record) => data.ids.has(record.projectId))
    .sort((a, b) => d3.ascending(a.date, b.date));
  return `<div class="view-intro"><span>${rows.filter((row) => row.state === "Past award end").length} past award-end exceptions / ${rows.filter((row) => row.state === "Next 90 days").length} ends in next 90 days</span><span>Activity deadlines: not recorded</span></div><div class="table-wrap"><table><thead><tr><th>Project</th><th>Milestone / deadline</th><th>Date</th><th>Evidence type</th><th>State</th><th>Source</th></tr></thead><tbody>${rows.map((record) => `<tr><td><button class="project-link" data-project="${record.projectId}">${record.projectId}</button></td><td>${esc(record.title)}</td><td class="number">${record.date}</td><td>${esc(record.type)}</td><td>${esc(record.state ?? record.status)}</td><td>${sourceRef(record.source)}</td></tr>`).join("") || '<tr><td colspan="6">No source-dated milestones in selection</td></tr>'}</tbody></table></div><p class="footnote">Handover events are source observations. Award end dates are not activity deadlines. Past award-end exceptions require closure verification; they are not automatically overdue activities.</p>`;
}
function monitoringTable(data) {
  const records = model.monitoring.filter((record) =>
    data.ids.has(record.projectId),
  );
  return `<div class="table-wrap"><table><thead><tr><th>Project / indicator</th><th>2027 target</th><th>Disaggregation targets</th><th>Monitoring / owner</th><th>Source</th></tr></thead><tbody>${records.map((record) => `<tr><td><button class="project-link" data-project="${record.projectId}">${record.projectId}</button><p style="max-width:330px">${esc(record.indicator)}</p></td><td class="number">${record.target === null ? "Not numeric" : fmt(record.target)}<p class="footnote">Actual: not reported</p></td><td>Female: ${record.femaleTarget ?? "N/A"}<br>Male: ${record.maleTarget ?? "N/A"}<br>Youth: ${record.youthTarget ?? "N/A"}<br>IDPs: ${record.idpTarget ?? "N/A"}<br>Indirect: ${record.indirectTarget ?? "N/A"}</td><td style="max-width:260px">${esc(record.frequency)}<p class="footnote">${esc(record.responsible)}</p></td><td>${sourceRef(record.source)}</td></tr>`).join("") || '<tr><td colspan="5">No structured monitoring-plan indicators in selection</td></tr>'}</tbody></table></div><p class="footnote">Planning targets are not actual reach. Disaggregation categories overlap; indicators are not summed across activities or counted as unique beneficiaries.</p>`;
}
function sourceRiskTable(data) {
  const records = model.risks.filter((record) =>
    data.ids.has(record.projectId),
  );
  return `<div class="section-heading"><h2>Source risk narratives</h2><small>${records.length} monitoring-plan risks / ratings not supplied</small></div><div class="table-wrap"><table><thead><tr><th>Project / activity</th><th>Reported risk</th><th>Monitoring responsibility</th><th>Source</th></tr></thead><tbody>${records.map((record) => `<tr><td style="max-width:250px">${record.projectId}<p class="footnote">${esc(record.activity)}</p></td><td style="max-width:420px;line-height:1.7">${esc(record.description)}</td><td style="max-width:230px">${esc(record.owner)}</td><td>${sourceRef(record.source)}</td></tr>`).join("") || '<tr><td colspan="4">No structured source risk narratives in selection</td></tr>'}</tbody></table></div>`;
}
function drawTimeline(id, projects) {
  const dated = projects.filter((project) => project.start && project.end);
  if (!dated.length) return emptyChart(id, "No source-backed date ranges");
  const width = 1000,
    height = dated.length * 39 + 70,
    svg = svgChart(id, width, height);
  const start = d3.min(dated, (project) => new Date(project.start)),
    end = d3.max(dated, (project) => new Date(project.end));
  const x = d3.scaleUtc([start, end], [90, width - 30]);
  const y = d3
    .scaleBand(
      dated.map((project) => project.id),
      [25, height - 40],
    )
    .padding(0.5);
  svg
    .append("g")
    .attr("transform", `translate(0,${height - 30})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.utcFormat("%b %Y")));
  svg
    .selectAll(".label")
    .data(dated)
    .join("text")
    .attr("x", 0)
    .attr("y", (project) => y(project.id) + y.bandwidth() / 2 + 3)
    .text((project) => project.id);
  const bars = svg
    .selectAll("rect")
    .data(dated)
    .join("rect")
    .attr("x", (project) => x(new Date(project.start)))
    .attr("y", (project) => y(project.id))
    .attr("width", (project) =>
      Math.max(1, x(new Date(project.end)) - x(new Date(project.start))),
    )
    .attr("height", y.bandwidth())
    .attr("fill", (project) => colors[project.rag])
    .attr("rx", 3)
    .attr("opacity", 0.75);
  interactive(
    bars,
    (project) => `${project.id}: ${project.start} to ${project.end}`,
    (project) => showProject(project.id),
  );
  const cutoff = x(new Date(model.asOf));
  svg
    .append("line")
    .attr("x1", cutoff)
    .attr("x2", cutoff)
    .attr("y1", 12)
    .attr("y2", height - 34)
    .attr("stroke", "#253f34")
    .attr("stroke-dasharray", "4 3");
  svg
    .append("text")
    .attr("x", cutoff + 5)
    .attr("y", 12)
    .text("Reporting cutoff");
}

function analytics(data) {
  document.querySelector("#view-content").innerHTML =
    `<div class="analytics-grid">${panel("Allocation by project", "Award budgets / select currency; no FX aggregation", "budget-chart", '<select id="currency-choice" aria-label="Budget chart currency"><option>USD</option><option>CHF</option><option>EUR</option></select>')}${panel("Award schedule profile", "Concurrent source-dated awards; not delivery performance", "schedule-chart")}${panel("Activities by sector", "Activity counts, not budget or unique beneficiaries", "treemap-chart")}${panel("Delivery evidence matrix", "Mean activity index by project and sector / gray = no comparable numeric evidence", "heatmap-chart")}${panel("Funding & delivery relationships", "Donor > project > derived project status / one flow unit per project", "sankey-chart")}${panel("Stakeholder network", "Project and reported implementing partner relationships", "network-chart")}</div><div class="section-heading"><h2>Financial evidence</h2><small>Source actuals are not a verified spend ledger</small></div><div class="table-wrap"><table><thead><tr><th>Project</th><th>Financial measure</th><th>Amount</th><th>Basis</th></tr></thead><tbody>${
      model.financialLines
        .filter((line) => data.ids.has(line.projectId))
        .filter((line) => line.projectId !== "REVIVE")
        .map(
          (line) =>
            `<tr><td>${line.projectId}</td><td>${esc(line.description)}</td><td class="number">${esc(money(line.amount, line.currency))}</td><td>${esc(line.type)}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="4">No reported financial actuals in this selection</td></tr>'
    }</tbody></table></div><div class="insight-band">${icon("wallet")}<div><strong>Verified utilization unavailable from supplied workbooks</strong><p>Award allocations, procurement plans and reported activity actuals have different accounting bases. A reconciled expenditure ledger, reporting date and currency definitions are required before a management utilization rate can be calculated.</p></div></div>`;
  document.querySelector("#view-content .section-heading")?.remove();
  document.querySelector("#view-content .table-wrap")?.remove();
  document.querySelector("#view-content .insight-band")?.remove();
  document.querySelector("#currency-choice").onchange = (event) =>
    drawBudgets("budget-chart", data.projects, event.target.value);
  drawBudgets("budget-chart", data.projects, "USD");
  drawSchedule("schedule-chart", data.projects);
  drawTreemap("treemap-chart", data.activities);
  drawHeatmap("heatmap-chart", data);
  drawSankey("sankey-chart", data.projects);
  drawNetwork("network-chart", data.projects);
}
function drawBudgets(id, projects, currency) {
  const values = projects
    .filter(
      (project) => project.currency === currency && project.budget !== null,
    )
    .map((project) => [project.id, project.budget]);
  if (!values.length)
    return emptyChart(id, `No ${currency} award budgets in selection`);
  horizontalBars(id, values, currency, (id) => filterProject(id));
}
function drawSchedule(id, projects) {
  const dated = projects.filter((project) => project.start && project.end);
  if (!dated.length) return emptyChart(id, "No source-dated award ranges");
  const start = d3.utcMonth.floor(
    new Date(d3.min(dated, (project) => project.start)),
  );
  const end = d3.utcMonth.offset(
    new Date(d3.max(dated, (project) => project.end)),
    1,
  );
  const values = d3.utcMonths(start, end).map((month) => ({
    month,
    count: dated.filter(
      (project) =>
        new Date(project.start) < d3.utcMonth.offset(month, 1) &&
        new Date(project.end) >= month,
    ).length,
  }));
  const width = 530,
    height = 270,
    svg = svgChart(id, width, height),
    x = d3.scaleUtc(
      d3.extent(values, (value) => value.month),
      [32, width - 16],
    ),
    y = d3.scaleLinear(
      [0, d3.max(values, (value) => value.count) || 1],
      [height - 35, 18],
    );
  svg
    .append("g")
    .attr("transform", `translate(0,${height - 35})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.utcFormat("%b %y")));
  svg
    .append("g")
    .attr("transform", "translate(32,0)")
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickSize(-(width - 48)),
    );
  svg
    .append("path")
    .datum(values)
    .attr(
      "d",
      d3
        .area()
        .x((value) => x(value.month))
        .y0(y(0))
        .y1((value) => y(value.count))
        .curve(d3.curveStepAfter),
    )
    .attr("fill", "#e2f0e7");
  svg
    .append("path")
    .datum(values)
    .attr(
      "d",
      d3
        .line()
        .x((value) => x(value.month))
        .y((value) => y(value.count))
        .curve(d3.curveStepAfter),
    )
    .attr("stroke", "#398d6e")
    .attr("stroke-width", 2)
    .attr("fill", "none");
  const dots = svg
    .selectAll("circle")
    .data(values)
    .join("circle")
    .attr("cx", (value) => x(value.month))
    .attr("cy", (value) => y(value.count))
    .attr("r", 3)
    .attr("fill", "#398d6e");
  interactive(
    dots,
    (value) =>
      `${d3.utcFormat("%B %Y")(value.month)}: ${value.count} awards overlapping month`,
  );
}
function drawTreemap(id, activities) {
  if (!activities.length) return emptyChart(id);
  const width = 530,
    height = 280;
  const root = d3
    .hierarchy({
      children: d3
        .rollups(
          activities,
          (group) => group.length,
          (activity) => activity.sector,
        )
        .map(([name, value]) => ({ name, value })),
    })
    .sum((value) => value.value || 0);
  d3.treemap().size([width, height]).padding(4).round(true)(root);
  const svg = svgChart(id, width, height);
  const groups = svg
    .selectAll("g")
    .data(root.leaves())
    .join("g")
    .attr("transform", (node) => `translate(${node.x0},${node.y0})`);
  groups
    .append("rect")
    .attr("width", (node) => node.x1 - node.x0)
    .attr("height", (node) => node.y1 - node.y0)
    .attr("rx", 3)
    .attr("fill", (node) => colors[node.data.name] || "#789487")
    .attr("opacity", 0.85);
  groups
    .filter((node) => node.x1 - node.x0 > 95 && node.y1 - node.y0 > 40)
    .append("text")
    .attr("x", 11)
    .attr("y", 23)
    .attr("fill", "white")
    .style("fill", "white")
    .text((node) => node.data.name);
  groups
    .filter((node) => node.x1 - node.x0 > 45 && node.y1 - node.y0 > 65)
    .append("text")
    .attr("x", 11)
    .attr("y", 46)
    .style("fill", "white")
    .style("font-size", "19px")
    .text((node) => node.value);
  interactive(
    groups,
    (node) => `${node.data.name}: ${node.value} activities`,
    (node) => {
      state.sector = state.sector === node.data.name ? "" : node.data.name;
      frame();
    },
  );
}
function drawHeatmap(id, data) {
  if (!data.projects.length) return emptyChart(id);
  const sectors = unique(data.activities.map((activity) => activity.sector));
  if (!sectors.length) return emptyChart(id);
  const width = 600,
    height = data.projects.length * 23 + 105,
    svg = svgChart(id, width, height),
    x = d3.scaleBand(sectors, [80, width - 10]).padding(0.1),
    y = d3
      .scaleBand(
        data.projects.map((project) => project.id),
        [65, height - 15],
      )
      .padding(0.14);
  svg
    .selectAll(".sector")
    .data(sectors)
    .join("text")
    .attr(
      "transform",
      (value) => `translate(${x(value) + x.bandwidth() / 2},53) rotate(-25)`,
    )
    .attr("text-anchor", "start")
    .style("font-size", "8px")
    .text((value) => value);
  svg
    .selectAll(".project")
    .data(data.projects)
    .join("text")
    .attr("x", 0)
    .attr("y", (project) => y(project.id) + y.bandwidth() / 2 + 3)
    .text((project) => project.id);
  const cells = data.projects.flatMap((project) =>
    sectors.map((sector) => {
      const values = data.activities.filter(
        (activity) =>
          activity.projectId === project.id &&
          activity.sector === sector &&
          activity.progress !== null,
      );
      return {
        project,
        sector,
        value: values.length
          ? d3.mean(values, (activity) => activity.progress)
          : null,
      };
    }),
  );
  const rects = svg
    .selectAll("rect")
    .data(cells)
    .join("rect")
    .attr("x", (cell) => x(cell.sector))
    .attr("y", (cell) => y(cell.project.id))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("fill", (cell) =>
      cell.value === null
        ? "#e9edeb"
        : d3.interpolateRgb("#f0df99", "#2f8e6a")(cell.value),
    )
    .attr("rx", 2);
  interactive(
    rects,
    (cell) => `${cell.project.id} / ${cell.sector}: ${pct(cell.value)}`,
    (cell) => {
      state.project = cell.project.id;
      state.sector = cell.sector;
      frame();
    },
  );
}
function drawSankey(id, projects) {
  if (!projects.length) return emptyChart(id);
  const nodes = [],
    links = [];
  function add(key, name, type) {
    let node = nodes.find((node) => node.key === key);
    if (!node) {
      node = { key, name, type };
      nodes.push(node);
    }
    return key;
  }
  for (const project of projects) {
    const donor = add(`donor:${project.donor}`, project.donor, "donor"),
      award = add(project.id, project.id, "project"),
      status = add(`status:${project.status}`, project.status, "status");
    links.push(
      { source: donor, target: award, value: 1 },
      { source: award, target: status, value: 1 },
    );
  }
  const width = 650,
    height = Math.max(310, projects.length * 30);
  const graph = sankey()
    .nodeId((node) => node.key)
    .nodeWidth(9)
    .nodePadding(13)
    .extent([
      [12, 12],
      [width - 12, height - 12],
    ])({ nodes, links });
  const svg = svgChart(id, width, height);
  const paths = svg
    .append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("d", sankeyLinkHorizontal())
    .attr("stroke", "#79ad95")
    .attr("stroke-opacity", 0.3)
    .attr("stroke-width", (link) => Math.max(1, link.width));
  interactive(
    paths,
    (link) =>
      `${link.source.name} > ${link.target.name}: ${link.value} project relationship`,
  );
  const groups = svg.selectAll(".node").data(graph.nodes).join("g");
  groups
    .append("rect")
    .attr("x", (node) => node.x0)
    .attr("y", (node) => node.y0)
    .attr("width", (node) => node.x1 - node.x0)
    .attr("height", (node) => node.y1 - node.y0)
    .attr("fill", (node) =>
      node.type === "status" ? colors[node.name] : "#3c866a",
    );
  groups
    .append("text")
    .attr("x", (node) => (node.x0 < width / 2 ? node.x1 + 5 : node.x0 - 5))
    .attr("y", (node) => (node.y0 + node.y1) / 2 + 3)
    .attr("text-anchor", (node) => (node.x0 < width / 2 ? "start" : "end"))
    .style("font-size", "9px")
    .text((node) =>
      node.name.length > 37 ? node.name.slice(0, 35) + "..." : node.name,
    );
  interactive(
    groups,
    (node) => node.name,
    (node) => {
      if (node.type === "project") filterProject(node.key);
      else if (node.type === "status") {
        state.status = node.name;
        frame();
      } else {
        state.donor = node.name;
        frame();
      }
    },
  );
}
function drawNetwork(id, projects) {
  const projectNodes = projects.map((project) => ({
    id: project.id,
    name: project.id,
    type: "project",
  }));
  const partnerNodes = new Map();
  const links = [];
  for (const project of projects) {
    const partners = unique(
      model.locations
        .filter((location) => location.projectId === project.id)
        .map((location) => location.partner),
    );
    if (
      !partners.length &&
      project.partners &&
      !/not reported|TBC|^NA$|^-$/.test(project.partners)
    )
      partners.push(...project.partners.split(/,\s*/));
    for (const partner of partners) {
      const key = `partner:${partner}`;
      if (!partnerNodes.has(key))
        partnerNodes.set(key, { id: key, name: partner, type: "partner" });
      links.push({ source: project.id, target: key });
    }
  }
  if (!links.length)
    return emptyChart(id, "No reported partner relationships in selection");
  const nodes = [...projectNodes, ...partnerNodes.values()];
  const width = 760;
  const rowHeight = 24;
  const height = Math.max(330, Math.max(projectNodes.length, partnerNodes.size) * rowHeight + 36);
  const top = 18;
  const bottom = height - 18;
  const projectX = 166;
  const partnerX = 486;
  const placeColumn = (column, x) => {
    column.forEach((node, index) => {
      node.x = x;
      node.y = top + ((index + 0.5) * (bottom - top)) / column.length;
    });
  };
  placeColumn(projectNodes, projectX);
  placeColumn([...partnerNodes.values()], partnerX);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const svg = svgChart(id, width, height);
  svg
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("x1", (link) => nodeById.get(link.source).x + 8)
    .attr("y1", (link) => nodeById.get(link.source).y)
    .attr("x2", (link) => nodeById.get(link.target).x - 7)
    .attr("y2", (link) => nodeById.get(link.target).y)
    .attr("stroke", "#cbd3da")
    .attr("stroke-opacity", 0.7);
  const groups = svg
    .selectAll(".node")
    .data(nodes)
    .join("g")
    .attr("class", (node) => `network-node ${node.type}`)
    .attr("data-node-id", (node) => node.id)
    .attr("transform", (node) => `translate(${node.x},${node.y})`);
  groups
    .append("circle")
    .attr("r", (node) => (node.type === "project" ? 6 : 5))
    .attr("fill", (node) => (node.type === "project" ? "#006eb5" : "#d12800"))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);
  groups
    .append("text")
    .attr("x", (node) => (node.type === "project" ? -12 : 12))
    .attr("dy", ".3em")
    .attr("text-anchor", (node) => (node.type === "project" ? "end" : "start"))
    .style("font-size", "10px")
    .text((node) => {
      const label = node.name || node.id;
      return label.length > 32 ? `${label.slice(0, 30)}...` : label;
    });
  interactive(
    groups,
    (node) => `${node.name || node.id} / ${node.type}`,
    (node) => {
      if (node.type === "project") filterProject(node.id);
      else {
        state.partner = node.name;
        frame();
      }
    },
  );
}

function sources() {
  const workbookCount = new Set(model.inventory.map((sheet) => sheet.file))
    .size;
  document.querySelector("#view-content").innerHTML =
    `<div class="quality-grid"><div><strong>${workbookCount}</strong>XLSX workbooks audited</div><div><strong>${model.inventory.length}</strong>Worksheets inventoried</div><div><strong>${model.issues.length}</strong>Spatial quality flags</div><div><strong>${model.projects.filter((project) => !project.updated).length}</strong>Missing / ambiguous reporting dates</div></div><div class="source-grid"><section class="panel"><div class="panel-head"><div><h2>Workbook & sheet register</h2><p>All sources / independent of pillar filters</p></div></div><div class="panel-body"><label class="sr-only" for="source-search">Search source sheets</label><input id="source-search" type="search" placeholder="Find workbook or sheet" value="${esc(state.sourceSearch)}" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:4px"></div><div class="source-list" id="source-list"></div></section><section class="panel"><div class="panel-head"><div><h2 id="source-title">Source cells</h2><p id="source-meta">Select a worksheet</p></div><button id="source-export" class="icon-button" title="Export selected source sheet as CSV">${icon("download")}</button></div><div id="source-cells" class="audit-table"></div></section></div><section class="methodology"><h2>Measurement & interpretation</h2><ol>${model.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ol></section><div class="section-heading"><h2>GIS reference inventory</h2></div><div class="table-wrap"><table><thead><tr><th>Layer</th><th>Features</th><th>Use</th></tr></thead><tbody><tr><td>Sudan administrative localities</td><td>${boundaries.features.length}</td><td>WGS84 administrative boundaries; D3 winding adapted in working copy</td></tr>${model.externalLayers.map((layer) => `<tr><td>${esc(layer.file)}</td><td>${fmt(layer.featureCount)}</td><td>${esc(layer.role)}</td></tr>`).join("")}<tr><td>${esc(model.schoolReference.file)}</td><td>${fmt(model.schoolReference.rows)} populated rows</td><td>National schools reference, not projects</td></tr></tbody></table></div>`;
  const sourceDescription = document.querySelector(
    ".source-grid .panel-head p",
  );
  if (sourceDescription)
    sourceDescription.textContent =
      "All sources / independent of pillar filters";
  document.querySelector("#source-search").oninput = (event) => {
    state.sourceSearch = event.target.value;
    sourceList();
  };
  sourceList();
  loadSource(state.sourceIndex);
  document
    .querySelector("#view-content")
    .insertAdjacentHTML(
      "beforeend",
      `<div class="section-heading"><h2>Education authority reference</h2><small>2021 / locality-linked, no point coordinates</small></div><p class="note">${fmt(model.authorityReference.rows)} school records. Student counts are reference enrollment, not project beneficiaries. <a href="/data/reference/authority.json" download="schools-authority-reference.json">Download source reference</a></p><div class="table-wrap"><table><thead><tr><th>Locality code</th><th>Reference schools</th><th>Reported students</th><th>Reported teachers</th></tr></thead><tbody>${model.authorityReference.byLocality.map((record) => `<tr><td>${esc(record.code)}</td><td>${fmt(record.schools)}</td><td>${fmt(record.reportedStudents)}</td><td>${fmt(record.reportedTeachers)}</td></tr>`).join("")}</tbody></table></div>`,
    );
}
function sourceList() {
  document.querySelector("#source-list").innerHTML = model.inventory
    .map((sheet, index) => ({ sheet, index }))
    .filter(({ sheet }) =>
      `${sheet.file} ${sheet.sheet}`
        .toLowerCase()
        .includes(state.sourceSearch.toLowerCase()),
    )
    .map(
      ({ sheet, index }) =>
        `<button data-source="${index}" class="${state.sourceIndex === index ? "selected" : ""}">${esc(sheet.sheet)}<small>${esc(sheet.file)}<br>${fmt(sheet.rows)} rows / ${esc(sheet.role)}</small></button>`,
    )
    .join("");
  document.querySelectorAll("[data-source]").forEach(
    (button) =>
      (button.onclick = () => {
        state.sourceIndex = Number(button.dataset.source);
        sourceList();
        loadSource(state.sourceIndex);
      }),
  );
}
async function loadSource(index) {
  const sheet = model.inventory[index];
  const cells = document.querySelector("#source-cells");
  if (!cells) return;
  document.querySelector("#source-title").textContent = sheet.sheet;
  document.querySelector("#source-meta").textContent =
    `${sheet.file} / ${sheet.rows} populated rows / ${sheet.role}`;
  cells.innerHTML = '<div class="empty">Loading source cells...</div>';
  try {
    if (!sourceCache.has(index))
      sourceCache.set(index, await json(`/data/audit/${index}.json`));
    if (state.view !== "sources" || state.sourceIndex !== index) return;
    const rows = sourceCache.get(index);
    const columnCount = Math.max(
      1,
      d3.max(rows, (row) => row.cells.length) || 1,
    );
    cells.innerHTML = `<table><thead><tr><th>Row</th>${Array.from({ length: columnCount }, (_, column) => `<th>${excelColumn(column)}</th>`).join("")}</tr></thead><tbody>${rows
      .slice(0, 200)
      .map(
        (row) =>
          `<tr><td class="number">${row.row}</td>${Array.from({ length: columnCount }, (_, column) => `<td>${esc(row.cells[column])}</td>`).join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table><p class="footnote" style="padding:12px">First 200 populated rows displayed. Export includes all ${rows.length} rows.</p>`;
    document.querySelector("#source-export").onclick = () =>
      download(
        `${sheet.sheet}.csv`,
        d3.csvFormat(
          rows.map((row) => ({
            sourceRow: row.row,
            ...Object.fromEntries(
              Array.from({ length: columnCount }, (_, column) => [
                excelColumn(column),
                row.cells[column] ?? "",
              ]),
            ),
          })),
        ),
        "text/csv",
      );
  } catch (error) {
    cells.innerHTML = `<div class="error">Source unavailable: ${esc(error.message)}</div>`;
  }
}
function excelColumn(index) {
  let value = index + 1,
    result = "";
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function sourceRef(source) {
  return `<div class="source-ref">${esc(source.file)}<br>${esc(source.sheet)} / row ${source.row}</div>`;
}
function openDialog(html) {
  document.querySelector("#detail-content").innerHTML = html;
  const dialog = document.querySelector("#detail");
  if (!dialog.open) dialog.showModal();
  document.querySelector("#close-detail").onclick = () => dialog.close();
  icons();
}
function showProject(id) {
  const project = projectById.get(id);
  if (!project) return;
  const activities = model.activities.filter(
    (activity) => activity.projectId === id,
  );
  const sites = model.sites.filter((site) => site.projectId === id);
  const updates = model.updates.filter((update) => update.projectId === id);
  openDialog(
    `<div class="detail-head"><div><div class="eyebrow">${esc(project.id)} / ${esc(project.sourceType)}</div><h2>${esc(project.name)}</h2></div><button id="close-detail" class="icon-button" title="Close project details">${icon("x")}</button></div><div class="detail-body"><dl class="detail-grid"><div><dt>Funding partner</dt><dd>${esc(project.donor)}</dd></div><div><dt>Award allocation</dt><dd>${esc(money(project.budget, project.currency))}</dd></div><div><dt>Derived status / RAG</dt><dd>${badge(project.status)} ${badge(project.rag)}</dd></div><div><dt>Award dates</dt><dd>${project.start ?? "Not reported"} / ${project.end ?? "Not reported"}</dd></div><div><dt>Activity index</dt><dd>${pct(project.progress)} / ${project.measuredActivities} of ${project.activityCount} measured</dd></div><div><dt>Reporting date</dt><dd>${project.updated ?? "Missing or ambiguous"}</dd></div><div><dt>Target geography</dt><dd>${esc(project.targetLocations || "Not reported")}</dd></div><div><dt>Implementing partners</dt><dd>${esc(project.partners)}</dd></div><div><dt>Site evidence</dt><dd>${sites.length} observations / ${sites.filter((site) => site.coordinates).length} mapped</dd></div></dl><p class="note">${esc(project.statusBasis)}</p><h3>Management follow-up</h3>${project.alerts.map((alert) => `<p class="note">${esc(alert)}</p>`).join("") || '<p class="note">No screening exceptions.</p>'}<h3>Activities & deliverables</h3><div class="table-wrap"><table><thead><tr><th>Deliverable</th><th>Evidence</th><th>Status</th><th>Source</th></tr></thead><tbody>${activities.map((activity) => `<tr><td style="max-width:350px">${esc(activity.title)}<p class="footnote">${esc(activity.comment)}</p></td><td>${activity.actual ?? "N/A"} / ${activity.target ?? "N/A"}<p class="footnote">${esc(activity.actualLabel || "No comparable numeric source column")}</p></td><td>${badge(activity.status)}</td><td>${sourceRef(activity.source)}</td></tr>`).join("")}</tbody></table></div><h3>Latest source-positioned updates</h3>${
      updates
        .slice(-4)
        .map(
          (update) =>
            `<details><summary class="note">${esc(update.period)} / ${esc(update.source.sheet)}</summary><p class="note" style="white-space:pre-wrap">${esc(update.text)}</p>${sourceRef(update.source)}</details>`,
        )
        .join("") || '<p class="note">No narrative update extracted.</p>'
    }<h3>Beneficiary / finance evidence</h3><p class="note">Site estimates may overlap. Verified pillar reach and a reconciled expenditure measure are unavailable. Milestone deadlines are not inferred from award dates.</p><h3>Source</h3>${sourceRef(project.source)}<button id="inspect-project-source" class="source-button">Inspect source worksheet</button></div>`,
  );
  document.querySelector("#inspect-project-source").onclick = () => {
    document.querySelector("#detail").close();
    state.view = "sources";
    state.sourceIndex = model.inventory.findIndex(
      (sheet) =>
        sheet.file === project.source.file &&
        sheet.sheet === project.source.sheet,
    );
    frame();
  };
}
function showSite(id) {
  const site = model.sites.find((site) => site.id === id);
  if (!site) return;
  openDialog(
    `<div class="detail-head"><div><div class="eyebrow">${esc(site.projectId || "Unlinked site")} / SITE OBSERVATION</div><h2>${esc(site.name)}</h2></div><button id="close-detail" class="icon-button" title="Close site details">${icon("x")}</button></div><div class="detail-body"><dl class="detail-grid"><div><dt>Source geography</dt><dd>${esc(site.state)} / ${esc(site.locality)}</dd></div><div><dt>Boundary match</dt><dd>${esc(site.boundaryState ?? "No match")} / ${esc(site.localityCode ?? "Not mapped")}</dd></div><div><dt>WGS84 longitude, latitude</dt><dd>${site.coordinates ? site.coordinates.map((value) => value.toFixed(6)).join(", ") : "Not available"}</dd></div><div><dt>Service estimate</dt><dd>${site.beneficiaries === null ? "Not reported" : `${fmt(site.beneficiaries)} ${esc(site.beneficiaryUnit)}`}</dd></div><div><dt>Implementation evidence</dt><dd>${badge(site.status)} / ${esc(site.statusRaw || "not reported")}</dd></div><div><dt>Handover date</dt><dd>${site.handover ?? "Not recorded"}</dd></div>${site.registerStatus ? `<div><dt>Water register status</dt><dd>${esc(site.registerStatus)}</dd></div><div><dt>Intervention type</dt><dd>${esc(site.interventionType || "Not reported")}</dd></div><div><dt>Map / coordinates / BOQ</dt><dd>${esc(site.mapProvided || "Not reported")} / ${esc(site.coordinatesProvided || "Not reported")} / ${esc(site.boqReceived || "Not reported")}</dd></div><div><dt>SOW reference</dt><dd>${esc(site.sowReference || "Not reported")}</dd></div>` : ""}</dl><p class="note">Source observations are not independently verified. Estimated service reach is not unique beneficiaries reached. Water-register status is retained as reported and may describe documentation readiness rather than implementation.</p><h3>Provenance</h3>${site.sources.map(sourceRef).join("<br>")}${site.projectId ? `<button id="site-project" class="button-label" style="margin-top:20px">${icon("folder-kanban")}Open project ${esc(site.projectId)}</button>` : ""}</div>`,
  );
  if (site.projectId)
    document.querySelector("#site-project").onclick = () =>
      showProject(site.projectId);
}
function download(filename, content, type) {
  const safe =
    type === "text/csv"
      ? d3.csvFormatRows(
          d3
            .csvParseRows(content)
            .map((row) =>
              row.map((value) =>
                /^[=+@\-\t\r]/.test(value) ? `'${value}` : value,
              ),
            ),
        )
      : content;
  const blob = new Blob(["\ufeff", safe], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadAuthenticatedSession() {
  if (import.meta.env.DEV || staticDeployment) return null;
  const response = await fetch("/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "Your sign-in session is unavailable. Sign in again to continue.",
    );
  return response.json();
}

async function loadStaticAcledSnapshot() {
  const response = await fetch("/data/acled-snapshot.json", {
    cache: "no-store",
  });
  if (
    response.status === 404 ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    return null;
  if (!response.ok)
    throw new Error(`ACLED snapshot unavailable: ${response.status}`);
  return response.json();
}

async function initialize() {
  try {
    authSession = await loadAuthenticatedSession();
    [model, boundaries, stateBoundaries] = await Promise.all([
      json("/data/model.json"),
      json("/data/boundaries.geojson"),
      json("/data/state-boundaries.geojson"),
    ]);
    if (staticDeployment) {
      const snapshot = await loadStaticAcledSnapshot();
      if (snapshot) {
        const normalized = normalizeAcledRows(
          snapshot.events ?? [],
          boundaries.features,
        );
        state.conflictEvents = normalized.events;
        state.conflictSourceName = `${snapshot.source} / ${snapshot.start} to ${snapshot.end}`;
        state.conflictRejections = normalized.rejected;
        state.conflictApiMeta = snapshot;
        state.conflictStart = snapshot.start;
        state.conflictEnd = snapshot.end;
      }
    }
    for (const project of model.projects) projectById.set(project.id, project);
    frame();
  } catch (error) {
    document.querySelector("#app").innerHTML =
      `<div class="error"><h1>Pillar data unavailable</h1><p>${esc(error.message)}</p><p>Generate the data bundle with npm run audit and npm run data, then reload.</p></div>`;
    document.querySelector("#app .error h1").textContent =
      "Pillar data unavailable";
  }
}
initialize();
