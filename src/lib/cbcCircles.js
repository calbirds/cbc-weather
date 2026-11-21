const DATES_URL = 'https://cbc-dates.calbirds.org/data/circles.json';
const STATIC_URL = new URL('../../data/cbc_circles_merged.geojson', import.meta.url);

let cached = null;

function mdy(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${m}/${d}/${y}`;
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveDates() {
  try {
    const data = await fetchJson(DATES_URL, 8000);
    const f = data?.fields || [];
    const at = (name) => f.indexOf(name);
    const iAbbr = at('abbr'), iName = at('name'), iLat = at('lat'), iLon = at('lon'), iDate = at('date'), iStatus = at('status');
    if ([iAbbr, iName, iLat, iLon, iDate].some((i) => i < 0) || !Array.isArray(data?.circles)) return null;
    const byAbbr = new Map();
    for (const c of data.circles) {
      const abbr = String(c[iAbbr] || '').trim().toUpperCase();
      if (!abbr) continue;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(c[iDate] || '')) ? c[iDate] : '';
      byAbbr.set(abbr, { abbr, name: c[iName], lat: Number(c[iLat]), lon: Number(c[iLon]), date, status: iStatus >= 0 ? c[iStatus] : '' });
    }
    return { byAbbr, fetched: data.fetched || '' };
  } catch {
    return null;
  }
}

function applyLive(p, live, fetched) {
  const out = { ...p, dates_fetched: fetched };
  if (!live) {
    out.date = '';
    out.Cnt_dt = '';
    out.Count_Date = '';
    out.date_label = 'Not listed this season';
    out.count_status = 'not_listed';
    return out;
  }
  out.count_status = live.status || '';
  if (live.date) {
    out.date = live.date;
    out.Cnt_dt = live.date;
    out.Count_Date = mdy(live.date);
    out.date_label = mdy(live.date);
  } else {
    out.date = '';
    out.Cnt_dt = '';
    out.Count_Date = '';
    out.date_label = 'Date not set yet';
  }
  return out;
}

async function build() {
  const [base, live] = await Promise.all([
    fetchJson(STATIC_URL, 20000),
    fetchLiveDates(),
  ]);
  if (!live) return base;

  const seen = new Set();
  const features = (base?.features || []).map((f) => {
    const p = f?.properties || {};
    const abbr = String(p.Abbrev || p.Circle_Code_1 || '').trim().toUpperCase();
    seen.add(abbr);
    return { ...f, properties: applyLive(p, live.byAbbr.get(abbr), live.fetched) };
  });

  for (const c of live.byAbbr.values()) {
    if (seen.has(c.abbr) || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: applyLive({ Abbrev: c.abbr, Circle_Code_1: c.abbr, Name: c.name, Latitude: c.lat, Longitude: c.lon, BUFF_DIST: 7.5 }, c, live.fetched),
    });
  }
  return { ...base, features, datesFetched: live.fetched };
}

export function loadCbcCircles() {
  if (!cached) cached = build().catch((e) => { cached = null; throw e; });
  return cached;
}
