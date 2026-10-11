// Обновление данных — общее для экрана приложения и фоновой проверки.

import { SOURCES, loadSource, groupOf } from './lib/sources.js';
import { computeState, flareFlux, levelOf, HOUR } from './lib/model.js';
import { loadSettings } from './lib/settings.js';
import * as F from './lib/format.js';
import { isMuted } from './lib/mute.js';

const B = window.AuroraBridge;
const MIN = 60000;

// Солнечный ветер и овал сияния весят несколько мегабайт, поэтому в фоне их не качаем:
// они нужны только для блока «Обстановка сейчас», когда приложение открыто.
const LIVE = new Set(['wind', 'ovation']);
// Каталог NASA и облачность меняются медленно — хватит раз в час.
const SLOW = { donkiFlr: 55, cmes: 55, clouds: 55 };
const QUICK = 4;

let running = null;
let queued = null;

export const settingsKey = (s) =>
  [s.location.lat.toFixed(3), s.location.lon.toFixed(3), s.useClouds, s.flareMinClass].join('|');

const locKeyOf = (s) => `${s.location.lat.toFixed(3)},${s.location.lon.toFixed(3)}`;

/**
 * reason: 'manual' и 'settings' — загрузить всё;
 * 'open' — экран открыт: свежие «живые» данные плюс то, что устарело;
 * 'alarm' — фоновая проверка: только лёгкие источники.
 * again: настройки поменялись — если обновление уже идёт (со старым местом), запустить ещё одно после него.
 */
export function refresh(reason = 'manual', { again = false } = {}) {
  if (!running) {
    running = doRefresh(reason).finally(() => (running = null));
    return running;
  }
  if (!again) return running;
  if (!queued) {
    queued = running
      .catch(() => null)
      .then(() => {
        queued = null;
        return refresh(reason);
      });
  }
  return queued;
}

export const isRunning = () => !!running;

/** Данные, которые годятся для этих настроек: облачность и овал — только для того же места. */
function usableExtracts(extracts, settings) {
  const key = locKeyOf(settings);
  const out = {};
  for (const s of SOURCES) {
    const e = extracts?.[s.key];
    if (!e || (s.enabled && !s.enabled(settings)) || (s.perLocation && e.loc !== key)) continue;
    out[s.key] = e;
  }
  return out;
}

/** Мгновенный пересчёт без сети — после смены места или названия. Недостающее догрузит обновление. */
export async function recompute() {
  const settings = await loadSettings();
  const { extracts } = await chrome.storage.local.get('extracts');
  if (!extracts) return null;
  const state = computeState({ now: Date.now(), settings, extracts: usableExtracts(extracts, settings) });
  state.settingsKey = settingsKey(settings);
  await chrome.storage.local.set({ state });
  updateWidget(state);
  return state;
}

function due(src, reason, ex, now) {
  if (reason === 'manual' || reason === 'settings') return true;
  const age = ex?.at ? (now - ex.at) / MIN : Infinity;
  if (LIVE.has(src.key)) return reason !== 'alarm' && age > QUICK;
  if (SLOW[src.key]) return age > SLOW[src.key];
  return reason === 'alarm' ? age > 2 : age > QUICK;
}

async function doRefresh(reason) {
  const now = Date.now();
  const settings = await loadSettings();
  const stored = await chrome.storage.local.get(['extracts', 'seen', 'sources', 'busy']);
  // Фоновая проверка не мешает уже идущему обновлению с экрана.
  if (reason === 'alarm' && stored.busy && now - stored.busy.since < 2 * MIN) return null;

  const extracts = stored.extracts || {};
  const prevSources = stored.sources || {};
  await chrome.storage.local.set({ busy: { since: now, reason } });
  try {
    const locKey = locKeyOf(settings);
    const active = SOURCES.filter((s) => !s.enabled || s.enabled(settings));
    const todo = active.filter((s) => {
      const ex = extracts[s.key];
      // Данные для другого места — загрузить заново (тяжёлый овал в фоне не качаем и тогда).
      const moved = s.perLocation && ex && ex.loc !== locKey;
      if (moved && !(LIVE.has(s.key) && reason === 'alarm')) return true;
      return due(s, reason, ex, now);
    });
    const results = await Promise.allSettled(todo.map((s) => loadSource(s, now, settings, extracts[s.key])));

    const sources = {};
    for (const s of active) if (!todo.includes(s) && prevSources[s.key]) sources[s.key] = prevSources[s.key];
    todo.forEach((s, i) => {
      const r = results[i];
      const base = { group: s.group, label: s.label, at: now };
      if (r.status === 'fulfilled') {
        extracts[s.key] = { data: r.value, at: now, loc: s.perLocation ? locKey : null };
        sources[s.key] = { ...base, group: groupOf(s, r.value), ok: true };
      } else {
        if (s.perLocation && extracts[s.key]?.loc !== locKey) delete extracts[s.key];
        sources[s.key] = {
          ...base,
          ok: false,
          error: r.reason?.message || String(r.reason),
          lastOk: extracts[s.key]?.at ?? null,
        };
      }
    });
    for (const s of SOURCES) if (s.enabled && !s.enabled(settings)) delete extracts[s.key];

    // Пока шла загрузка, выбрали другое место: данные сохраняем, а пересчёт сделает следующее обновление.
    const latest = await loadSettings();
    if (locKeyOf(latest) !== locKey) {
      await chrome.storage.local.set({ extracts });
      console.info(`обновление (${reason}): место сменилось во время загрузки, пересчёт — следующим обновлением`);
      return null;
    }

    const state = computeState({ now, settings, extracts: usableExtracts(extracts, settings) });
    state.settingsKey = settingsKey(settings);
    const failed = todo.filter((s, i) => results[i].status !== 'fulfilled');
    console.info(
      `обновление (${reason}): загружено ${todo.length - failed.length} из ${todo.length}` +
        (failed.length ? `; ошибки: ${failed.map((s) => `${s.key} — ${sources[s.key].error}`).join(', ')}` : ''),
    );
    await chrome.storage.local.set({ extracts, state, sources, lastRefresh: now });
    updateWidget(state);
    await notifyAll(state, settings, stored.seen);
    return state;
  } finally {
    await chrome.storage.local.set({ busy: null });
  }
}

// ───────────── Виджет на главном экране ─────────────

const r5 = (ms) => Math.round(ms / (5 * MIN)) * 5 * MIN;

export function widgetSummary(state) {
  const now = state.computedAt;
  const n = state.now;
  const night = state.headline.night;
  const kp = Number.isFinite(n.kp) ? F.num(n.kp) : '—';
  let time;
  let when;
  let whenShort = null;
  let level = n.level;
  let chance = null;

  if (!state.dataOk) {
    time = 'нет прогноза';
    when = 'не удалось загрузить данные NOAA';
  } else if (state.headline.kind === 'bright' || !night) {
    time = 'белые ночи';
    when = 'слишком светло для сияния';
  } else if (state.headline.kind === 'now') {
    const end = night.best && night.best.end > now ? night.best.end : night.end;
    time = `до ${F.time(r5(end))}`;
    when = 'сейчас';
    chance = n.chance;
  } else {
    level = night.level;
    const w = night.best || { start: night.viewFrom, end: night.end };
    time = F.range5(w.start, w.end);
    when = F.nightLabel(night.start, night.end, now);
    whenShort = when === 'этой ночью' ? when : `в ночь на ${F.dayShort(night.end)}`;
    chance = night.maxScore;
  }

  const info = [];
  if (night) {
    if (Number.isFinite(night.cloudMean)) info.push(`облака около ${Math.round(night.cloudMean / 10) * 10}%`);
    info.push(`темно ${F.range5(night.start, night.end)}`);
  }
  const a = state.headline.arrival;
  const note = a
    ? `${a.kind === 'glancing' ? 'Выброс заденет Землю краем' : 'К Земле идёт выброс'}: прилёт около ${F.dayTime(roundTo(a.arrival, 15))} (±${a.errH} ч)`
    : '';

  return {
    place: state.location.name,
    kp,
    time,
    when,
    whenShort: whenShort || when,
    // для виджетов старых версий
    line: chance != null ? `${when}, шанс ${level.label}` : when,
    chanceLabel: chance != null ? `шанс ${level.label}` : '',
    chance: chance != null ? F.percent(chance) : '',
    levelKey: level.key,
    info: info.join(' · '),
    note,
    updated: `обновлено в ${F.time(now)}`,
    bars: widgetBars(state),
  };
}

/**
 * Шанс по часам для графика в виджете: ближайшая тёмная часть суток (с часом до и после),
 * чтобы не тратить место на светлое время. Не больше суток.
 */
function widgetBars(state) {
  const tl = state.timeline || [];
  const now = state.computedAt;
  let ic = tl.findIndex((h) => h.t <= now && now < h.t + HOUR);
  if (ic < 0) ic = tl.findIndex((h) => h.t > now);
  if (ic < 0) return [];
  const isDark = (h) => h && h.dark >= 0.3;
  let start = ic;
  if (!isDark(tl[ic])) {
    const d = tl.findIndex((h, i) => i > ic && isDark(h));
    if (d < 0 || d - ic > 20) return []; // белые ночи или до темноты почти сутки
    start = Math.max(ic, d - 1);
  }
  let end = start;
  while (end + 1 < tl.length && end - start < 23) {
    if (isDark(tl[end]) && !isDark(tl[end + 1])) break; // темнота кончилась
    end++;
  }
  end = Math.min(tl.length - 1, end + 1); // час рассвета
  while (end - start + 1 < 8 && end + 1 < tl.length) end++;
  return tl.slice(start, end + 1).map((h, i) => ({
    s: Math.round(Math.max(0, Math.min(1, h.score)) * 100) / 100,
    d: Math.round(Math.max(0, Math.min(1, h.dark)) * 100) / 100,
    k: levelOf(h.score).key,
    h: F.localParts(h.t).hour,
    ...(i === 0 && start === ic ? { now: 1 } : {}),
  }));
}

function updateWidget(state) {
  try {
    B.updateWidget(JSON.stringify(widgetSummary(state)));
  } catch (e) {
    console.error('виджет', e);
  }
}

// ───────────── Уведомления ─────────────

async function notifyAll(state, settings, seenStored) {
  const firstRun = !seenStored;
  const seen = { flares: [], arrivals: {}, nowAt: 0, nightKey: '', ...(seenStored || {}) };
  const now = state.computedAt;
  const out = [];

  const minFlux = flareFlux(settings.flareMinClass) || 1e-5;
  for (const e of state.events) {
    if (e.type !== 'flare' || e.flux < minFlux || now - e.peak > 24 * HOUR || seen.flares.includes(e.id)) continue;
    seen.flares.push(e.id);
    if (settings.notifyFlares) {
      out.push({
        id: `flare:${e.id}`,
        title: `Вспышка ${e.cls} на Солнце`,
        message:
          `${F.dayTime(e.peak)} мск${e.source ? `, область ${e.source}` : ''}. ` +
          (e.farSide
            ? 'Вспышка у края диска: выброс, скорее всего, пройдёт мимо Земли.'
            : 'Если выброс пойдёт к Земле, сияние ориентировочно через 1–3 суток.'),
      });
    }
  }
  seen.flares = seen.flares.slice(-60);

  for (const a of state.arrivals) {
    if (!a.arrival || a.arrivedAt || a.arrival < now - 6 * HOUR) continue;
    const prev = seen.arrivals[a.key];
    if (prev && Math.abs(prev - a.arrival) < 3 * HOUR) continue;
    seen.arrivals[a.key] = a.arrival;
    if (!settings.notifyArrivals) continue;
    const ev = state.events.find((e) => e.prediction?.key === a.key);
    const w = ev?.watch?.find((x) => x.best) || ev?.watch?.[0];
    const kp = a.kpRange ? `, ожидается Kp ${a.kpRange[0]}–${a.kpRange[1]}` : '';
    const from = a.flares.length ? ` после вспышки ${a.flares.join(', ')}` : '';
    out.push({
      id: `arrival:${a.key}`,
      title: a.kind === 'hit' ? `Выброс${from} идёт к Земле` : `Выброс${from} заденет Землю краем`,
      message:
        `Прилёт около ${F.dayTime(roundTo(a.arrival, 15))} мск (±${a.errH} ч)${kp}.` +
        (w ? ` Смотреть ${F.nightLabel(w.start, w.end, now)}${w.best ? `, лучше ${F.range5(w.best.start, w.best.end)}` : ''}.` : ''),
    });
  }
  for (const k of Object.keys(seen.arrivals)) if (seen.arrivals[k] < now - 4 * 24 * HOUR) delete seen.arrivals[k];

  if (state.now.dark > 0 && state.now.chance >= 0.5 && now - seen.nowAt > 4 * HOUR) {
    seen.nowAt = now;
    if (settings.notifyNow) {
      out.push({
        id: 'now',
        title: 'Сияние: хорошие шансы прямо сейчас',
        message: `Kp ${F.num(state.now.kp)}${Number.isFinite(state.now.bz) ? `, Bz ${F.signed(state.now.bz)} нТл` : ''}. Смотрите на север, подальше от городских огней.`,
      });
    }
  }

  const tonight = state.nights.find((n) => n.end > now && n.start - now < 6 * HOUR && n.maxScore >= 0.5);
  if (tonight) {
    const key = F.nightShort(tonight.start);
    if (seen.nightKey !== key) {
      seen.nightKey = key;
      if (settings.notifyNight && tonight.start > now) {
        const clouds = Number.isFinite(tonight.cloudMean) ? `, облачность около ${Math.round(tonight.cloudMean / 10) * 10}%` : '';
        out.push({
          id: `night:${key}`,
          title: `Шанс увидеть сияние ${F.nightLabel(tonight.start, tonight.end, now)}: ${tonight.level.label}`,
          message: `Лучшее время ${F.range5(tonight.best.start, tonight.best.end)}, Kp до ${F.num(tonight.kpMax)}${clouds}.`,
        });
      }
    }
  }

  await chrome.storage.local.set({ seen });
  if (firstRun) return; // при первом запуске не засыпаем уведомлениями о старых событиях
  // Пауза: события отмечены как увиденные, но не показываются — после паузы не будет лавины старых.
  if (isMuted(settings, now)) return;
  for (const n of out) {
    try {
      B.showNotification(n.id, n.title, n.message);
    } catch (e) {
      console.error('уведомление', e);
    }
  }
}

const roundTo = (ms, min) => Math.round(ms / (min * MIN)) * min * MIN;
