export function loadSsoConfig(env = process.env) {
  const required = [
    "ENTRA_TENANT_ID",
    "ENTRA_CLIENT_ID",
    "ENTRA_CLIENT_SECRET",
    "ENTRA_REDIRECT_URI",
    "APP_ORIGIN",
    "SESSION_SECRET",
    "REDIS_URL",
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length)
    throw new Error(
      `Missing required SSO configuration: ${missing.join(", ")}`,
    );

  const tenantId = env.ENTRA_TENANT_ID.trim();
  if (
    !/^(?:[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}|[a-z\d.-]+)$/i.test(tenantId)
  )
    throw new Error(
      "ENTRA_TENANT_ID must be a tenant GUID or verified domain.",
    );
    if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(tenantId))
      throw new Error("Replace the placeholder ENTRA_TENANT_ID with the approved tenant.");
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(env.ENTRA_CLIENT_ID.trim()))
      throw new Error("ENTRA_CLIENT_ID must be the registered application GUID.");
    if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(env.ENTRA_CLIENT_ID.trim()))
      throw new Error("Replace the placeholder ENTRA_CLIENT_ID with the registered application ID.");
    if (env.ENTRA_CLIENT_SECRET === "configure-in-secret-manager")
      throw new Error("Configure ENTRA_CLIENT_SECRET through the deployment secret manager.");

  const appOrigin = new URL(env.APP_ORIGIN);
  if (appOrigin.pathname !== "/" || appOrigin.search || appOrigin.hash)
    throw new Error("APP_ORIGIN must contain only the application origin.");
  const localDevelopment = ["localhost", "127.0.0.1"].includes(
    appOrigin.hostname,
  );
  if (env.NODE_ENV === "production" && appOrigin.hostname.includes("example"))
    throw new Error("Replace the example APP_ORIGIN with the approved deployment hostname.");
  if (
    appOrigin.protocol !== "https:" &&
    !(localDevelopment && env.NODE_ENV !== "production")
  )
    throw new Error("APP_ORIGIN must use HTTPS outside local development.");

  const redirectUri = new URL(env.ENTRA_REDIRECT_URI);
  if (
    redirectUri.origin !== appOrigin.origin ||
    redirectUri.pathname !== "/auth/callback" ||
    redirectUri.search ||
    redirectUri.hash
  )
    throw new Error("ENTRA_REDIRECT_URI must be APP_ORIGIN/auth/callback.");

  if (env.SESSION_SECRET.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");

  const redisUrl = new URL(env.REDIS_URL);
  if (!["redis:", "rediss:"].includes(redisUrl.protocol))
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  if (env.NODE_ENV === "production" && redisUrl.protocol !== "rediss:")
    throw new Error("Production REDIS_URL must use TLS (rediss://).");
    if (env.NODE_ENV === "production" && redisUrl.hostname.includes("example"))
      throw new Error("Replace the example REDIS_URL with the provisioned Redis service.");
    if (env.SESSION_SECRET === "replace-with-at-least-32-random-characters")
      throw new Error("Replace SESSION_SECRET with a randomly generated secret.");

  return {
    tenantId,
    clientId: env.ENTRA_CLIENT_ID.trim(),
    clientSecret: env.ENTRA_CLIENT_SECRET,
    redirectUri: redirectUri.href,
    appOrigin: appOrigin.origin,
    sessionSecret: env.SESSION_SECRET,
    redisUrl: redisUrl.href,
    acledUsername: env.ACLED_USERNAME?.trim() ?? "",
    acledPassword: env.ACLED_PASSWORD ?? "",
    port: Number(env.PORT || 8080),
    trustProxy: env.TRUST_PROXY === "true",
    cookieSecure: appOrigin.protocol === "https:",
  };
}
