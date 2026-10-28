import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import session from "express-session";
import request from "supertest";
import { createAuthApp } from "../scripts/auth-server.mjs";
import { loadSsoConfig } from "../scripts/sso-config.mjs";

const tenantId = "11111111-2222-3333-4444-555555555555";
const baseEnv = {
  NODE_ENV: "test",
  ENTRA_TENANT_ID: tenantId,
  ENTRA_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  ENTRA_CLIENT_SECRET: "test-only-secret-not-a-real-credential",
  ENTRA_REDIRECT_URI: "http://127.0.0.1:8080/auth/callback",
  APP_ORIGIN: "http://127.0.0.1:8080",
  SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
  REDIS_URL: "rediss://redis.example.invalid:6380",
};
const config = loadSsoConfig(baseEnv);

async function fixture({ acledClient } = {}) {
  const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "pillar-auth-"));
  await fs.mkdir(path.join(distDir, "data"));
  await fs.writeFile(
    path.join(distDir, "index.html"),
    "<h1>Authenticated app</h1>",
  );
  await fs.writeFile(
    path.join(distDir, "data", "model.json"),
    '{"protected":true}',
  );
  let authRequest;
  let codeRequest;
  let claims = {
    tid: tenantId,
    oid: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    name: "UNDP Test User",
    preferred_username: "user@example.undp.org",
  };
  const authClient = {
    getAuthCodeUrl: async (value) => {
      authRequest = value;
      return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?state=${value.state}`;
    },
    acquireTokenByCode: async (value) => {
      codeRequest = value;
      return { idTokenClaims: claims };
    },
  };
  const app = createAuthApp({
    config,
    authClient,
    acledClient,
    sessionStore: new session.MemoryStore(),
    distDir,
    cryptoProvider: {
      generatePkceCodes: async () => ({
        verifier: "test-pkce-verifier",
        challenge: "test-pkce-challenge",
      }),
    },
  });
  return {
    app,
    distDir,
    getAuthRequest: () => authRequest,
    getCodeRequest: () => codeRequest,
    setClaims: (next) => {
      claims = next;
    },
    cleanup: () => fs.rm(distDir, { recursive: true, force: true }),
  };
}

async function csrfToken(agent) {
  const response = await agent.get("/auth/login").expect(200);
  const token = response.text.match(/name="csrfToken" value="([^"]+)"/)?.[1];
  assert.ok(token, "login form contains a CSRF token");
  return token;
}

async function signIn(agent, fixtureState) {
  const csrf = await csrfToken(agent);
  await agent
    .post("/auth/login")
    .set("Origin", config.appOrigin)
    .type("form")
    .send({ csrfToken: csrf })
    .expect(302);
  const authRequest = fixtureState.getAuthRequest();
  await agent
    .get("/auth/callback")
    .query({ code: "test-authorization-code", state: authRequest.state })
    .expect(303);
}

test("SSO configuration fails closed on missing credentials and unsafe origins", () => {
  assert.throws(() => loadSsoConfig({}), /Missing required SSO configuration/);
  assert.throws(
    () =>
      loadSsoConfig({
        ...baseEnv,
        NODE_ENV: "production",
        APP_ORIGIN: "http://pillar.undp.org",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      loadSsoConfig({
        ...baseEnv,
        ENTRA_REDIRECT_URI: "http://127.0.0.1:8080/other",
      }),
    /ENTRA_REDIRECT_URI/,
  );
  assert.throws(
    () => loadSsoConfig({ ...baseEnv, SESSION_SECRET: "short" }),
    /at least 32 characters/,
  );
  assert.throws(
    () => loadSsoConfig({ ...baseEnv, ENTRA_TENANT_ID: "00000000-0000-0000-0000-000000000000" }),
    /placeholder ENTRA_TENANT_ID/,
  );
  assert.throws(
    () => loadSsoConfig({ ...baseEnv, ENTRA_CLIENT_SECRET: "configure-in-secret-manager" }),
    /Configure ENTRA_CLIENT_SECRET/,
  );
  assert.throws(
    () => loadSsoConfig({ ...baseEnv, NODE_ENV: "production", APP_ORIGIN: "https://pillar.example.undp.org", ENTRA_REDIRECT_URI: "https://pillar.example.undp.org/auth/callback", REDIS_URL: "rediss://redis.example.internal:6380" }),
    /example APP_ORIGIN/,
  );
});

test("unauthenticated users cannot read the app shell or GIS data", async (t) => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const agent = request.agent(fx.app);
  await agent.get("/").expect(303).expect("Location", "/auth/login");
  await agent
    .get("/data/model.json")
    .expect(303)
    .expect("Location", "/auth/login");
  const login = await agent.get("/auth/login").expect(200);
  assert.match(login.text, /Continue with UNDP account/);
  assert.match(login.headers["cache-control"], /no-store/);
});

test("authorization-code sign-in uses PKCE, state, nonce, tenant restriction and protects files", async (t) => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const agent = request.agent(fx.app);
  const csrf = await csrfToken(agent);
  const login = await agent
    .post("/auth/login")
    .set("Origin", config.appOrigin)
    .type("form")
    .send({ csrfToken: csrf })
    .expect(302);
  assert.match(
    login.headers.location,
    /^https:\/\/login\.microsoftonline\.com\//,
  );
  const authorization = fx.getAuthRequest();
  assert.equal(authorization.codeChallenge, "test-pkce-challenge");
  assert.equal(authorization.codeChallengeMethod, "S256");
  assert.equal(authorization.prompt, "select_account");

  await agent
    .get("/auth/callback")
    .query({ code: "test-authorization-code", state: authorization.state })
    .expect(303)
    .expect("Location", "/");
  const codeRequest = fx.getCodeRequest();
  assert.equal(codeRequest.codeVerifier, "test-pkce-verifier");
  assert.equal(codeRequest.nonce, authorization.nonce);
  assert.equal(codeRequest.state, authorization.state);
  await agent
    .get("/auth/session")
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.user.name, "UNDP Test User");
      assert.equal(body.user.tid, tenantId);
      assert.ok(body.csrfToken);
    });
  await agent
    .get("/data/model.json")
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.protected, true);
    });

  const currentCsrf = (await agent.get("/auth/session")).body.csrfToken;
  const logout = await agent
    .post("/auth/logout")
    .set("Origin", config.appOrigin)
    .type("form")
    .send({ csrfToken: currentCsrf })
    .expect(303);
  assert.match(logout.headers.location, /login\.microsoftonline\.com.*logout/);
  await agent
    .get("/data/model.json")
    .expect(303)
    .expect("Location", "/auth/login");
});

test("login rejects cross-origin, missing-CSRF and mismatched-state requests", async (t) => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const agent = request.agent(fx.app);
  const csrf = await csrfToken(agent);
  await agent
    .post("/auth/login")
    .set("Origin", "https://attacker.example")
    .type("form")
    .send({ csrfToken: csrf })
    .expect(403);
  await agent
    .post("/auth/login")
    .set("Origin", config.appOrigin)
    .type("form")
    .send({ csrfToken: "wrong-token" })
    .expect(403);
  await agent
    .post("/auth/login")
    .set("Origin", config.appOrigin)
    .type("form")
    .send({ csrfToken: csrf })
    .expect(302);
  await agent
    .get("/auth/callback")
    .query({ code: "test-code", state: "wrong-state" })
    .expect(400);
  assert.equal(fx.getCodeRequest(), undefined);
});

test("accounts from a different Entra tenant are rejected", async (t) => {
  const fx = await fixture();
  t.after(fx.cleanup);
  fx.setClaims({
    tid: "99999999-8888-7777-6666-555555555555",
    oid: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    name: "Other Tenant User",
  });
  const agent = request.agent(fx.app);
  const csrf = await csrfToken(agent);
  await agent
    .post("/auth/login")
    .set("Origin", config.appOrigin)
    .type("form")
    .send({ csrfToken: csrf })
    .expect(302);
  const authorization = fx.getAuthRequest();
  await agent
    .get("/auth/callback")
    .query({ code: "test-code", state: authorization.state })
    .expect(403);
  await agent
    .get("/data/model.json")
    .expect(303)
    .expect("Location", "/auth/login");
});

test("ACLED API proxy requires SSO, validates date range and returns server-fetched events", async (t) => {
  const calls = [];
  const acledClient = {
    getEvents: async (range) => {
      calls.push(range);
      return {
        events: [{ event_id_cnty: "SDN-1", event_date: range.start, event_type: "Battles" }],
        totalCount: 1,
        pages: 1,
        truncated: false,
        ...range,
      };
    },
  };
  const fx = await fixture({ acledClient });
  t.after(fx.cleanup);
  const agent = request.agent(fx.app);
  await agent
    .get("/api/acled/events")
    .query({ start: "2026-01-01", end: "2026-01-31" })
    .expect(303)
    .expect("Location", "/auth/login");
  await signIn(agent, fx);
  await agent
    .get("/api/acled/events")
    .query({ start: "2026-02-31", end: "2026-03-01" })
    .expect(400);
  await agent
    .get("/api/acled/events")
    .query({ start: "2026-01-01", end: "2026-01-31" })
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.events[0].event_type, "Battles");
      assert.equal(body.start, "2026-01-01");
    });
  assert.deepEqual(calls, [{ start: "2026-01-01", end: "2026-01-31" }]);
});

test("ACLED endpoint reports missing server credentials without exposing secrets", async (t) => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const agent = request.agent(fx.app);
  await signIn(agent, fx);
  await agent
    .get("/api/acled/events")
    .query({ start: "2026-01-01", end: "2026-01-31" })
    .expect(503)
    .expect(({ body }) => {
      assert.equal(body.code, "acled_api_not_configured");
      assert.doesNotMatch(JSON.stringify(body), /clientSecret|password/i);
    });
});
