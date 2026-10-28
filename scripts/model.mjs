export const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
export function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = clean(value).replaceAll(",", "");
  return /^-?\d+(\.\d+)?%?$/.test(text) ? Number(text.replace("%", "")) : null;
}
export function date(value) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    return Number.isNaN(Date.parse(text)) ? null : text;
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return null;
  const result = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return new Date(result).toISOString().slice(0, 10) === result ? result : null;
}
export function coordinates(value) {
  const text = clean(value);
  const dms = [
    ...text.matchAll(
      /(\d{1,3})[°º]\s*(\d{1,2})['’′]\s*(\d+(?:\.\d+)?)["”″]?\s*([NSEW])/gi,
    ),
  ];
  let lat;
  let lon;
  if (dms.length === 2) {
    for (const match of dms) {
      const angle =
        (+match[1] + +match[2] / 60 + +match[3] / 3600) *
        (/[SW]/i.test(match[4]) ? -1 : 1);
      if (/[NS]/i.test(match[4])) lat = angle;
      else lon = angle;
    }
  } else {
    const prefix = /^N\s*[:=]?\s*\d/i.test(text);
    const north = prefix
      ? text.match(/N\s*[:=]?\s*(\d{1,2}\.\d+)/i)
      : text.match(/(\d{1,2}\.\d+)\s*N/i);
    const east = prefix
      ? text.match(/E\s*[:=]?\s*(\d{1,2}\.\d+)/i)
      : text.match(/(\d{1,2}\.\d+)\s*E/i);
    if (north && east) {
      lat = +north[1];
      lon = +east[1];
    } else {
      const pair = text.match(
        /^\s*(\d{1,2}\.\d+)\s*[,;\s]\s*(\d{1,2}\.\d+)\s*$/,
      );
      if (pair) {
        lat = +pair[1];
        lon = +pair[2];
      }
    }
  }
  return lat >= 8 && lat <= 23.5 && lon >= 21 && lon <= 39 ? [lon, lat] : null;
}
export function stateName(value) {
  const text = clean(value).toLowerCase();
  if (/gezira|jazeera|gazeera|gazira|jazirah|جزيرة/.test(text))
    return "Al Jazirah";
  if (/gedaref|gadaref|gadarif|gedarif|قضارف/.test(text)) return "Al Qadarif";
  if (/red\s*sea|redsae|بحر الأحمر/.test(text)) return "Red Sea";
  if (/river\s*nile|نهر النيل/.test(text)) return "River Nile";
  if (/white\s*nile|النيل الأبيض/.test(text)) return "White Nile";
  if (/kassala|كسلا/.test(text)) return "Kassala";
  if (/sennar|سنار/.test(text)) return "Sennar";
  return clean(value).replace(/\s+state$/i, "");
}
export function sector(text) {
  if (/street.?light|solar light|lighting/i.test(text)) return "Energy";
  if (/school|education|classroom/i.test(text)) return "Education";
  if (
    /durable solutions|policies|strategies|solutions unit|advocacy/i.test(text)
  )
    return "Governance";
  if (/health|clinic|hospital/i.test(text)) return "Health";
  if (/irrigat|agricult|fish|seed|farmer|livestock|canal/i.test(text))
    return "Food & livelihoods";
  if (/water|wash|bore|pump/i.test(text)) return "Water & sanitation";
  if (/training|capacity|institution|committee/i.test(text))
    return "Capacity building";
  return "Recovery & resilience";
}
export function evidenceStatus(text, target, actual) {
  if (/^(completed|done|handed over|operating|operational)$/i.test(clean(text)))
    return "Completed";
  if (/delay|on hold|suspend/i.test(text)) return "Delayed";
  if (target > 0 && actual !== null && actual >= target) return "Completed";
  if (
    /ongoing|on going|in progress|under implementation/i.test(text) ||
    actual > 0
  )
    return "Active";
  if (/planned|not started|pending/i.test(text)) return "Planned";
  return "Unknown";
}
export function rag(project, asOf) {
  if (project.end && project.end < asOf && project.status !== "Completed")
    return "Red";
  if (
    !project.updated ||
    (Date.parse(asOf) - Date.parse(project.updated)) / 86400000 > 90
  )
    return "Amber";
  return project.status === "Unknown" ? "Amber" : "Green";
}
