import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { CryptoProvider } from "@azure/msal-node";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scopes = ["openid", "profile", "email"];
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};
const saveSession = (request) =>
  new Promise((resolve, reject) =>
    request.session.save((error) => (error ? reject(error) : resolve())),
  );
const regenerateSession = (request) =>
  new Promise((resolve, reject) =>
    request.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
const destroySession = (request) =>
  new Promise((resolve, reject) =>
    request.session.destroy((error) => (error ? reject(error) : resolve())),
  );

export function createAuthApp({
  config,
  authClient,
  acledClient,
  sessionStore,
  distDir = path.join(root, "dist"),
  cryptoProvider = new CryptoProvider(),
}) {
  if (!config || !authClient)
    throw new Error(
      "SSO config and an Entra confidential client are required.",
    );
  if (!sessionStore && process.env.NODE_ENV === "production")
    throw new Error(
      "A shared Redis-backed session store is required in production.",
    );
  if (!fs.existsSync(path.join(distDir, "index.html")))
    throw new Error(
      `Production assets not found at ${distDir}; run npm run build first.`,
    );

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));

  const cookieName = config.cookieSecure ? "__Host-pillar.sid" : "pillar.sid";
  app.use(
    session({
      name: cookieName,
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "lax",
        path: "/",
        maxAge: sessionLifetimeMs,
      },
    }),
  );

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const authority = `https://login.microsoftonline.com/${config.tenantId}`;
  const originAllowed = (request) => {
    const origin = request.get("origin");
    return origin === config.appOrigin;
  };
  const requireCsrf = (request, response, next) => {
    if (
      !originAllowed(request) ||
      !timingSafeEqual(request.body?.csrfToken, request.session?.csrfToken)
    )
      return response.status(403).send("Request verification failed.");
    next();
  };
  const requireSession = (request, response, next) => {
    const user = request.session?.user;
    if (user?.tid === config.tenantId && user?.oid) return next();
    response.set("Cache-Control", "no-store");
    response.redirect(303, "/auth/login");
  };
  const clearAuthFlow = (request) => {
    delete request.session.authFlow;
    delete request.session.csrfToken;
  };

  app.get("/auth/login", authLimiter, async (request, response, next) => {
    try {
      if (
        request.session.user?.tid === config.tenantId &&
        request.session.user?.oid
      )
        return response.redirect(303, "/");
      request.session.csrfToken ??= crypto
        .randomBytes(32)
        .toString("base64url");
      await saveSession(request);
      response.set("Cache-Control", "no-store");
      const message = request.query.loggedOut ? "You have signed out." : "";
      response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in | Pillar Intelligence</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;color:#202a34;font:16px Arial,sans-serif}.panel{width:min(420px,calc(100% - 40px));padding:34px;background:white;border-top:5px solid #006eb5;box-shadow:0 10px 35px #1b334018}h1{font-size:25px;margin:0 0 10px}p{font-size:14px;line-height:1.6;color:#586674}button{margin-top:14px;width:100%;padding:14px;background:#006eb5;color:white;border:0;font-size:14px;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #e6007e;outline-offset:3px}.error{color:#ae2c4a}</style></head><body><main class="panel"><h1>Sign in to Pillar Intelligence</h1><p>Use your authorized UNDP account to continue.</p>${message ? `<p>${message}</p>` : ""}<form method="post" action="/auth/login"><input type="hidden" name="csrfToken" value="${request.session.csrfToken}"><button type="submit">Continue with UNDP account</button></form></main></body></html>`);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/auth/login",
    authLimiter,
    requireCsrf,
    async (request, response, next) => {
      try {
        const pkce = await cryptoProvider.generatePkceCodes();
        const state = crypto.randomBytes(32).toString("base64url");
        const nonce = crypto.randomBytes(32).toString("base64url");
        request.session.authFlow = {
          state,
          nonce,
          codeVerifier: pkce.verifier,
          createdAt: Date.now(),
        };
        await saveSession(request);
        const authorizationUrl = await authClient.getAuthCodeUrl({
          scopes,
          redirectUri: config.redirectUri,
          responseMode: "query",
          state,
          nonce,
          codeChallenge: pkce.challenge,
          codeChallengeMethod: "S256",
          prompt: "select_account",
        });
        response.redirect(302, authorizationUrl);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/auth/callback", authLimiter, async (request, response, next) => {
    try {
      const flow = request.session.authFlow;
      const stateMatches =
        flow && timingSafeEqual(request.query.state, flow.state);
      if (!stateMatches || Date.now() - flow.createdAt > 10 * 60 * 1000) {
        clearAuthFlow(request);
        await saveSession(request);
        return response
          .status(400)
          .send("Sign-in could not be verified. Please start again.");
      }
      if (request.query.error || typeof request.query.code !== "string") {
        clearAuthFlow(request);
        await saveSession(request);
        return response
          .status(401)
          .send("UNDP sign-in was not completed. Please try again.");
      }
      const result = await authClient.acquireTokenByCode({
        code: request.query.code,
        scopes,
        redirectUri: config.redirectUri,
        codeVerifier: flow.codeVerifier,
        nonce: flow.nonce,
        state: flow.state,
      });
      const claims = result?.idTokenClaims;
      if (claims?.tid !== config.tenantId || typeof claims?.oid !== "string") {
        clearAuthFlow(request);
        await saveSession(request);
        return response
          .status(403)
          .send("This account is not authorized for this UNDP tenant.");
      }
      const user = {
        tid: claims.tid,
        oid: claims.oid,
        name: typeof claims.name === "string" ? claims.name : "UNDP user",
        username:
          typeof claims.preferred_username === "string"
            ? claims.preferred_username
            : "",
      };
      await regenerateSession(request);
      request.session.user = user;
      request.session.csrfToken = crypto.randomBytes(32).toString("base64url");
      await saveSession(request);
      response.redirect(303, "/");
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/session", requireSession, (request, response) => {
    response.set("Cache-Control", "no-store").json({
      user: request.session.user,
      csrfToken: request.session.csrfToken,
    });
  });

  app.get(
    "/api/acled/events",
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false }),
    requireSession,
    async (request, response) => {
      response.set("Cache-Control", "no-store");
      if (!acledClient)
        return response.status(503).json({
          code: "acled_api_not_configured",
          error: "Direct ACLED API access is not configured on this server.",
        });
      const { start, end } = request.query;
      const validDate = (value) => {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
          return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
      };
      if (!validDate(start) || !validDate(end) || start > end)
        return response.status(400).json({
          code: "invalid_date_range",
          error: "Provide a valid start and end date as YYYY-MM-DD.",
        });
      if ((Date.parse(end) - Date.parse(start)) / 86400000 > 366 * 10)
        return response.status(400).json({
          code: "date_range_too_large",
          error: "ACLED date range is limited to ten years per request.",
        });
      try {
        const result = await acledClient.getEvents({ start, end });
        return response.json(result);
      } catch (error) {
        console.error("ACLED API request failed:", error.message);
        return response.status(502).json({
          code: "acled_api_request_failed",
          error: "ACLED API request failed. Check the server API account access and selected date range.",
        });
      }
    },
  );

  app.post(
    "/auth/logout",
    requireSession,
    requireCsrf,
    async (request, response, next) => {
      try {
        await destroySession(request);
        response.clearCookie(cookieName, {
          httpOnly: true,
          secure: config.cookieSecure,
          sameSite: "lax",
          path: "/",
        });
        const logoutUrl = new URL(`${authority}/oauth2/v2.0/logout`);
        logoutUrl.searchParams.set(
          "post_logout_redirect_uri",
          `${config.appOrigin}/auth/login?loggedOut=1`,
        );
        response.redirect(303, logoutUrl.href);
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(requireSession);
  app.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.static(distDir, { index: false, fallthrough: true }));
  app.get("/", (request, response) =>
    response.sendFile(path.join(distDir, "index.html")),
  );
  app.get(/.*/, (request, response) =>
    response.sendFile(path.join(distDir, "index.html")),
  );
  app.use((error, request, response, _next) => {
    console.error("SSO request failed:", error.message);
    if (response.headersSent) return;
    response
      .status(500)
      .send("The sign-in service is temporarily unavailable.");
  });
  return app;
}
