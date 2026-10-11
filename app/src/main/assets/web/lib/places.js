// Места наблюдения: разбор координат, скопированных с любой карты, и список сохранённых мест.

export const LAT_MIN = 40;
export const MAX_PLACES = 30;
export const DEFAULT_PLACE = Object.freeze({ id: 'murmansk', name: 'Мурманск', lat: 68.9585, lon: 33.0827 });

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ───────────── Запись координат ─────────────

/** Число для координат: точка как разделитель (так пишут все карты), без лишних нулей. */
export function coordNum(v, digits = 6) {
  const s = v.toFixed(digits).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/** «69.1642, 35.1406» — так координаты понимает любая карта. */
export const coordsText = (lat, lon, digits = 6) => `${coordNum(lat, digits)}, ${coordNum(lon, digits)}`;

/** «69.1642° с. ш., 35.1406° в. д.» */
export function coordsHuman(lat, lon) {
  const ns = lat >= 0 ? 'с. ш.' : 'ю. ш.';
  const ew = lon >= 0 ? 'в. д.' : 'з. д.';
  return `${coordNum(Math.abs(lat), 4)}° ${ns}, ${coordNum(Math.abs(lon), 4)}° ${ew}`;
}

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Уже сохранённое место в пределах 300 м. */
export const findNear = (places, lat, lon, km = 0.3) => places.find((p) => distanceKm(p, { lat, lon }) < km) || null;

// ───────────── Разбор вставленного текста ─────────────

const MSG = {
  none: 'Не вижу здесь координат. Вставьте их из карты, например: 69.1642, 35.1406',
  one: 'Нашлось только одно число. Нужны две координаты — широта и долгота, например: 69.1642, 35.1406',
  short:
    'Это короткая ссылка — координат в ней нет. Откройте место на карте и скопируйте сами координаты: в Яндекс Картах и Google Картах они написаны в карточке точки.',
  url: 'В этой ссылке не нашлось координат. Скопируйте координаты из карточки места на карте.',
  range: 'Таких координат не бывает: широта — от −90 до 90°, долгота — от −180 до 180°.',
};

const fail = (reason, message) => ({ ok: false, reason, message: message ?? MSG[reason] ?? MSG.none });

/**
 * Понимает:
 *  • числа: «69.1642, 35.1406», «69,1642 35,1406», «69,1642; 35,1406» — точка или запятая, неважно;
 *  • градусы, минуты, секунды: 69°09′51″ N 35°08′26″ E, «69°09′ с. ш. 35°08′ в. д.», N 69° 09.85′ E 35° 08.44′;
 *  • подписи: «широта 69.16 долгота 35.14», «lat 69.16 lon 35.14»;
 *  • ссылки Яндекс Карт, Google Карт, 2ГИС, OpenStreetMap, Apple Карт и geo:.
 * Возвращает { ok, lat, lon, text, swapped, center, name, warning } или { ok: false, reason, message }.
 */
export function parseCoords(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return fail('empty', '');

  const urlMatch = /(?:https?:\/\/|geo:)\S+/i.exec(input);
  let urlResult = null;
  if (urlMatch) {
    urlResult = fromUrl(urlMatch[0]);
    if (urlResult.ok) return finish(urlResult);
    // Вдруг координаты есть в тексте рядом со ссылкой.
    const rest = (input.slice(0, urlMatch.index) + ' ' + input.slice(urlMatch.index + urlMatch[0].length)).trim();
    if (rest) {
      const r = fromText(rest);
      if (r.ok) return finish(r);
    }
    return urlResult;
  }
  const r = fromText(input);
  return r.ok ? finish(r) : r;
}

function finish(r) {
  let { lat, lon } = r;
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return fail('range');
  lat = Math.round(lat * 1e6) / 1e6;
  lon = Math.round(lon * 1e6) / 1e6;
  if (lat < LAT_MIN) {
    return fail(
      'south',
      lat < 0
        ? 'Это южное полушарие. Расчёт сделан для северного сияния — подойдут места севернее 40° с. ш.'
        : `Это слишком далеко на юг (широта ${coordNum(lat, 2)}°): сияние там почти не бывает видно, а расчёт сделан для севера. Подойдут места севернее 40° с. ш.`,
    );
  }
  return {
    ok: true,
    lat,
    lon,
    text: coordsText(lat, lon),
    swapped: !!r.swapped,
    center: !!r.center,
    name: r.name || '',
    warning: lat < 65 ? 'Южнее 65° с. ш. оценка шансов грубая: расчёт настроен на Кольский полуостров.' : '',
  };
}

// ───── Ссылки на карты ─────

const N = '(-?\\d{1,3}(?:\\.\\d+)?)';
const SHORT_LINK = /^(?:https?:\/\/)?(?:[\w-]+\.)*(?:yandex\.[a-z.]+\/maps\/-\/|ya\.cc\/|maps\.app\.goo\.gl\/|goo\.gl\/|go\.2gis\.com\/|2gis\.[a-z]+\/[^/?#]+\/share)/i;

function decode(s) {
  let t = s;
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(t.replace(/\+/g, ' '));
      if (d === t) break;
      t = d;
    } catch {
      break;
    }
  }
  return t;
}

function fromUrl(url) {
  const t = decode(url);
  const host = (/^[a-z]+:\/\/([^/?#]+)/i.exec(t)?.[1] || '').toLowerCase();
  const isYandex = /(^|\.)(yandex\.[a-z.]+|ya\.ru)$/.test(host);
  const is2gis = /(^|\.)2gis\.[a-z]+$/.test(host);

  // [регулярка, порядок чисел, это центр карты, а не точка]
  let rules;
  if (isYandex) {
    // Яндекс пишет в ссылках сначала долготу, потом широту.
    rules = [
      [new RegExp(`[?&]whatshere\\[point\\]=${N},\\s?${N}`), 'lonlat'],
      [new RegExp(`[?&]pt=${N},\\s?${N}`), 'lonlat'],
      [new RegExp(`[?&]ll=${N},\\s?${N}`), 'lonlat', true],
      [new RegExp(`[?&]sll=${N},\\s?${N}`), 'lonlat', true],
    ];
  } else if (is2gis) {
    // 2ГИС тоже: долгота, широта.
    rules = [
      [new RegExp(`/${N},${N}(?=[/?#]|$)`), 'lonlat'],
      [new RegExp(`[?&]m=${N},${N}`), 'lonlat', true],
    ];
  } else {
    rules = [
      [new RegExp(`!3d${N}!4d${N}`), 'latlon'],
      [new RegExp(`[?&]mlat=${N}[^#]*?[?&]mlon=${N}`), 'latlon'],
      [new RegExp(`^geo:${N},\\s?${N}`, 'i'), 'latlon'],
      [new RegExp(`[?&](?:q|query|daddr|destination|point)=(?:loc:)?${N},\\s?${N}`), 'latlon'],
      [new RegExp(`/(?:place|search|dir)/${N},\\s?${N}`), 'latlon'],
      [new RegExp(`[?&](?:ll|center)=${N},\\s?${N}`), 'latlon', true],
      [new RegExp(`#map=\\d+(?:\\.\\d+)?/${N}/${N}`), 'latlon', true],
      [new RegExp(`@${N},${N}`), 'latlon', true],
    ];
  }

  const tryRules = (list) => {
    for (const [re, order, center] of list) {
      const m = re.exec(t);
      if (!m) continue;
      const a = Number(m[1]);
      const b = Number(m[2]);
      const [lat, lon] = order === 'lonlat' ? [b, a] : [a, b];
      return { ok: true, lat, lon, center: !!center, name: placeNameFromUrl(t) };
    }
    return null;
  };
  // Сначала точка, которую поставили на карте, и только потом центр карты.
  const exact = tryRules(rules.filter((r) => !r[2]));
  if (exact) return exact;
  // Google: /place/69°09'51.1"N+35°08'26.2"E/
  const place = /\/place\/([^/@?#]+)/.exec(t);
  if (place) {
    const r = fromText(place[1]);
    if (r.ok) return r;
  }
  const center = tryRules(rules.filter((r) => r[2]));
  if (center) return center;
  return SHORT_LINK.test(t) ? fail('short') : fail('url');
}

function placeNameFromUrl(t) {
  const m = /\/place\/([^/@?#]+)/.exec(t);
  if (!m) return '';
  const name = m[1].replace(/\s+/g, ' ').split(',')[0].trim();
  return /\d/.test(name) ? '' : name.slice(0, 40);
}

// ───── Текст ─────

function normalize(s) {
  return (
    ' ' +
    s
      .replace(/[   \t\r\n]+/g, ' ')
      .replace(/[″“”«»]|''|′′/g, '"')
      .replace(/[′’‘`´]/g, "'")
      .replace(/[º˚]/g, '°')
      .replace(/[−–—]/g, '-')
      // подписи
      .replace(/(?<!\p{L})(?:широта|шир\.?|latitude|lat)(?!\p{L})\s*[:=]?/giu, ' #LAT ')
      .replace(/(?<!\p{L})(?:долгота|долг\.?|longitude|long|lon|lng)(?!\p{L})\s*[:=]?/giu, ' #LON ')
      // полушария словами
      .replace(/(?<!\p{L})северн\p{L}*\s+широт\p{L}*/giu, ' #N ')
      .replace(/(?<!\p{L})южн\p{L}*\s+широт\p{L}*/giu, ' #S ')
      .replace(/(?<!\p{L})восточн\p{L}*\s+долгот\p{L}*/giu, ' #E ')
      .replace(/(?<!\p{L})западн\p{L}*\s+долгот\p{L}*/giu, ' #W ')
      .replace(/(?<!\p{L})с\.?\s?ш\.?(?!\p{L})/giu, ' #N ')
      .replace(/(?<!\p{L})ю\.?\s?ш\.?(?!\p{L})/giu, ' #S ')
      .replace(/(?<!\p{L})в\.?\s?д\.?(?!\p{L})/giu, ' #E ')
      .replace(/(?<!\p{L})з\.?\s?д\.?(?!\p{L})/giu, ' #W ')
      // одиночные буквы рядом с числом: N69°, 69°N, С 69°, 35°В
      .replace(/(?<![\p{L}#])([NSEWnsew])(?![\p{L}])/gu, (m, c) => ` #${c.toUpperCase()} `)
      .replace(/(?<![\p{L}#])([СсЮюВвЗз])(?=\s*-?\d)/gu, (m, c) => ` #${CYR[c.toLowerCase()]} `)
      .replace(/(?<=[\d°'"]\s?)([СсЮюВвЗз])(?!\p{L})/gu, (m, c) => ` #${CYR[c.toLowerCase()]} `) +
    ' '
  );
}

const CYR = { с: 'N', ю: 'S', в: 'E', з: 'W' };
const TOKEN = /#(LAT|LON|N|S|E|W)|(-?)(\d+(?:[.,]\d+)?)|([°'"])|([,;/|])/g;

function tokens(s) {
  const out = [];
  for (const m of s.matchAll(TOKEN)) {
    if (m[1]) out.push(m[1] === 'LAT' || m[1] === 'LON' ? { t: 'label', v: m[1] } : { t: 'hemi', v: m[1] });
    else if (m[3] != null) {
      // минус — только если сразу перед числом и не после цифры («69-35» — не минус)
      const prev = s[m.index - 1];
      const neg = m[2] === '-' && !(prev && /\d/.test(prev));
      out.push({ t: 'num', v: Number(m[3].replace(',', '.')), raw: m[3], neg, dec: /[.,]/.test(m[3]) });
    } else if (m[4]) out.push({ t: 'mark', v: m[4] });
    else if (m[5]) out.push({ t: 'sep' });
  }
  return out;
}

function fromText(text) {
  const toks = tokens(normalize(text));
  const nums = toks.filter((x) => x.t === 'num');
  if (!nums.length) return fail('none');
  // «68,33» — одна запятая между целыми: это две координаты, а не 68.33
  if (nums.length === 1) {
    const m = /^(\d{1,3}),(\d{1,3})$/.exec(nums[0].raw);
    if (m && !toks.some((x) => x.t === 'mark')) return pick([comp(Number(m[1])), comp(Number(m[2]))], false, false);
    return fail('one');
  }

  const hasHemi = toks.some((x) => x.t === 'hemi');
  const firstSignal = toks.find((x) => x.t === 'hemi' || x.t === 'num');
  const leading = firstSignal?.t === 'hemi';
  const comps = [];
  let cur = null;
  let pendingHemi = null;
  let pendingLabel = null;

  for (const tk of toks) {
    if (tk.t === 'num') {
      const lastMark = cur ? cur.marks[cur.marks.length - 1] : null;
      // Продолжение градусов-минут-секунд: после ° или ′ (или до буквы полушария), и только после целого числа.
      const cont =
        cur &&
        !cur.closed &&
        cur.vals.length < 3 &&
        (hasHemi || lastMark === '°' || lastMark === "'") &&
        lastMark !== '"' &&
        Number.isInteger(cur.vals[cur.vals.length - 1]);
      if (cont) {
        cur.vals.push(tk.v);
        cur.marks.push(null);
      } else {
        cur = { vals: [tk.v], marks: [null], neg: tk.neg, dec: tk.dec, hemi: null, label: pendingLabel, closed: false };
        if (pendingHemi) {
          cur.hemi = pendingHemi;
          pendingHemi = null;
        }
        pendingLabel = null;
        comps.push(cur);
      }
    } else if (tk.t === 'mark') {
      if (cur && cur.marks[cur.marks.length - 1] == null) cur.marks[cur.marks.length - 1] = tk.v;
    } else if (tk.t === 'sep') {
      if (cur) cur.closed = true;
    } else if (tk.t === 'hemi') {
      if (leading) {
        if (cur) cur.closed = true;
        pendingHemi = tk.v;
      } else if (cur && !cur.hemi) {
        cur.hemi = tk.v;
        cur.closed = true;
      } else pendingHemi = tk.v;
    } else if (tk.t === 'label') {
      if (cur) cur.closed = true;
      pendingLabel = tk.v;
    }
  }

  const values = comps.map(value).filter(Boolean);
  if (values.length < 2) return fail(values.length ? 'one' : 'none');
  return pick(values, hasHemi, values.some((v) => v.label));
}

function comp(v) {
  return { v, hemi: null, label: null, precise: false };
}

function value(c) {
  const [d, m = 0, s = 0] = c.vals;
  if (c.vals.length > 1 && (m >= 60 || s >= 60 || !Number.isInteger(d))) return null;
  if (c.vals.length > 2 && !Number.isInteger(m)) return null;
  let v = d + m / 60 + s / 3600;
  if (c.neg || c.hemi === 'S' || c.hemi === 'W') v = -v;
  const precise = c.dec || c.vals.length > 1 || c.marks[0] === '°';
  return { v, hemi: c.hemi, label: c.label, precise };
}

function pick(vals, hasHemi, hasLabel) {
  let lat;
  let lon;
  if (hasHemi) {
    lat = vals.find((x) => x.hemi === 'N' || x.hemi === 'S');
    lon = vals.find((x) => x.hemi === 'E' || x.hemi === 'W');
    const rest = vals.filter((x) => !x.hemi);
    if (!lat && lon) lat = rest[0];
    if (!lon && lat) lon = rest[0];
    if (lat && lon) return { ok: true, lat: lat.v, lon: lon.v };
  }
  if (hasLabel) {
    lat = vals.find((x) => x.label === 'LAT');
    lon = vals.find((x) => x.label === 'LON');
    if (lat && lon) return { ok: true, lat: lat.v, lon: lon.v };
  }
  // Первая пара похожих на координаты чисел; если таких нет — первые два.
  let i = vals.findIndex((x, k) => k + 1 < vals.length && x.precise && vals[k + 1].precise);
  if (i < 0) i = 0;
  let a = vals[i].v;
  let b = vals[i + 1].v;
  let swapped = false;
  // Широта не бывает больше 90°, а севернее 40° мы и ждём точку: если первое число не подходит, а второе да — это «долгота, широта».
  if ((Math.abs(a) > 90 && Math.abs(b) <= 90) || ((a < LAT_MIN || a >= 90) && b >= LAT_MIN && b < 90)) {
    [a, b] = [b, a];
    swapped = true;
  }
  return { ok: true, lat: a, lon: b, swapped };
}

// ───────────── Список мест в настройках ─────────────

function cleanPlace(p) {
  if (!p || !finite(p.lat) || !finite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  const name = String(p.name ?? '').trim().slice(0, 40) || coordsText(p.lat, p.lon, 3);
  return { id: String(p.id || ''), name, lat: p.lat, lon: p.lon };
}

/**
 * Достаёт из сохранённых настроек список мест и выбранное место.
 * Старые настройки (одно место в settings.location) переносятся в список.
 */
export function normalizePlaces(saved) {
  let places = [];
  if (Array.isArray(saved?.places)) {
    const ids = new Set();
    for (const raw of saved.places) {
      const p = cleanPlace(raw);
      if (!p) continue;
      if (!p.id || ids.has(p.id)) p.id = `p${ids.size + 1}-${Math.round(p.lat * 1000)}-${Math.round(p.lon * 1000)}`;
      ids.add(p.id);
      places.push(p);
      if (places.length >= MAX_PLACES) break;
    }
  }
  let placeId = typeof saved?.placeId === 'string' ? saved.placeId : null;

  if (!places.length) {
    places = [{ ...DEFAULT_PLACE }];
    placeId = DEFAULT_PLACE.id;
    const old = cleanPlace(saved?.location);
    if (old && distanceKm(old, DEFAULT_PLACE) >= 0.3) {
      places.push({ ...old, id: 'p-migrated', name: String(saved.location.name ?? '').trim() || 'Моё место' });
      placeId = 'p-migrated';
    }
  }
  if (!places.some((p) => p.id === placeId)) placeId = places[0].id;
  return { places, placeId };
}

export function newPlaceId() {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Изменения настроек для «добавить место и выбрать его». */
export function addPlacePatch(settings, { name, lat, lon }, select = true) {
  const place = cleanPlace({ id: newPlaceId(), name, lat, lon });
  const places = [...settings.places, place].slice(-MAX_PLACES);
  return { places, placeId: select ? place.id : settings.placeId, added: place };
}

export function renamePlacePatch(settings, id, name) {
  const clean = String(name ?? '').trim().slice(0, 40);
  if (!clean) return null;
  return { places: settings.places.map((p) => (p.id === id ? { ...p, name: clean } : p)) };
}

export function removePlacePatch(settings, id) {
  if (settings.places.length <= 1) return null;
  const places = settings.places.filter((p) => p.id !== id);
  const placeId = settings.placeId === id ? places[0].id : settings.placeId;
  return { places, placeId };
}

/** Вернуть удалённое место на прежнее место в списке. */
export function restorePlacePatch(settings, place, index, wasActive) {
  if (settings.places.some((p) => p.id === place.id)) return null;
  const places = [...settings.places];
  places.splice(Math.min(index, places.length), 0, place);
  return { places: places.slice(0, MAX_PLACES), placeId: wasActive ? place.id : settings.placeId };
}

export function movePlacePatch(settings, id, delta) {
  const i = settings.places.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= settings.places.length) return null;
  const places = [...settings.places];
  [places[i], places[j]] = [places[j], places[i]];
  return { places };
}
