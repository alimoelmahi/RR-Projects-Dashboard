import "dotenv/config";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import { createAcledApiClient } from "./scripts/acled-api.mjs";
import { createAuthApp } from "./scripts/auth-server.mjs";
import { loadSsoConfig } from "./scripts/sso-config.mjs";

const config = loadSsoConfig();
const redisClient = createClient({ url: config.redisUrl });
redisClient.on("error", () =>
  console.error("Redis session store connection failed."),
);
await redisClient.connect();

const authClient = new ConfidentialClientApplication({
  auth: {
    clientId: config.clientId,
    authority: `https://login.microsoftonline.com/${config.tenantId}`,
    clientSecret: config.clientSecret,
  },
});
const sessionStore = new RedisStore({
  client: redisClient,
  prefix: "pillar:sso:",
  ttl: 8 * 60 * 60,
});
const acledClient = config.acledUsername && config.acledPassword
  ? createAcledApiClient({
      username: config.acledUsername,
      password: config.acledPassword,
    })
  : null;
const app = createAuthApp({ config, authClient, acledClient, sessionStore });
const server = app.listen(config.port, () => {
  console.log(`Pillar Intelligence is listening on port ${config.port}.`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      if (redisClient.isOpen) await redisClient.quit();
      process.exit(0);
    });
  });
}
