// Положение Солнца (упрощённый алгоритм NOAA, точность ~1 минута для восхода/заката)
// и оценка «темноты» неба для наблюдения сияния.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;

/** Высота Солнца над горизонтом, градусы. */
export function sunAltitude(date, lat, lon) {
  const ms = date instanceof Date ? date.getTime() : date;
  const jd = ms / DAY_MS + 2440587.5;
  const T = (jd - 2451545.0) / 36525;

  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));

  const y = Math.tan((eps * RAD) / 2) ** 2;
  const eqTime =
    (4 / RAD) *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD)); // минуты

  const utcMinutes = mod(ms, DAY_MS) / 60000;
  const trueSolarTime = mod(utcMinutes + eqTime + 4 * lon, 1440);
  const hourAngle = trueSolarTime / 4 - 180;

  const cosZen =
    Math.sin(lat * RAD) * Math.sin(decl) +
    Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle * RAD);
  return 90 - Math.acos(clamp(cosZen, -1, 1)) / RAD;
}

/**
 * Насколько небо тёмное для сияния: 0 — светло (Солнце выше −6°),
 * 1 — полноценная ночь (ниже −12°), между ними — сумерки.
 */
export function darkness(altitude) {
  if (altitude >= -6) return 0;
  if (altitude <= -12) return 1;
  return (-6 - altitude) / 6;
}

/**
 * Интервалы, когда Солнце ниже порога (по умолчанию −6°: конец гражданских сумерек).
 * Возвращает [{start, end}] в миллисекундах, шаг поиска 5 минут.
 */
export function darkIntervals(fromMs, toMs, lat, lon, threshold = -6) {
  const step = 5 * 60000;
  const out = [];
  let cur = null;
  for (let t = fromMs; t <= toMs; t += step) {
    const isDark = sunAltitude(t, lat, lon) < threshold;
    if (isDark && !cur) cur = { start: t, end: t };
    if (isDark && cur) cur.end = t;
    if (!isDark && cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function mod(a, b) {
  return ((a % b) + b) % b;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
