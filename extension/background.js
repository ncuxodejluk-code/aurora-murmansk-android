// Фоновая проверка данных: по таймеру и по кнопке «Обновить».

import { SOURCES, loadSource, groupOf } from './lib/sources.js';
import { computeState, flareFlux, HOUR } from './lib/model.js';
import { loadSettings, withDefaults } from './lib/settings.js';
import * as F from './lib/format.js';
import { isMuted } from './lib/mute.js';

const ALARM = 'refresh';
let running = null;
let queued = null;

chrome.runtime.onInstalled.addListener(async () => {
  await schedule();
  refresh('install');
});

chrome.runtime.onStartup.addListener(async () => {
  await schedule();
  refresh('startup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) refresh('alarm');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const o = withDefaults(changes.settings.oldValue);
  const n = withDefaults(changes.settings.newValue);
  schedule();
  const moved = o.location.lat !== n.location.lat || o.location.lon !== n.location.lon;
  if (moved || o.useClouds !== n.useClouds || o.flareMinClass !== n.flareMinClass) {
    // Сразу пересчитать по уже загруженным данным, потом догрузить то, что зависит от места.
    recompute().finally(() => refresh('settings', { again: true }));
  } else if (o.location.name !== n.location.name) {
    recompute();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'refresh') return false;
  refresh('manual').then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
  );
  return true;
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  if (chrome.action.openPopup) chrome.action.openPopup().catch(() => {});
});

async function schedule() {
  const s = await loadSettings();
  const cur = await chrome.alarms.get(ALARM);
  if (!cur || cur.periodInMinutes !== s.intervalMin) {
    await chrome.alarms.clear(ALARM);
    chrome.alarms.create(ALARM, { delayInMinutes: s.intervalMin, periodInMinutes: s.intervalMin });
  }
}

/**
 * again: настройки поменялись — если обновление уже идёт (со старым местом), запустить ещё одно после него.
 */
function refresh(reason, { again = false } = {}) {
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

const locKeyOf = (s) => `${s.location.lat.toFixed(3)},${s.location.lon.toFixed(3)}`;

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

/** Мгновенный пересчёт без сети — после смены места или названия. */
async function recompute() {
  const settings = await loadSettings();
  const { extracts } = await chrome.storage.local.get('extracts');
  if (!extracts) return;
  const state = computeState({ now: Date.now(), settings, extracts: usableExtracts(extracts, settings) });
  await chrome.storage.local.set({ state });
  await updateBadge(state);
}

async function doRefresh(reason) {
  const now = Date.now();
  const settings = await loadSettings();
  const stored = await chrome.storage.local.get(['extracts', 'seen']);
  const extracts = stored.extracts || {};
  await chrome.storage.local.set({ busy: { since: now, reason } });

  const locKey = locKeyOf(settings);
  const active = SOURCES.filter((s) => !s.enabled || s.enabled(settings));
  const results = await Promise.allSettled(active.map((s) => loadSource(s, now, settings, extracts[s.key])));

  const sources = {};
  active.forEach((s, i) => {
    const r = results[i];
    const base = { group: s.group, label: s.label, at: now };
    if (r.status === 'fulfilled') {
      extracts[s.key] = { data: r.value, at: now, loc: s.perLocation ? locKey : null };
      sources[s.key] = { ...base, group: groupOf(s, r.value), ok: true };
    } else {
      // Старые данные для другого места не годятся.
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
    await chrome.storage.local.set({ extracts, busy: null });
    return null;
  }

  const state = computeState({ now, settings, extracts: usableExtracts(extracts, settings) });
  await chrome.storage.local.set({ extracts, state, sources, busy: null, lastRefresh: now });
  await updateBadge(state);
  await notifyAll(state, settings, stored.seen);
  return state;
}

// ───────────── Значок на панели ─────────────

const BADGE = { none: '#4B5480', low: '#4B5480', medium: '#3E6FC2', good: '#1F9D6B', high: '#7C4DDB' };

async function updateBadge(state) {
  const kp = state.now.kp;
  const tonight = state.nights[0];
  const level = state.now.dark > 0 ? state.now.level : tonight?.level || state.now.level;
  await chrome.action.setBadgeText({ text: Number.isFinite(kp) ? String(Math.round(kp)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE[level.key] || BADGE.none });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' }).catch(() => {});

  const parts = [`Сияние: ${state.location.name}`];
  if (Number.isFinite(kp)) parts.push(`Kp сейчас ${F.num(kp)}, шанс ${state.now.level.label}`);
  if (tonight?.best) parts.push(`Лучшее время ${F.nightLabel(tonight.start, tonight.end, state.computedAt)}: ${F.range5(tonight.best.start, tonight.best.end)}`);
  await chrome.action.setTitle({ title: parts.join('\n') });
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
  if (firstRun) return; // при первой установке не засыпаем уведомлениями о старых событиях
  // Пауза: события отмечены как увиденные, но не показываются — после паузы не будет лавины старых.
  if (isMuted(settings, now)) return;
  for (const n of out) {
    chrome.notifications.create(n.id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: n.title,
      message: n.message,
      priority: 1,
    });
  }
}

const roundTo = (ms, min) => Math.round(ms / (min * 60000)) * min * 60000;
