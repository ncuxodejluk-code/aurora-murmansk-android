// Источники данных и разбор ответов в компактный вид.
// Все адреса перечислены в manifest.json (host_permissions), поэтому разрешение
// запрашивается один раз — при установке расширения.

import { parseTime, flareFlux } from './model.js';

const NOAA = 'https://services.swpc.noaa.gov';
const DONKI = 'https://ccmc.gsfc.nasa.gov/DONKI-API/get';
const METEO = 'https://api.open-meteo.com/v1/forecast';
// Запасной источник облачности — Норвежский метеоинститут (на нём работает yr.no).
const METNO = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const HOUR = 3600000;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const GROUPS = {
  noaa: { name: 'NOAA SWPC', url: 'https://www.swpc.noaa.gov/' },
  nasa: { name: 'NASA DONKI', url: 'https://ccmc.gsfc.nasa.gov/DONKI/' },
  meteo: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
  metno: { name: 'MET Norway', url: 'https://www.met.no/' },
};

// ───────────── Разбор ответов ─────────────

export function extractFlares(json) {
  return (Array.isArray(json) ? json : [])
    .map((f) => ({
      begin: parseTime(f.begin_time),
      peak: parseTime(f.max_time) ?? parseTime(f.begin_time),
      end: parseTime(f.end_time),
      cls: f.max_class || f.begin_class || '',
      flux: finite(f.max_xrlong) ? f.max_xrlong : flareFlux(f.max_class || f.begin_class),
    }))
    .filter((f) => f.peak && f.cls);
}

/** Прогноз Kp на 3 суток. Поддерживает и новый формат (объекты), и старый (таблица с заголовком). */
export function extractKpForecast(json) {
  if (!Array.isArray(json) || !json.length) return [];
  let rows = json;
  if (Array.isArray(json[0])) {
    const head = json[0].map((h) => String(h).toLowerCase());
    const it = head.indexOf('time_tag');
    const ik = head.indexOf('kp');
    const io = head.indexOf('observed');
    rows = json.slice(1).map((r) => ({ time_tag: r[it], kp: r[ik], observed: r[io] }));
  }
  return rows
    .map((r) => ({ t: parseTime(r.time_tag), kp: Number(r.kp), kind: r.observed || 'predicted', scale: r.noaa_scale || null }))
    .filter((r) => r.t && finite(r.kp))
    .sort((a, b) => a.t - b.t);
}

/** Минутная оценка Kp: берём максимум за последние 45 минут (индекс «обнуляется» каждые 3 часа). */
export function extractKpNow(json) {
  const rows = (Array.isArray(json) ? json : [])
    .map((r) => ({ t: parseTime(r.time_tag), kp: Number(r.estimated_kp ?? r.kp_index) }))
    .filter((r) => r.t && finite(r.kp));
  if (!rows.length) return null;
  const last = Math.max(...rows.map((r) => r.t));
  const recent = rows.filter((r) => r.t >= last - 45 * 60000);
  return { t: last, kp: Math.max(...recent.map((r) => r.kp)) };
}

function activeSorted(json) {
  const rows = (Array.isArray(json) ? json : []).filter((r) => r && typeof r === 'object');
  const act = rows.filter((r) => r.active === true);
  return (act.length ? act : rows)
    .map((r) => ({ ...r, t: parseTime(r.time_tag) }))
    .filter((r) => r.t)
    .sort((a, b) => b.t - a.t);
}

/** Солнечный ветер в точке L1: Bz и полное поле — среднее за 15 минут, скорость и плотность — тоже. */
export function extractWind(magJson, plasmaJson) {
  const mag = activeSorted(magJson);
  const pla = activeSorted(plasmaJson);
  if (!mag.length && !pla.length) return null;
  const pick = (rows, key, minutes) => {
    if (!rows.length) return null;
    const lim = rows[0].t - minutes * 60000;
    return mean(rows.filter((r) => r.t >= lim && finite(r[key])).map((r) => r[key]));
  };
  const t = Math.max(mag[0]?.t ?? 0, pla[0]?.t ?? 0);
  const bzSeries = [];
  if (mag.length) {
    const lim = mag[0].t - 120 * 60000;
    for (const r of mag) if (r.t >= lim && finite(r.bz_gsm)) bzSeries.push([r.t, r.bz_gsm]);
  }
  const last60 = bzSeries.filter(([tt]) => tt >= t - 60 * 60000).map(([, v]) => v);
  return {
    t,
    bz: pick(mag, 'bz_gsm', 15),
    bt: pick(mag, 'bt', 15),
    speed: pick(pla, 'proton_speed', 15),
    density: pick(pla, 'proton_density', 15),
    bzMin60: last60.length ? Math.min(...last60) : null,
  };
}

/** OVATION: вероятность сияния над точкой и чуть севернее (сияние видно и у горизонта). */
export function extractOvation(json, lat, lon) {
  const coords = json?.coordinates;
  if (!Array.isArray(coords)) return null;
  const grid = new Map();
  for (const c of coords) grid.set(`${c[0]},${c[1]}`, c[2]);
  const L = Math.round(((lon % 360) + 360) % 360);
  const B = Math.round(lat);
  const at = (l, b) => grid.get(`${((l % 360) + 360) % 360},${b}`);
  const local = at(L, B) ?? null;
  let north = local ?? 0;
  const dir = lat >= 0 ? 1 : -1;
  for (let db = 0; db <= 4; db++) for (let dl = -3; dl <= 3; dl++) {
    const v = at(L + dl, B + dir * db);
    if (finite(v) && v > north) north = v;
  }
  return {
    observationTime: parseTime(json['Observation Time']),
    forecastTime: parseTime(json['Forecast Time']),
    local,
    north,
    view: Math.max(local ?? 0, north * 0.8),
  };
}

export function extractDonkiFlr(json) {
  return (Array.isArray(json) ? json : []).map((f) => ({
    id: f.flrID,
    begin: parseTime(f.beginTime),
    peak: parseTime(f.peakTime) ?? parseTime(f.beginTime),
    cls: f.classType || '',
    source: f.sourceLocation || '',
    region: f.activeRegionNum ?? null,
    linked: (f.linkedEvents || []).map((e) => e.activityID),
    link: f.link || null,
  }));
}

export function extractDonkiCme(json) {
  return (Array.isArray(json) ? json : []).map((c) => ({
    id: c.activityID,
    start: parseTime(c.startTime),
    source: c.sourceLocation || '',
    linked: (c.linkedEvents || []).map((e) => e.activityID),
    link: c.link || null,
    analyses: (c.cmeAnalyses || []).map((a) => ({
      mostAccurate: !!a.isMostAccurate,
      time21_5: parseTime(a.time21_5),
      lat: a.latitude,
      lon: a.longitude,
      halfAngle: a.halfAngle,
      speed: a.speed,
      type: a.type,
      enlil: (a.enlilList || []).map((r) => ({
        id: String(r.link || '').match(/WSA-ENLIL\/(\d+)/)?.[1] || r.modelCompletionTime,
        completed: parseTime(r.modelCompletionTime),
        arrival: parseTime(r.estimatedShockArrivalTime),
        glancing: !!r.isEarthGB,
        minor: !!r.isEarthMinorImpact,
        kp90: r.kp_90,
        kp135: r.kp_135,
        kp180: r.kp_180,
        duration: r.estimatedDuration,
        link: r.link || null,
      })),
    })),
  }));
}

export function extractClouds(json) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time)) return null;
  const vals = h.cloud_cover || h.cloudcover || [];
  return {
    hours: h.time
      .map((t, i) => ({ t: typeof t === 'number' ? t * 1000 : parseTime(t), c: vals[i] }))
      .filter((r) => r.t && finite(r.c)),
  };
}

/** Прогноз MET Norway: почасовой на 2–3 суток, дальше через 6 часов — дополняем до почасового. */
export function extractMetNo(json) {
  const ts = json?.properties?.timeseries;
  if (!Array.isArray(ts)) return null;
  const pts = ts
    .map((r) => ({ t: parseTime(r?.time), c: r?.data?.instant?.details?.cloud_area_fraction }))
    .filter((p) => p.t && finite(p.c))
    .sort((a, b) => a.t - b.t);
  const hours = [];
  pts.forEach((p, i) => {
    hours.push(p);
    const next = pts[i + 1];
    if (!next || next.t - p.t <= HOUR || next.t - p.t > 6 * HOUR) return;
    for (let t = p.t + HOUR; t < next.t; t += HOUR) {
      hours.push({ t, c: Math.round(p.c + ((next.c - p.c) * (t - p.t)) / (next.t - p.t)) });
    }
  });
  return { hours };
}

/**
 * Облачность: сначала Open-Meteo, если он не отвечает — MET Norway.
 * Запоминается, какой источник сработал в прошлый раз, и он пробуется первым.
 */
async function loadClouds(now, s, prev) {
  const lat = s.location.lat.toFixed(3);
  const lon = s.location.lon.toFixed(3);
  const providers = {
    meteo: async (timeout) =>
      extractClouds(
        await fetchJson(
          `${METEO}?latitude=${lat}&longitude=${lon}&hourly=cloud_cover&timeformat=unixtime&timezone=GMT&past_days=1&forecast_days=4`,
          timeout,
        ),
      ),
    metno: async (timeout) => extractMetNo(await fetchJson(`${METNO}?lat=${lat}&lon=${lon}`, timeout)),
  };
  const order = prev?.data?.provider === 'metno' ? ['metno', 'meteo'] : ['meteo', 'metno'];
  const errors = [];
  for (const [i, key] of order.entries()) {
    try {
      // Первый источник ждём недолго, чтобы при блокировке быстрее перейти к запасному.
      const data = await providers[key](i === 0 ? 15000 : 25000);
      if (!data?.hours?.length) throw new Error('в ответе нет нужных данных');
      if (errors.length) {
        console.info(`облачность: ${errors.map((x) => `${x.name} — ${x.msg}`).join('; ')}; взята у ${GROUPS[key].name}`);
      }
      return { ...data, provider: key };
    } catch (e) {
      errors.push({ name: GROUPS[key].name, msg: e.message });
    }
  }
  const same = errors.every((x) => x.msg === errors[0].msg);
  throw new Error(
    same
      ? `${errors[0].msg} — ни ${errors.map((x) => x.name).join(', ни ')} не ответили`
      : errors.map((x) => `${x.name} — ${x.msg}`).join('; '),
  );
}

// ───────────── Описание источников ─────────────

export const SOURCES = [
  { key: 'flares', group: 'noaa', label: 'вспышки', url: () => `${NOAA}/json/goes/primary/xray-flares-7-day.json`, parse: (j) => extractFlares(j) },
  { key: 'kpForecast', group: 'noaa', label: 'прогноз Kp', url: () => `${NOAA}/products/noaa-planetary-k-index-forecast.json`, parse: (j) => extractKpForecast(j) },
  { key: 'kpNow', group: 'noaa', label: 'Kp сейчас', url: () => `${NOAA}/json/planetary_k_index_1m.json`, parse: (j) => extractKpNow(j) },
  {
    key: 'wind',
    group: 'noaa',
    label: 'солнечный ветер',
    url: () => [`${NOAA}/json/rtsw/rtsw_mag_1m.json`, `${NOAA}/json/rtsw/rtsw_wind_1m.json`],
    parse: ([mag, plasma]) => extractWind(mag, plasma),
  },
  {
    key: 'ovation',
    group: 'noaa',
    label: 'овал сияния',
    perLocation: true,
    url: () => `${NOAA}/json/ovation_aurora_latest.json`,
    parse: (j, s) => extractOvation(j, s.location.lat, s.location.lon),
  },
  {
    key: 'donkiFlr',
    group: 'nasa',
    label: 'вспышки (NASA)',
    url: (now) => `${DONKI}/FLR?startDate=${ymd(now - 7 * 86400000)}&endDate=${ymd(now + 86400000)}`,
    parse: (j) => extractDonkiFlr(j),
  },
  {
    key: 'cmes',
    group: 'nasa',
    label: 'выбросы и модель WSA-ENLIL',
    url: (now) => `${DONKI}/CME?startDate=${ymd(now - 7 * 86400000)}&endDate=${ymd(now + 86400000)}`,
    parse: (j) => extractDonkiCme(j),
  },
  {
    key: 'clouds',
    group: 'meteo',
    label: 'облачность',
    perLocation: true,
    enabled: (s) => s.useClouds,
    load: loadClouds,
  },
];

export async function fetchJson(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
    const text = await res.text();
    // DONKI на пустой период отвечает пустым телом — это «событий нет», а не ошибка.
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`сервер не ответил за ${Math.round(timeoutMs / 1000)} с`);
    if (e instanceof SyntaxError) throw new Error('пришли повреждённые данные');
    if (e instanceof TypeError) throw new Error('нет связи с сервером');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Группа для подвала: облачность могла прийти из запасного источника. */
export const groupOf = (src, data) => (data?.provider && GROUPS[data.provider] ? data.provider : src.group);

/** Загружает один источник: возвращает разобранные данные или бросает понятную ошибку. prev — прошлые данные источника. */
export async function loadSource(src, now, settings, prev) {
  if (src.load) return src.load(now, settings, prev);
  const url = src.url(now, settings);
  const json = Array.isArray(url) ? await Promise.all(url.map((u) => fetchJson(u))) : await fetchJson(url);
  const data = src.parse(json, settings);
  if (data == null || (Array.isArray(data) && !data.length && src.key !== 'flares' && src.key !== 'donkiFlr' && src.key !== 'cmes')) {
    throw new Error('в ответе нет нужных данных');
  }
  return data;
}
