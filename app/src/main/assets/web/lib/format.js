// Форматирование для интерфейса. Мурманск живёт по московскому времени.

export const TZ = 'Europe/Moscow';
const HOUR = 3600000;

const fmt = (opts) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, ...opts });
const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
const fDayLong = fmt({ day: 'numeric', month: 'long' });
const fDayShort = fmt({ day: 'numeric', month: 'short' });
const fWeekday = fmt({ weekday: 'short' });
const fParts = fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });

export const time = (ms) => fTime.format(ms);
export const dayLong = (ms) => fDayLong.format(ms);
export const dayShort = (ms) => fDayShort.format(ms).replace('.', '').replace(' ', '\u00a0');
export const weekday = (ms) => fWeekday.format(ms);
export const dayTime = (ms) => `${dayShort(ms)}, ${time(ms)}`;
export const range = (a, b) => `${time(a)}–${time(b)}`;
const round5 = (ms) => Math.round(ms / 300000) * 300000;
/** Диапазон с округлением до 5 минут — без ложной точности. */
export const range5 = (a, b) => range(round5(a), round5(b));

/** Ключ местной даты 'YYYY-MM-DD' и местный час. */
export function localParts(ms) {
  const p = Object.fromEntries(fParts.formatToParts(ms).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, day: Number(p.day), hour: Number(p.hour) % 24 };
}

/** Число по-русски: десятичная запятая и настоящий минус. */
export function num(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).replace('-', '−');
}

export function signed(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = num(Math.abs(v), digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** «в ночь с 11 на 12 октября», «этой ночью», «в ночь с 31 октября на 1 ноября». */
export function nightLabel(start, end, now) {
  if (now != null && start <= now && now < end) return 'этой ночью';
  const { evening, morning } = nightDays(start);
  const la = dayLong(evening);
  const lb = dayLong(morning);
  const ma = la.split(' ').slice(1).join(' ');
  const mb = lb.split(' ').slice(1).join(' ');
  return ma === mb ? `в ночь с ${localParts(evening).day} на ${lb}` : `в ночь с ${la} на ${lb}`;
}

/** Короткая подпись ночи для списка: «10→11 окт». */
export function nightShort(start) {
  const { evening, morning } = nightDays(start);
  return `${localParts(evening).day}→${dayShort(morning)}`;
}

/** Ночь определяется по вечеру: если отрезок начинается после полудня — это вечер того же дня. */
function nightDays(start) {
  const evening = localParts(start).hour >= 12 ? start : start - 12 * HOUR;
  return { evening, morning: evening + 24 * HOUR };
}

export function relative(ms, now) {
  const d = ms - now;
  const abs = Math.abs(d);
  const plural = (n, one, few, many) => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  let s;
  if (abs < 60000) return 'только что';
  if (abs < HOUR) {
    const m = Math.round(abs / 60000);
    s = `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`;
  } else if (abs < 36 * HOUR) {
    const h = Math.round(abs / HOUR);
    s = `${h} ${plural(h, 'час', 'часа', 'часов')}`;
  } else {
    const dd = Math.round(abs / (24 * HOUR));
    s = `${dd} ${plural(dd, 'день', 'дня', 'дней')}`;
  }
  return d > 0 ? `через ${s}` : `${s} назад`;
}

export const percent = (p) => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
