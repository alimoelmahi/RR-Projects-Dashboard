import test from "node:test";
import assert from "node:assert/strict";
import {
  assessBeneficiaries,
  parseBeneficiaryCsv,
  partnerScores,
  selectVerificationSample,
} from "../src/beneficiary-validation.js";

const projects = [
  { id: "CERF", name: "Emergency Response", partners: "IP One", budget: 100 },
  { id: "EAA", name: "Food and Livelihoods", partners: "IP Two", budget: 300 },
];
const activities = [
  { id: "CERF-A2", projectId: "CERF", title: "Community water support", target: 10, actual: 5 },
  { id: "EAA-A1", projectId: "EAA", title: "Agricultural support", target: 20, actual: 10 },
];
const boundaries = [
  {
    type: "Feature",
    properties: { loc_en: "Gazira ALMAKA", hrpcode: "SD03001", state: "Al Jazirah" },
    geometry: {
      type: "Polygon",
      coordinates: [[[33, 14], [34, 14], [34, 15], [33, 15], [33, 14]]],
    },
  },
];
const csv = [
  "beneficiary_id,name,gender,age,phone,id_number,project_id,activity_id,partner,reporting_period,state,locality,location,latitude,longitude",
  "R1,Amina,F,25,+249 912 345 678,ID-001,CERF,CERF-A2,IP One,2026-Q3,Al Jazirah,Gazira ALMAKA,Medani,14.4,33.5",
  "R2,Mariam,Female,32,+249 912 345 678,ID-001,CERF,CERF-A2,IP One,2026-Q3,Al Jazirah,Gazira ALMAKA,Medani,14.41,33.51",
  "R3,Salma,Female,28,+249 912 345 678,ID-003,EAA,EAA-A1,IP Two,2026-Q3,Al Jazirah,Gazira ALMAKA,Medani,14.42,33.52",
  "R4,Unknown,,140,12, ,CERF,missing activity,IP One,,Al Jazirah,Gazira ALMAKA,Medani,,",
].join("\n");

test("beneficiary CSV parser links projects and activities and flags duplicate and invalid rows", () => {
  const parsed = parseBeneficiaryCsv(csv, { projects, activities, boundaries, sourceName: "ip-list.csv" });
  const records = assessBeneficiaries(parsed);
  assert.equal(records.length, 4);
  assert.equal(records[0].projectId, "CERF");
  assert.equal(records[0].activityId, "CERF-A2");
  assert.equal(records[0].gender, "Female");
  assert.ok(records[0].coordinates);
  assert.ok(records[0].issues.includes("Duplicate ID within activity"));
  assert.ok(records[0].issues.includes("Phone repeated across projects"));
  assert.ok(records[3].issues.includes("Invalid age"));
  assert.ok(records[3].issues.includes("Invalid phone format"));
  assert.ok(records[3].issues.includes("Activity not linked"));
  assert.ok(records[3].completeness < records[0].completeness);
});

test("risk sampling prioritizes flagged records and partner scores expose quality ratings", () => {
  const records = assessBeneficiaries(parseBeneficiaryCsv(csv, { projects, activities, boundaries }));
  const sample = selectVerificationSample(records, { percentage: 25, method: "risk", projects });
  assert.equal(sample.length, 1);
  assert.equal(sample[0].beneficiaryId, "R4");
  const partners = partnerScores(records);
  assert.deepEqual(partners.map((partner) => partner.partner).sort(), ["IP One", "IP Two"]);
  assert.ok(partners.every((partner) => ["High", "Medium", "Low"].includes(partner.rating)));
});
