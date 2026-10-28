import { test, expect } from "@playwright/test";

async function openView(page, view) {
  await page.locator(`.header-nav [data-view="${view}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("R&R | Pillar Intelligence");
  await expect(
    page.getByRole("heading", { name: "Executive Overview", exact: true }),
  ).toBeVisible();
});

test("overview renders real geometry, filters, details and omits header controls", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator("#export")).toHaveCount(0);
  await expect(page.locator(".header-export")).toHaveCount(0);
  await expect(page.locator(".top-meta")).toHaveCount(0);
  await expect(page.locator(".kpi-label")).toHaveText([
    "Pillar projects",
    "Active projects",
    "Award allocation",
    "Est. service reach",
    "States covered",
    "Localities covered",
    "Closure exceptions",
  ]);
  const overviewText = await page.locator("#app").innerText();
  expect(overviewText.toLowerCase()).not.toContain(["port", "folio"].join(""));
  expect(overviewText).toContain("Pillar watchlist");
  await expect(page.locator(".kpi-value").first()).toHaveText("13");
  await expect(page.locator("#overview-map circle")).toHaveCount(416);
  const geometry = await page
    .locator("#overview-map path")
    .first()
    .getAttribute("d");
  expect(geometry.length).toBeGreaterThan(100);
  await page.locator("#filter-region").selectOption("Red Sea");
  await expect(page.locator("#filter-summary")).not.toContainText("13 of 13");
  await page.locator("#reset").click();
  await page.locator('.project-link[data-project="CERF"]').first().click();
  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#detail")).toContainText("Project_FactSheet");
  await page.locator("#close-detail").click();
  await page.locator("#filter-search").fill("zz-no-matching-award");
  await expect(page.locator(".kpi-value").first()).toHaveText("0");
  await page.locator("#reset").click();
  expect(errors).toEqual([]);
});

test("operational footprint supports state and locality level selection", async ({
  page,
}) => {
  await expect(page.locator("#overview-map .map-boundary")).toHaveCount(19);
  await expect(page.locator('[data-footprint-level="state"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#footprint-state")).toHaveValue("");
  await expect(page.locator("#footprint-locality")).toBeDisabled();
  await page.locator("#footprint-state").selectOption("Red Sea");
  await expect(page.locator("#filter-region")).toHaveValue("Red Sea");
  await expect(page.locator("#overview-map .map-boundary")).toHaveCount(1);
  await expect(page.locator("#footprint-locality")).toBeDisabled();
  await page.locator('[data-footprint-level="locality"]').click();
  await expect(
    page.locator('[data-footprint-level="locality"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#footprint-locality")).toBeEnabled();
  await expect(page.locator("#overview-map .map-boundary")).toHaveCount(10);
  const locality = await page
    .locator("#footprint-locality option")
    .nth(1)
    .getAttribute("value");
  const localityName = await page
    .locator("#footprint-locality option")
    .nth(1)
    .textContent();
  expect(locality).toBeTruthy();
  expect(localityName).toMatch(/\(\d+ observations\)$/);
  await page.locator("#footprint-locality").selectOption(locality);
  await expect(page.locator("#overview-map .map-boundary")).toHaveCount(1);
  await expect(page.locator("#overview-map .map-status")).toContainText(
    `LOCALITY / ${localityName.replace(/\s+\(\d+ observations\)$/, "")}`,
  );
  await expect(page.locator("#overview-map .map-status")).toHaveText(
    /\|\s*[1-9]\d* points/,
  );
  await expect(page.locator("#filter-summary")).not.toContainText(
    "0 of 13 projects",
  );
  await page.locator("#more-filters").click();
  await expect(page.locator("#filter-locality")).toHaveValue(locality);
  await page.locator('[data-footprint-level="state"]').click();
  await expect(page.locator("#footprint-locality")).toBeDisabled();
  await expect(page.locator("#overview-map .map-boundary")).toHaveCount(1);
  await expect(page.locator("#filter-locality")).toHaveValue("");
  await page.locator("#footprint-reset").click();
  await expect(page.locator("#footprint-state")).toHaveValue("");
  await expect(page.locator("#footprint-locality")).toBeDisabled();
  await expect(page.locator("#filter-region")).toHaveValue("");
  await expect(page.locator("#overview-map .map-boundary")).toHaveCount(19);
  await page.locator('.header-nav [data-view="gis"]').click();
  await expect(page.locator("#gis-map")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Site register" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Regional intervention comparison" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Coverage & needs screening" })).toHaveCount(0);
});

test("masthead matches the reference composition with visible section tabs", async ({
  page,
}) => {
  const logo = page.locator("img.brandmark");
  await expect(logo).toHaveAttribute("src", "/undp-logo-blue.svg");
  await expect(logo).toHaveAttribute(
    "alt",
    "United Nations Development Programme",
  );
  await expect
    .poll(() => logo.evaluate((image) => image.naturalWidth))
    .toBe(60);
  await expect(page.locator(".header-nav [data-view]")).toHaveCount(6);
  await expect(
    page.locator('.header-nav [data-view="overview"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".page-heading")).toHaveCSS(
    "background-color",
    "rgb(0, 110, 181)",
  );
  await expect(page.locator("body")).toHaveCSS("font-family", /ProximaNova/);
  await expect(page.locator(".page-heading")).toHaveCSS(
    "background-image",
    /cover-pattern\.svg/,
  );
  const heroHeight = await page
    .locator(".page-heading")
    .evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      available:
        innerHeight -
        document.querySelector(".topbar").getBoundingClientRect().height,
    }));
  expect(heroHeight.height).toBeGreaterThan(heroHeight.available * 0.9);
  await expect(page.locator('.header-nav [data-view="gis"]')).toBeVisible();
  await page.locator('.header-nav [data-view="gis"]').click();
  await expect(page.locator('.header-nav [data-view="gis"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { name: "Geospatial Intelligence" }),
  ).toBeVisible();
});

test("GIS modes, zoom, reference layers and progressive administrative drill-down work", async ({
  page,
}) => {
  await openView(page, "gis");
  await expect(page.locator(".water-register-summary")).toContainText(
    "252 source rows",
  );
  await expect(page.locator(".water-register-summary")).toContainText(
    "231 mapped / 21 without coordinates",
  );
  const jsbSolar = page.locator('#gis-map [data-site="JSB-S77"]');
  const jsbWater = page.locator('#gis-map [data-site="WTR-JSB-01"]');
  await expect(jsbSolar).toBeVisible();
  await expect(jsbWater).toBeVisible();
  const solarPosition = await jsbSolar.evaluate((point) => [
    Number(point.getAttribute("cx")),
    Number(point.getAttribute("cy")),
  ]);
  const waterPosition = await jsbWater.evaluate((point) => [
    Number(point.getAttribute("cx")),
    Number(point.getAttribute("cy")),
  ]);
  expect(Math.hypot(solarPosition[0] - waterPosition[0], solarPosition[1] - waterPosition[1])).toBeGreaterThan(8);
  await expect(jsbSolar).toHaveAttribute("aria-label", /offset.*source coordinate unchanged/);
  await expect(page.locator('#gis-map [data-site="WTR-CERF-01"]')).toBeVisible();
  await page.locator('#gis-map [data-site="WTR-CERF-01"]').focus();
  await page.locator('#gis-map [data-site="WTR-CERF-01"]').press("Enter");
  await expect(page.locator("#detail")).toContainText("Water register status");
  await expect(page.locator("#detail")).toContainText("Delivered");
  await page.locator("#close-detail").click();
  await expect(
    page.getByRole("heading", { name: "Geospatial Intelligence" }),
  ).toBeVisible();
  await page.locator('[data-map-mode="clusters"]').click();
  await expect(page.locator("#gis-map circle").first()).toBeVisible();
  await page.locator('[data-zoom="in"]').click();
  await page.locator('[data-map-mode="needs"]').click();
  await expect(page.locator("#gis-map [data-site]")).toHaveCount(0);
  await expect(page.locator("#show-project-points")).not.toBeChecked();
  await page.locator("#show-project-points").check();
  await expect(page.locator("#gis-map [data-site]")).toHaveCount(416);
  await page.locator("#show-project-points").uncheck();
  await expect(page.locator("#gis-map [data-site]")).toHaveCount(0);
    await page.locator("#reference-layer").selectOption("Education");
    await expect(page.locator("#gis-map .map-status")).toContainText(
      "reference features",
    );
    await expect(page.locator("#reference-layer option")).toHaveCount(3);
    await expect(page.locator("#reference-layer option").nth(1)).toHaveText(
      "Schools / local reference",
    );
    await expect(page.locator("#reference-layer option").nth(2)).toHaveText(
      "Health facilities",
    );
  await page.locator("#reference-layer").selectOption("");
  const regionShape = page
    .locator('#gis-map path[role="button"]')
    .filter({ hasNot: page.locator("none") })
    .first();
  await regionShape.dispatchEvent("click");
  await expect(page.locator("#filter-region")).not.toHaveValue("");
  await page.locator("#more-filters").click();
  await expect(page.locator("#filter-locality")).toHaveValue("");
  await page.locator("#reset").click();
  await expect(page.locator("#filter-region")).toHaveValue("");
  await page.locator('[data-map-mode="activities"]').click();
  await expect(page.locator("#show-project-points")).not.toBeChecked();
  await page.locator("#show-project-points").check();
  const italySolarSite = page.locator('#gis-map [data-site="ITALY-S66"]');
  await expect(italySolarSite).toBeVisible();
  await italySolarSite.focus();
  await italySolarSite.press("Enter");
  await expect(page.locator("#detail")).toContainText("Solar Street lights");
  await expect(page.locator("#detail")).toContainText("16 / 30");
  await page.locator("#close-detail").click();
});

test("analysis & vulnerability shows limits without ACLED and analyzes an imported CSV", async ({
  page,
}) => {
  await openView(page, "gis");
  await page.locator('[data-gis-panel="analysis"]').click();
  await expect(
    page.getByRole("heading", { name: "Analysis & Vulnerability Assessment" }),
  ).toBeVisible();
  await expect(page.locator(".analysis-callout")).toContainText(
    "ACLED conflict events are not loaded",
  );
  await expect(page.locator("#fetch-acled-api")).toBeDisabled();
  await expect(page.locator("#fetch-acled-api")).toHaveAttribute(
    "title",
    /authenticated ACLED API proxy/,
  );
  await expect(page.locator("#analysis-map .analysis-boundary")).toHaveCount(
    19,
  );
  await expect(page.locator("#conflict-trend")).toContainText(
    "No ACLED events loaded",
  );
  const acledCsv = [
    "event_id_cnty,event_date,event_type,sub_event_type,admin1,admin2,location,latitude,longitude,fatalities",
    "RS-1,2026-07-01,Battles,Armed clash,Red Sea,Sinkat,Sinkat town,18.937048,36.841209,4",
    "RS-2,2026-07-12,Violence against civilians,Attack,Red Sea,Port Sudan,Port Sudan,,,2",
  ].join("\n");
  await page.locator("#acled-upload").setInputFiles({
    name: "acled-sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(acledCsv),
  });
  await expect(page.locator(".analysis-callout")).toContainText(
    "ACLED loaded: 2 rows",
  );
  await expect(page.locator("#conflict-trend svg")).toBeVisible();
  await expect(page.locator("#conflict-types svg")).toBeVisible();
  await expect(page.locator("#conflict-types")).toContainText("Battles");
  await page.locator("#analysis-map-mode").selectOption("conflict");
  await expect(page.locator("#analysis-map .conflict-point")).toHaveCount(1);
  await page.locator("#conflict-start").fill("2026-07-13");
  await expect(page.locator(".analysis-callout")).toContainText(
    "0 in current filters",
  );
  await expect(page.locator(".analysis-callout")).not.toContainText(
    "ACLED conflict events are not loaded",
  );
});

test("beneficiary validation imports, samples, records verification and exports", async ({
  page,
}) => {
  await openView(page, "beneficiaries");
  await expect(
    page.getByRole("heading", { name: "Beneficiary Validation & Verification" }),
  ).toBeVisible();
  const templateDownload = page.waitForEvent("download");
  await page.locator("#beneficiary-template").focus();
  await page.locator("#beneficiary-template").press("Enter");
  const template = await templateDownload;
  let templateText = "";
  for await (const chunk of await template.createReadStream())
    templateText += chunk.toString();
  expect(templateText.split("\n")[0]).toContain("beneficiary_id");
  const beneficiaryCsv = [
    "beneficiary_id,name,gender,age,phone,id_number,project_id,activity_id,partner,reporting_period,state,locality,location,latitude,longitude",
    "R1,Amina,Female,25,+249 912 345 678,ID-001,CERF,CERF-A2,IP One,2026-Q3,Al Jazirah,Gazira ALMAKA,Medani,14.4,33.5",
    "R2,Mariam,Female,32,+249 912 345 678,ID-001,CERF,CERF-A2,IP One,2026-Q3,Al Jazirah,Gazira ALMAKA,Medani,14.41,33.51",
    "R3,Salma,Female,28,+249 912 345 678,ID-003,EAA,EAA-A1,IP Two,2026-Q3,Al Jazirah,Gazira ALMAKA,Medani,14.42,33.52",
  ].join("\n");
  await page.locator("#beneficiary-file").setInputFiles({
    name: "ip-beneficiaries.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(beneficiaryCsv),
  });
  await expect(page.locator(".beneficiary-kpis .kpi-value").first()).toHaveText("3");
  await expect(page.locator("#beneficiary-map .intervention-site").first()).toBeVisible();
  await expect(page.locator(".beneficiary-quality")).toContainText(
    "records with duplicate flags",
  );
  await page.locator("#beneficiary-generate-sample").focus();
  await page.locator("#beneficiary-generate-sample").press("Enter");
  await expect(page.locator(".beneficiary-module")).toContainText(
    "Sample generated",
  );
  const repository = page
    .locator(".beneficiary-section")
    .filter({ has: page.getByRole("heading", { name: "Beneficiary repository" }) });
  await repository.getByRole("button", { name: "Review" }).first().focus();
  await repository.getByRole("button", { name: "Review" }).first().press("Enter");
  await page.locator("#review-evidence-file").setInputFiles({
    name: "verification-note.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("mock verification evidence"),
  });
  await expect(page.locator("#review-evidence-name")).toHaveText("verification-note.pdf");
  await page.locator("#review-status").selectOption("Verified");
  await page.locator("#review-participation").selectOption("Yes");
  await page.locator("#review-service").fill("Water assistance");
  await page.locator("#review-satisfaction").fill("5");
  await page.locator("#review-notes").fill("Confirmed by phone");
  await page.locator("#save-verification").focus();
  await page.locator("#save-verification").press("Enter");
  await expect(page.locator(".beneficiary-module")).toContainText(
    "Verification updated",
  );
  await expect(page.locator(".beneficiary-module")).toContainText(
    "Evidence attached",
  );
  const evidenceDownload = page.waitForEvent("download");
  await page.locator("#download-review-evidence").focus();
  await page.locator("#download-review-evidence").press("Enter");
  expect((await evidenceDownload).suggestedFilename()).toBe("verification-note.pdf");
  const download = page.waitForEvent("download");
  await page.locator("#beneficiary-export").focus();
  await page.locator("#beneficiary-export").press("Enter");
  await expect(await download).toBeTruthy();
});

test("tracker exposes evidence, award deadlines, monitoring targets and actual source risks", async ({
  page,
}) => {
  await openView(page, "tracker");
  await page.locator('[data-tracker-mode="activities"]').click();
  await expect(page.locator("#tracker-content tbody tr")).toHaveCount(150);
  await page.locator('[data-tracker-mode="milestones"]').click();
  await expect(page.locator("#tracker-content")).toContainText(
    "Award end / closure verification",
  );
  await page.locator('[data-tracker-mode="indicators"]').click();
  await expect(page.locator("#tracker-content")).toContainText("500,000");
  await page.locator('[data-tracker-mode="risks"]').click();
  await expect(page.locator("#tracker-content")).toContainText(
    "Political instability",
  );
  await page.locator('[data-tracker-mode="timeline"]').click();
  await expect(page.locator("#timeline-chart svg")).toBeVisible();
});

test("all analytical diagrams render and chart selections cross-filter the pillar", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openView(page, "analytics");
  await expect(page.locator("#view-content")).toContainText(
    "Activities by sector",
  );
  await expect(page.locator("#view-content")).not.toContainText(
    "Financial evidence",
  );
  await expect(page.locator("#view-content")).not.toContainText(
    new RegExp(["port", "folio"].join(""), "i"),
  );
  for (const id of [
    "budget-chart",
    "schedule-chart",
    "treemap-chart",
    "heatmap-chart",
    "sankey-chart",
    "network-chart",
  ]) {
    await expect(page.locator(`#${id} svg`)).toBeVisible();
  }
  await expect(page.locator("#network-chart .network-node.project")).toHaveCount(13);
  await expect(page.locator("#network-chart .network-node.partner").first()).toBeVisible();
  const networkPositions = await page
    .locator("#network-chart .network-node")
    .evaluateAll((nodes) => nodes.map((node) => {
      const transform = node.getAttribute("transform").match(/translate\(([^,]+),([^\)]+)\)/);
      return [Number(transform[1]), Number(transform[2])];
    }));
  expect(networkPositions.every(([x, y]) => x > 0 && x < 760 && y > 0 && y < 800)).toBe(true);
  await page.locator("#currency-choice").selectOption("EUR");
  await expect(page.locator("#budget-chart")).toContainText("ITALY");
  await page.locator('#budget-chart rect[role="button"]').first().click();
  await expect(page.locator("#filter-summary")).toContainText("1 of 13");
  expect(errors).toEqual([]);
});

test("all source sheets are available with lazy cell inspection and complete exports", async ({
  page,
}) => {
  await openView(page, "sources");
  await expect(
    page.locator(".source-grid > .panel:first-child .panel-head p"),
  ).toHaveText("All sources / independent of pillar filters");
  await expect(page.locator("[data-source]")).toHaveCount(95);
  await expect(page.locator("#source-cells")).toContainText("Project Name:");
  await page.locator("#source-search").fill("sudan-schools-hdx");
  await page.locator("[data-source]").click();
  await expect(page.locator("#source-cells")).toContainText(
    "First 200 populated rows",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#source-export").click();
  expect((await downloadPromise).suggestedFilename()).toContain("Master File");
});

test("all views fit the viewport and SVG maps have nonblank pixel output", async ({
  page,
}, testInfo) => {
  for (const view of ["overview", "gis", "tracker", "analytics", "sources"]) {
    if (view !== "overview") await openView(page, view);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(
      overflow,
      `${view} must not cause page-level horizontal scrolling`,
    ).toBe(false);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-${view}.png`,
      fullPage: true,
    });
  }
  await openView(page, "gis");
  const pixels = await page
    .locator("#gis-map .map-wrap > svg")
    .evaluate(async (svg) => {
      const xml = new XMLSerializer().serializeToString(svg);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 620;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, 900, 620);
      const data = context.getImageData(0, 0, 900, 620).data;
      let visible = 0;
      for (let index = 3; index < data.length; index += 4)
        if (data[index] > 0) visible++;
      return visible;
    });
  expect(pixels).toBeGreaterThan(20000);
});
