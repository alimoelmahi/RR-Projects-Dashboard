const ACLED_ORIGIN = "https://acleddata.com";
const ACLED_CLIENT_ID = "acled";
const TOKEN_URL = `${ACLED_ORIGIN}/oauth/token`;
const EVENTS_URL = `${ACLED_ORIGIN}/api/acled/read`;
const EVENT_FIELDS = [
  "event_id_cnty",
  "event_date",
  "event_type",
  "sub_event_type",
  "admin1",
  "admin2",
  "location",
  "latitude",
  "longitude",
  "fatalities",
];
const PAGE_SIZE = 5000;
const MAX_PAGES = 10;

export function createAcledApiClient({ username, password, fetchImpl = fetch }) {
  let accessToken = "";
  let refreshToken = "";
  let accessExpiresAt = 0;
  let refreshExpiresAt = 0;

  async function requestToken(fields) {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.access_token)
      throw new Error(`ACLED token request failed (${response.status}). Check API account access and credentials.`);
    accessToken = result.access_token;
    refreshToken = result.refresh_token ?? refreshToken;
    const now = Date.now();
    accessExpiresAt = now + Math.max(0, Number(result.expires_in ?? 86400) - 120) * 1000;
    refreshExpiresAt = now + 12 * 24 * 60 * 60 * 1000;
  }

  async function getAccessToken() {
    if (accessToken && Date.now() < accessExpiresAt) return accessToken;
    if (refreshToken && Date.now() < refreshExpiresAt) {
      try {
        await requestToken({
          refresh_token: refreshToken,
          grant_type: "refresh_token",
          client_id: ACLED_CLIENT_ID,
        });
        return accessToken;
      } catch {
        refreshToken = "";
        accessToken = "";
      }
    }
    if (!username || !password)
      throw new Error("ACLED API credentials are not configured on the server.");
    await requestToken({
      username,
      password,
      grant_type: "password",
      client_id: ACLED_CLIENT_ID,
      scope: "authenticated",
    });
    return accessToken;
  }

  async function getEvents({ start, end }) {
    const token = await getAccessToken();
    const events = [];
    let cursor = "0";
    let pageCount = 0;
    let totalCount = null;
    let lastUpdateHours = null;
    let truncated = false;

    while (cursor && pageCount < MAX_PAGES) {
      const url = new URL(EVENTS_URL);
      url.searchParams.set("_format", "json");
      url.searchParams.set("country", "Sudan");
      url.searchParams.set("event_date", `${start}|${end}`);
      url.searchParams.set("event_date_where", "BETWEEN");
      url.searchParams.set("fields", EVENT_FIELDS.join("|"));
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("with_total", "true");
      url.searchParams.set("cursor", cursor);

      const response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(45_000),
        redirect: "error",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(result?.data))
        throw new Error(`ACLED event request failed (${response.status}). Check API access and selected date range.`);
      events.push(...result.data);
      totalCount = result.total_count ?? totalCount;
      lastUpdateHours = result.last_update ?? lastUpdateHours;
      pageCount++;
      cursor = result.next_cursor ? String(result.next_cursor) : "";
    }
    if (cursor) truncated = true;
    return {
      events,
      totalCount,
      lastUpdateHours,
      pages: pageCount,
      truncated,
      start,
      end,
      fetchedAt: new Date().toISOString(),
    };
  }

  return { getEvents };
}
