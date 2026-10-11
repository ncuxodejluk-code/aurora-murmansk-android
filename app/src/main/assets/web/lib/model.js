// Расчётная часть: вспышки → выбросы → прилёт к Земле → окна наблюдения.
// Все функции чистые (без chrome.*), поэтому их можно проверять в Node.

import { sunAltitude, darkness, darkIntervals } from './astro.js';

export const HOUR = 3600000;
const DAY = 24 * HOUR;
const MURMANSK_LAT = 68.9585;

// ───────────── Общие утилиты ─────────────

export function parseTime(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) t += 'Z';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

const floorHour = (ms) => Math.floor(ms / HOUR) * HOUR;
const mod = (a, b) => ((a % b) + b) % b;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ───────────── Вспышки ─────────────

const CLASS_BASE = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };

/** 'M6.7' → 6.7e-5 Вт/м² */
export function flareFlux(cls) {
  const m = /^([ABCMX])\s*(\d+(?:\.\d+)?)/i.exec(cls || '');
  return m ? CLASS_BASE[m[1].toUpperCase()] * parseFloat(m[2]) : 0;
}

/** 'N12W20' → {lat: 12, lon: 20}; восток — отрицательная долгота (от центра диска). */
export function parseLocation(loc) {
  const m = /^([NS])(\d{1,2})([EW])(\d{1,3})$/i.exec(String(loc || '').trim());
  if (!m) return null;
  return {
    lat: (m[1].toUpperCase() === 'S' ? -1 : 1) * Number(m[2]),
    lon: (m[3].toUpperCase() === 'E' ? -1 : 1) * Number(m[4]),
  };
}

// ───────────── Выбросы (CME) ─────────────

const KIND_RANK = { hit: 5, glancing: 4, minor: 3, unknown: 2, miss: 1 };

/** Геометрия: заденет ли выброс Землю (направление в гелиографических координатах, Земля — 0,0). */
export function earthGeometry(lat, lon, halfAngle) {
  if (!finite(lat) || !finite(lon)) return 'unknown';
  const rad = Math.PI / 180;
  const sep = Math.acos(Math.cos(lat * rad) * Math.cos(lon * rad)) / rad;
  const width = finite(halfAngle) ? halfAngle : 30;
  if (sep <= width) return 'hit';
  if (sep <= width + 15) return 'glancing';
  return 'miss';
}

/**
 * Модель торможения выброса в солнечном ветре (drag-based model, Vršnak и др., 2013).
 * start — момент, когда фронт на 21.5 радиусах Солнца; v0 — скорость, км/с.
 */
export function dbmArrival(start, v0, w = 400, gamma = 0.1e-7) {
  const AU = 149.6e6;
  let r = 21.5 * 695700;
  let v = v0;
  const dt = 300;
  let t = 0;
  while (r < AU && t < 7 * 86400) {
    const dv = v - w;
    v -= gamma * dv * Math.abs(dv) * dt;
    r += v * dt;
    t += dt;
  }
  return r >= AU ? start + t * 1000 : null;
}

function kpFromSpeed(speed, kind) {
  let kp = speed >= 1200 ? 7 : speed >= 800 ? 6 : speed >= 500 ? 5 : 4;
  if (kind !== 'hit') kp -= 1;
  return [kp - 1, kp];
}

/** Время прибытия ударной волны, если в связях выброса есть зарегистрированная IPS. */
function arrivedFromLinks(cme) {
  const ips = (cme.linked || []).filter((id) => /-IPS-/.test(id)).map((id) => parseTime(id.slice(0, 19)));
  const ok = ips.filter(finite).filter((t) => t > cme.start);
  return ok.length ? Math.min(...ok) : null;
}

/** Прогноз по одному выбросу: последний прогон WSA-ENLIL, иначе — геометрия + модель торможения. */
export function predictCme(cme) {
  const arrivedAt = arrivedFromLinks(cme);
  const runs = new Map();
  for (const a of cme.analyses || []) for (const r of a.enlil || []) runs.set(r.id, r);
  const latest = [...runs.values()].sort((a, b) => (b.completed || 0) - (a.completed || 0))[0];

  if (latest) {
    if (!latest.arrival) return { kind: 'miss', method: 'enlil', key: `run:${latest.id}`, link: latest.link, arrivedAt };
    const kps = [latest.kp90, latest.kp135, latest.kp180].filter(finite);
    const kind = latest.glancing ? 'glancing' : latest.minor ? 'minor' : 'hit';
    const typical = kind === 'hit' ? latest.kp135 ?? latest.kp90 : latest.kp90 ?? latest.kp135;
    return {
      kind,
      method: 'enlil',
      key: `run:${latest.id}`,
      arrival: latest.arrival,
      errH: 8,
      kpRange: kps.length ? [Math.min(...kps), Math.max(...kps)] : null,
      kpTypical: finite(typical) ? typical : kps.length ? Math.min(...kps) : 3,
      durationH: finite(latest.duration) ? latest.duration : 18,
      link: latest.link,
      arrivedAt,
    };
  }

  const a =
    (cme.analyses || []).find((x) => x.mostAccurate && finite(x.speed) && finite(x.lon)) ||
    (cme.analyses || []).find((x) => finite(x.speed));
  if (!a) return { kind: 'unknown', method: 'none', key: `cme:${cme.id}`, arrivedAt };
  const kind = earthGeometry(a.lat, a.lon, a.halfAngle);
  if (kind === 'miss' || kind === 'unknown') return { kind, method: 'geometry', key: `cme:${cme.id}`, arrivedAt };
  const arrival = dbmArrival(a.time21_5 ?? cme.start, a.speed);
  if (!arrival) return { kind: 'miss', method: 'dbm', key: `cme:${cme.id}`, arrivedAt };
  const kpRange = kpFromSpeed(a.speed, kind);
  return {
    kind,
    method: 'dbm',
    key: `cme:${cme.id}`,
    arrival,
    errH: 12,
    kpRange,
    kpTypical: kpRange[1],
    durationH: 18,
    speed: a.speed,
    arrivedAt,
  };
}

const betterPrediction = (a, b) => ((KIND_RANK[b?.kind] || 0) > (KIND_RANK[a?.kind] || 0) ? b : a);

/** Окно, в течение которого выброс может влиять на магнитосферу. */
export function arrivalSpan(p) {
  if (!p || !p.arrival) return null;
  const err = p.errH * HOUR;
  if (p.arrivedAt) return { start: p.arrivedAt, end: p.arrivedAt + p.durationH * HOUR, center: p.arrivedAt, observed: true };
  return { start: p.arrival - err, end: p.arrival + p.durationH * HOUR + err / 2, center: p.arrival, observed: false };
}

/** Добавка к Kp от ожидаемого (ещё не пришедшего) выброса в момент ms. */
function arrivalKpAt(arrivals, ms) {
  let best = null;
  for (const p of arrivals) {
    if (p.arrivedAt || !p.arrival || p.kind === 'miss') continue;
    const err = p.errH * HOUR;
    const dur = p.durationH * HOUR;
    let kp = null;
    if (ms >= p.arrival - err && ms < p.arrival) kp = p.kpTypical - 1;
    else if (ms >= p.arrival && ms <= p.arrival + dur * 0.6) kp = p.kpTypical;
    else if (ms > p.arrival + dur * 0.6 && ms <= p.arrival + dur + err / 2) kp = p.kpTypical - 1;
    if (kp != null && (best == null || kp > best)) best = kp;
  }
  return best;
}

// ───────────── Видимость в Мурманске ─────────────

// Вероятность увидеть сияние при ясном тёмном небе в зависимости от Kp (эмпирика для 69° с. ш.).
const KP_CURVE = [
  [0, 0.08], [1, 0.22], [2, 0.45], [3, 0.68], [4, 0.84], [5, 0.93], [6, 0.97], [9, 0.99],
];

export function kpVisibility(kp) {
  if (!finite(kp)) return 0;
  if (kp <= KP_CURVE[0][0]) return KP_CURVE[0][1];
  for (let i = 1; i < KP_CURVE.length; i++) {
    const [k1, p1] = KP_CURVE[i];
    const [k0, p0] = KP_CURVE[i - 1];
    if (kp <= k1) return p0 + ((p1 - p0) * (kp - k0)) / (k1 - k0);
  }
  return KP_CURVE[KP_CURVE.length - 1][1];
}

/** Южнее Мурманска нужен более высокий Kp: примерно +1 на каждые 2.5° широты. */
export const kpShift = (lat) => Math.max(-2, (MURMANSK_LAT - lat) / 2.5);

/** Сияние ярче всего около магнитной полуночи (для Мурманска ≈ 23:45 мск). */
export function midnightWeight(ms, lon) {
  const midUTC = mod(24 - lon / 15 - 1, 24);
  const h = mod(ms, DAY) / HOUR;
  let d = Math.abs(h - midUTC);
  d = Math.min(d, 24 - d);
  return d >= 4 ? 0.6 : 0.6 + 0.4 * Math.cos((d * Math.PI) / 8);
}

export const cloudFactor = (cloud) => (finite(cloud) ? 0.15 + 0.85 * (1 - cloud / 100) : 1);

export const LEVELS = [
  { min: 0.7, key: 'high', label: 'высокий' },
  { min: 0.5, key: 'good', label: 'хороший' },
  { min: 0.3, key: 'medium', label: 'средний' },
  { min: 0.12, key: 'low', label: 'низкий' },
  { min: -1, key: 'none', label: 'очень низкий' },
];
export const levelOf = (score) => LEVELS.find((l) => score >= l.min);

// ───────────── Kp и облачность по времени ─────────────

function kpForecastAt(forecast, ms) {
  if (!forecast?.length) return null;
  for (const b of forecast) if (ms >= b.t && ms < b.t + 3 * HOUR) return b;
  return null;
}

function cloudAt(clouds, ms) {
  if (!clouds?.length) return null;
  let best = null;
  for (const c of clouds) {
    const d = Math.abs(c.t - floorHour(ms));
    if (d <= 1.5 * HOUR && (!best || d < best.d)) best = { d, c: c.c };
  }
  return best ? best.c : null;
}

// ───────────── Почасовая шкала и ночи ─────────────

export function buildTimeline({ now, loc, kpForecast, clouds, arrivals, hours = 72 }) {
  const start = floorHour(now);
  const shift = kpShift(loc.lat);
  const out = [];
  for (let i = 0; i < hours; i++) {
    const t = start + i * HOUR;
    const mid = t + HOUR / 2;
    const alt = sunAltitude(mid, loc.lat, loc.lon);
    const dark = darkness(alt);
    const block = kpForecastAt(kpForecast, mid);
    const kpN = block ? block.kp : null;
    const kpA = arrivalKpAt(arrivals, mid);
    let kp = Math.max(kpN ?? -1, kpA ?? -1);
    const guess = kp < 0;
    if (guess) kp = 2;
    const cloud = cloudAt(clouds, mid);
    const score = dark * kpVisibility(kp - shift) * midnightWeight(mid, loc.lon) * cloudFactor(cloud);
    out.push({
      t,
      alt,
      dark,
      kp,
      kpGuess: guess,
      kpFromCme: kpA != null && kpA > (kpN ?? -1),
      cloud,
      score,
    });
  }
  return out;
}

/** Лучший непрерывный отрезок до 4 ч вокруг максимума. */
export function bestWindow(hours) {
  if (!hours.length) return null;
  let iMax = 0;
  hours.forEach((h, i) => {
    if (h.score > hours[iMax].score) iMax = i;
  });
  const peak = hours[iMax].score;
  let lo = iMax;
  let hi = iMax;
  while (hi - lo + 1 < 4) {
    const left = lo > 0 ? hours[lo - 1].score : -1;
    const right = hi < hours.length - 1 ? hours[hi + 1].score : -1;
    if (Math.max(left, right) < peak * 0.85 || Math.max(left, right) <= 0) break;
    if (right >= left) hi++;
    else lo--;
  }
  return { start: hours[lo].t, end: hours[hi].t + HOUR, score: peak };
}

export const DARK_ALT = -8; // Солнце ниже −8°: небо достаточно тёмное для сияния

/** Ночи с точными границами темноты; для текущей ночи учитываются только оставшиеся часы. */
export function buildNights(timeline, loc, now) {
  if (!timeline.length) return [];
  const from = timeline[0].t;
  const to = timeline[timeline.length - 1].t + HOUR;
  return darkIntervals(from - 20 * HOUR, to, loc.lat, loc.lon, DARK_ALT)
    .filter((i) => i.end > now && i.end - i.start >= 45 * 60000)
    .map((i) => {
      const viewFrom = Math.max(i.start, now);
      const hs = timeline.filter((h) => h.t + HOUR > viewFrom && h.t < i.end && h.dark > 0);
      if (!hs.length) return null;
      const clouds = hs.map((h) => h.cloud).filter(finite);
      const maxScore = Math.max(...hs.map((h) => h.score));
      const best = bestWindow(hs);
      if (best) {
        best.start = Math.max(best.start, viewFrom);
        best.end = Math.min(best.end, i.end);
      }
      return {
        start: i.start,
        end: i.end,
        viewFrom,
        partial: i.end >= to - 10 * 60000,
        maxScore,
        level: levelOf(maxScore),
        kpMax: Math.max(...hs.map((h) => h.kp)),
        kpGuess: hs.every((h) => h.kpGuess),
        cloudMean: clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : null,
        cme: hs.some((h) => h.kpFromCme),
        best,
      };
    })
    .filter(Boolean);
}

/** Тёмные отрезки внутри окна влияния выброса — «когда смотреть». */
export function watchWindows(span, loc, timeline, now) {
  if (!span) return [];
  return darkIntervals(span.start, span.end, loc.lat, loc.lon, DARK_ALT)
    .map((i) => ({ start: Math.max(i.start, now), end: i.end }))
    .filter((i) => i.end - i.start >= 45 * 60000)
    .slice(0, 3)
    .map((i) => {
      const hs = timeline.filter((h) => h.t + HOUR > i.start && h.t < i.end && h.score > 0);
      const best = hs.length ? bestWindow(hs) : null;
      if (best) {
        best.start = Math.max(best.start, i.start);
        best.end = Math.min(best.end, i.end);
      }
      return { start: i.start, end: i.end, best, inTimeline: hs.length > 0 };
    });
}

// ───────────── Вспышки + выбросы → события ─────────────

export function buildEvents({ now, flares = [], donkiFlr = [], cmes = [], minFlux = 1e-5, loc, timeline }) {
  const cmeById = new Map(cmes.map((c) => [c.id, c]));
  const usedDonki = new Set();

  // Объединяем вспышки NOAA (оперативно) с DONKI (координаты и связи с выбросами).
  const merged = flares
    .filter((f) => f.flux >= minFlux && f.peak)
    .map((f) => {
      const d = donkiFlr.find((x) => !usedDonki.has(x.id) && Math.abs((x.peak ?? x.begin) - f.peak) <= 20 * 60000);
      if (d) usedDonki.add(d.id);
      return { cls: f.cls, flux: f.flux, peak: f.peak, begin: f.begin, donki: d || null };
    });
  for (const d of donkiFlr) {
    if (usedDonki.has(d.id) || flareFlux(d.cls) < minFlux) continue;
    merged.push({ cls: d.cls, flux: flareFlux(d.cls), peak: d.peak ?? d.begin, begin: d.begin, donki: d });
  }

  const arrivalsByKey = new Map();
  const attachedCmes = new Set();

  const flareEvents = merged.map((f) => {
    const cmeIds = new Set((f.donki?.linked || []).filter((id) => /-CME-/.test(id)));
    if (f.donki) for (const c of cmes) if ((c.linked || []).includes(f.donki.id)) cmeIds.add(c.id);
    let prediction = null;
    for (const id of cmeIds) {
      const c = cmeById.get(id);
      if (!c) continue;
      attachedCmes.add(id);
      prediction = betterPrediction(prediction, predictCme(c));
    }
    const ageH = (now - f.peak) / HOUR;
    const loc0 = parseLocation(f.donki?.source);
    let status;
    if (prediction) status = prediction.kind;
    else if (ageH < 12 || (!f.donki && ageH < 24)) status = 'pending';
    else status = 'none';

    const ev = {
      type: 'flare',
      id: f.donki?.id || `noaa:${f.peak}:${f.cls}`,
      cls: f.cls,
      flux: f.flux,
      peak: f.peak,
      source: f.donki?.source || '',
      farSide: loc0 ? Math.abs(loc0.lon) > 60 : false,
      status,
      prediction,
      link: f.donki?.link || null,
    };

    if (prediction?.arrival && prediction.kind !== 'miss') {
      ev.span = arrivalSpan(prediction);
      ev.watch = watchWindows(ev.span, loc, timeline, now);
      const a = arrivalsByKey.get(prediction.key) || { ...prediction, flares: [], cmeIds: new Set() };
      a.flares.push(f.cls);
      cmeIds.forEach((id) => a.cmeIds.add(id));
      arrivalsByKey.set(prediction.key, a);
    } else if ((status === 'pending' || status === 'unknown') && !ev.farSide) {
      // Выброса ещё нет в данных: типичный путь до Земли 1–3 суток.
      const fast = f.flux >= 1e-4;
      ev.span = { start: f.peak + (fast ? 18 : 24) * HOUR, end: f.peak + 72 * HOUR, tentative: true };
      ev.watch = watchWindows(ev.span, loc, timeline, now);
    }
    return ev;
  });

  // Выбросы к Земле без сильной вспышки (например, извержение волокна) — тоже показываем.
  const cmeEvents = [];
  for (const c of cmes) {
    if (attachedCmes.has(c.id)) continue;
    const p = predictCme(c);
    if (!p.arrival || p.kind === 'miss') continue;
    const span = arrivalSpan(p);
    if (span.end < now - 6 * HOUR) continue;
    const existing = arrivalsByKey.get(p.key);
    if (existing) {
      existing.cmeIds.add(c.id);
      continue;
    }
    arrivalsByKey.set(p.key, { ...p, flares: [], cmeIds: new Set([c.id]) });
    cmeEvents.push({
      type: 'cme',
      id: c.id,
      start: c.start,
      source: c.source,
      status: p.kind,
      prediction: p,
      span,
      watch: watchWindows(span, loc, timeline, now),
      link: c.link,
    });
  }

  const events = [...flareEvents, ...cmeEvents].sort((a, b) => (b.peak ?? b.start) - (a.peak ?? a.start));
  const arrivals = [...arrivalsByKey.values()].map((a) => ({ ...a, cmeIds: [...a.cmeIds] }));
  return { events, arrivals };
}

/** Все ожидаемые прилёты (для расчёта шкалы нужны до построения событий). */
export function collectArrivals(cmes) {
  const byKey = new Map();
  for (const c of cmes) {
    const p = predictCme(c);
    if (!p.arrival || p.kind === 'miss') continue;
    const prev = byKey.get(p.key);
    byKey.set(p.key, prev ? betterPrediction(prev, p) : p);
  }
  return [...byKey.values()];
}

// ───────────── «Сейчас» ─────────────

export function nowcast({ now, loc, kpNow, kpForecast, wind, ovation, clouds }) {
  const alt = sunAltitude(now, loc.lat, loc.lon);
  const dark = darkness(alt);
  const fresh = (x, maxMin) => x && finite(x.t) && now - x.t <= maxMin * 60000;

  const block = kpForecastAt(kpForecast, now);
  let kp = fresh(kpNow, 90) ? kpNow.kp : block ? block.kp : null;
  const windOk = fresh(wind, 45);
  let kpEff = kp ?? 2;
  if (windOk && finite(wind.bz)) {
    if (wind.bz <= -10 && (wind.speed ?? 400) >= 400) kpEff = Math.max(kpEff, 5);
    else if (wind.bz <= -5) kpEff = Math.max(kpEff, 3);
  }
  const ovOk = ovation && finite(ovation.view) && fresh({ t: ovation.forecastTime ?? ovation.t }, 180);
  const ovP = ovOk ? Math.min(1, ovation.view / 30) : 0;
  const cloud = cloudAt(clouds, now);
  const base = Math.max(kpVisibility(kpEff - kpShift(loc.lat)) * midnightWeight(now, loc.lon), ovP);
  const chance = dark * base * cloudFactor(cloud);

  return {
    alt,
    dark,
    kp,
    kpSource: fresh(kpNow, 90) ? 'measured' : block ? block.kind : null,
    bz: windOk ? wind.bz : null,
    bt: windOk ? wind.bt : null,
    speed: windOk ? wind.speed : null,
    density: windOk ? wind.density : null,
    windAt: wind?.t ?? null,
    ovation: ovOk ? ovation.local : null,
    ovationNorth: ovOk ? ovation.north : null,
    ovationView: ovOk ? ovation.view : null,
    cloud,
    chance,
    level: levelOf(chance),
  };
}

// ───────────── Итоговое состояние для интерфейса ─────────────

export function computeState({ now, settings, extracts }) {
  const loc = settings.location;
  const get = (k) => extracts?.[k]?.data ?? null;
  const cmes = get('cmes') || [];
  const kpForecast = get('kpForecast') || [];
  const clouds = settings.useClouds ? get('clouds')?.hours || null : null;

  const preArrivals = collectArrivals(cmes);
  const timeline = buildTimeline({ now, loc, kpForecast, clouds, arrivals: preArrivals });
  const nights = buildNights(timeline, loc, now);
  const { events, arrivals } = buildEvents({
    now,
    flares: get('flares') || [],
    donkiFlr: get('donkiFlr') || [],
    cmes,
    minFlux: flareFlux(settings.flareMinClass) || 1e-5,
    loc,
    timeline,
  });
  const nowInfo = nowcast({
    now,
    loc,
    kpNow: get('kpNow'),
    kpForecast,
    wind: get('wind'),
    ovation: get('ovation'),
    clouds,
  });

  const recent = (get('flares') || []).filter((f) => now - f.peak <= DAY);
  const strongest24h = recent.sort((a, b) => b.flux - a.flux)[0] || null;

  let headline;
  const activeNight = nights.find((n) => n.start <= now && now < n.end);
  if (nowInfo.dark > 0 && nowInfo.chance >= 0.5) {
    headline = { kind: 'now', night: activeNight || nights[0] || null };
  } else {
    const good = nights.find((n) => n.maxScore >= 0.3 && n.best && n.best.end > now);
    if (good) headline = { kind: 'window', night: good };
    else if (nights.length) {
      const best = [...nights].sort((a, b) => b.maxScore - a.maxScore)[0];
      headline = { kind: 'weak', night: best };
    } else headline = { kind: 'bright', night: null };
  }
  if (headline.night) {
    const n = headline.night;
    // Только ещё ожидаемые выбросы, чьё окно влияния захватывает эту ночь; ближайший к лучшему времени.
    const target = n.best ? (n.best.start + n.best.end) / 2 : (n.start + n.end) / 2;
    headline.arrival =
      arrivals
        .filter((a) => a.arrival && !a.arrivedAt && a.arrival > now - 2 * HOUR)
        .filter((a) => {
          const s = arrivalSpan(a);
          return s.start < n.end && s.end > n.start;
        })
        .sort((a, b) => Math.abs(a.arrival - target) - Math.abs(b.arrival - target))[0] || null;
  }

  return {
    computedAt: now,
    dataOk: kpForecast.length > 0,
    location: loc,
    now: nowInfo,
    headline,
    timeline,
    nights,
    events,
    arrivals,
    strongest24h,
    kpForecastEnd: kpForecast.length ? kpForecast[kpForecast.length - 1].t + 3 * HOUR : null,
  };
}
