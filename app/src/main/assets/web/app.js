import * as F from './lib/format.js';
import { HOUR, arrivalSpan } from './lib/model.js';
import { GROUPS } from './lib/sources.js';
import { withDefaults, saveSettings } from './lib/settings.js';
import { isMuted, muteOptions, untilFor } from './lib/mute.js';
import { refresh, recompute, settingsKey } from './refresh.js';
import { renderPlaceSelect, bindPlaceSelect, refitPlaceSelect } from './lib/place-select.js';

const B = window.AuroraBridge;

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const current = { state: null, sources: null, busy: null, settings: null };
let manualBusy = false;
let manualError = null;

// ───────────── Маленькие помощники ─────────────

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const round = (ms, min) => Math.round(ms / (min * 60000)) * min * 60000;
const r5 = (ms) => round(ms, 5);
const range5 = (a, b) => F.range(r5(a), r5(b));
const pct = (p) => `${Math.round(p * 100)}%`;
const cloudText = (c) => `${Math.round(c / 10) * 10}%`;
const dot = (cls) => h('span', { class: `dot ${cls}`, 'aria-hidden': 'true' });
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const intervalText = (m) => (m >= 180 ? 'раз в 3 часа' : m >= 60 ? 'раз в час' : `раз в ${Math.max(15, m)} минут`);

// ───────────── Запуск ─────────────

async function init() {
  $('settings').addEventListener('click', () => (location.href = 'settings.html'));
  $('refresh').addEventListener('click', () => requestRefresh('manual'));
  $('mute-select').addEventListener('change', onMuteChange);
  bindPlaceSelect($('place'), {
    getSettings: () => withDefaults(current.settings),
    openManager: () => (location.href = 'settings.html#places'),
  });

  Object.assign(current, await chrome.storage.local.get(['state', 'sources', 'busy', 'settings']));
  // Отметка «обновляю» от прошлого экрана, который закрыли посреди загрузки, — уже неправда.
  // Настоящей может быть только отметка фоновой проверки.
  if (current.busy && current.busy.reason !== 'alarm') {
    current.busy = null;
    await chrome.storage.local.set({ busy: null });
  }
  render();
  document.fonts?.ready.then(() => refitPlaceSelect($('place'), withDefaults(current.settings)));
  autoRefresh();

  // Приложение вернулось на экран: перерисовать время и подтянуть свежие данные.
  window.__auroraResume = async () => {
    // Экран мог вернуться из кэша браузера после настроек — перечитать сохранённое.
    Object.assign(current, await chrome.storage.local.get(['state', 'sources', 'busy', 'settings']));
    render();
    autoRefresh();
  };
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.__auroraResume();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    for (const k of ['state', 'sources', 'busy', 'settings']) {
      if (changes[k]) {
        current[k] = changes[k].newValue ?? null;
        dirty = true;
      }
    }
    if (dirty) render();
    if (changes.settings) onSettingsChanged(changes.settings.oldValue, changes.settings.newValue);
  });
  setInterval(renderTop, 30000);
}

const isBusy = () => manualBusy || (current.busy && Date.now() - current.busy.since < 120000);

// Место выбрали в шапке: сразу пересчитать по загруженным данным, потом догрузить облачность для него.
async function onSettingsChanged(oldRaw, newRaw) {
  const o = withDefaults(oldRaw);
  const n = withDefaults(newRaw);
  if (settingsKey(o) !== settingsKey(n)) {
    await recompute();
    requestRefresh('open', { again: true });
  } else if (o.location.name !== n.location.name) {
    recompute();
  }
}

async function autoRefresh() {
  const settings = withDefaults(current.settings);
  const st = current.state;
  if (!st) return requestRefresh('manual');
  // Место или настройки поменяли на странице настроек.
  if (st.settingsKey !== settingsKey(settings)) {
    await recompute();
    return requestRefresh('open', { again: true });
  }
  if (st.location?.name !== settings.location.name) await recompute();
  const { extracts } = await chrome.storage.local.get('extracts');
  const liveAge = Date.now() - (extracts?.wind?.at || 0);
  const age = Date.now() - st.computedAt;
  if (liveAge > 10 * 60000 || age > (settings.intervalMin + 5) * 60000) requestRefresh('open');
}

async function requestRefresh(reason, { again = false } = {}) {
  if (isBusy() && !again) return;
  manualBusy = true;
  manualError = null;
  renderTop();
  try {
    await refresh(reason, { again });
  } catch (e) {
    manualError = e?.message || String(e);
  } finally {
    manualBusy = false;
    render();
  }
}

// ───────────── Отрисовка ─────────────

function render() {
  renderTop();
  renderNotice();
  const st = current.state;
  const blocks = document.querySelectorAll('.block');
  if (!st) {
    blocks.forEach((b) => (b.hidden = true));
    $('hero').replaceChildren(
      manualError
        ? h('p', { class: 'problem' }, `Не удалось получить данные: ${manualError}. Проверьте интернет и нажмите «Обновить».`)
        : h('p', { class: 'loading' }, 'Загружаю данные NOAA и NASA…'),
    );
    renderFooter(null);
    return;
  }
  blocks.forEach((b) => (b.hidden = false));
  renderHero(st);
  renderChart(st);
  renderNow(st);
  renderEvents(st);
  renderNights(st);
  renderFooter(st);
}

// ───── Пауза уведомлений ─────

let muteSig = '';

function renderMute() {
  const s0 = withDefaults(current.settings);
  const now = Date.now();
  const opts = muteOptions(s0, now);
  const sig = opts.map((o) => o.label).join('|');
  $('mute').classList.toggle('is-muted', isMuted(s0, now));
  if (sig === muteSig) return; // не пересобираем список, пока он открыт и ничего не поменялось
  muteSig = sig;
  const sel = $('mute-select');
  sel.replaceChildren(...opts.map((o) => h('option', { value: o.value }, o.label)));
  sel.value = 'current';
}

async function onMuteChange(e) {
  const v = e.target.value;
  if (v === 'current') return;
  await saveSettings({ notifyPausedUntil: v === 'on' ? null : untilFor(v) });
  current.settings = (await chrome.storage.local.get('settings')).settings;
  muteSig = '';
  render();
}

function renderTop() {
  renderMute();
  const st = current.state;
  renderPlaceSelect($('place'), withDefaults(current.settings));
  const btn = $('refresh');
  const busy = isBusy();
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  btn.querySelector('.btn-label').textContent = busy ? 'Обновляю…' : 'Обновить';
  let meta = '';
  if (busy) meta = 'проверяю источники';
  else if (st) {
    const age = Date.now() - st.computedAt;
    meta = age > 20 * HOUR ? `данные от ${F.dayTime(st.computedAt)}` : `обновлено в ${F.time(st.computedAt)}`;
  }
  $('updated').textContent = meta;
}

// Уведомления выключены — приложение не сможет предупредить о вспышке или сиянии.
function renderNotice() {
  const box = $('notice');
  const s0 = withDefaults(current.settings);
  const wants = (s0.notifyFlares || s0.notifyArrivals || s0.notifyNight || s0.notifyNow) && !isMuted(s0);
  let allowed = true;
  try {
    allowed = B.notificationsAllowed();
  } catch (e) {
    allowed = true;
  }
  if (allowed || !wants) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren(
    h('p', {}, 'Уведомления выключены: приложение не сможет сообщить о вспышке или сиянии.'),
    h('button', { class: 'btn btn-small', type: 'button', onclick: () => B.openNotificationSettings() }, 'Включить'),
  );
}

// ───── Главный блок ─────

function renderHero(st) {
  const hero = $('hero');
  const now = Date.now();
  const { headline } = st;
  const night = headline.night;
  const nodes = [];

  if (headline.kind === 'bright' || !night) {
    nodes.push(
      h('p', { class: 'hero-kicker' }, 'Ночи слишком светлые'),
      h('p', { class: 'hero-time is-word' }, 'белые ночи'),
      h(
        'p',
        { class: 'hero-reason' },
        'Солнце не опускается достаточно низко за горизонт, поэтому сияние не видно, даже если оно есть. В Мурманске сезон наблюдений — примерно с конца августа по середину апреля.',
      ),
    );
    hero.replaceChildren(...nodes);
    return;
  }

  if (!st.dataOk) {
    const src = current.sources?.kpForecast;
    nodes.push(
      h('p', { class: 'hero-kicker' }, 'Нет прогноза активности'),
      h(
        'p',
        { class: 'problem' },
        `Прогноз Kp от NOAA не загрузился${src?.error ? ` (${src.error})` : ''}. Без него время сияния не рассчитать: ниже показаны только темнота неба и облачность. Проверьте интернет и нажмите «Обновить».`,
      ),
    );
    hero.replaceChildren(...nodes);
    return;
  }

  const best = night.best;
  const level = headline.kind === 'now' ? st.now.level : night.level;
  const score = headline.kind === 'now' ? st.now.chance : night.maxScore;

  if (headline.kind === 'now') {
    const end = best && best.end > now ? best.end : night.end;
    nodes.push(
      h('p', { class: 'hero-kicker' }, 'Смотрите на небо прямо сейчас'),
      h('p', { class: 'hero-when' }, `Шанс ${level.label} до ${F.time(r5(end))}`),
      h('p', { class: 'hero-time' }, `${F.time(r5(now))}–${F.time(r5(end))}`),
    );
  } else {
    nodes.push(
      h('p', { class: 'hero-kicker' }, headline.kind === 'window' ? 'Ближайшее окно для наблюдения' : 'Ближайшие ночи без ярких шансов'),
      h(
        'p',
        { class: 'hero-when' },
        headline.kind === 'window'
          ? cap(F.nightLabel(night.start, night.end, now))
          : `Лучший вариант — ${F.nightLabel(night.start, night.end, now)}`,
      ),
      h('p', { class: 'hero-time' }, best ? range5(best.start, best.end) : range5(night.viewFrom, night.end)),
    );
  }

  const facts = [h('li', { class: `fact fact-level level-${level.key}` }, dot(''), `шанс ${level.label}, ${pct(score)}`)];
  if (headline.kind === 'now') {
    if (isFiniteNum(st.now.kp)) facts.push(h('li', { class: 'fact' }, `Kp\u00a0${F.num(st.now.kp)}`));
    if (isFiniteNum(st.now.bz)) facts.push(h('li', { class: 'fact' }, `Bz ${F.signed(st.now.bz)} нТл`));
    if (isFiniteNum(st.now.cloud)) facts.push(h('li', { class: 'fact' }, `облака ${cloudText(st.now.cloud)}`));
  } else {
    facts.push(h('li', { class: 'fact' }, `Kp до\u00a0${F.num(night.kpMax)}`));
    if (isFiniteNum(night.cloudMean)) facts.push(h('li', { class: 'fact' }, `облака около ${cloudText(night.cloudMean)}`));
    facts.push(h('li', { class: 'fact' }, `темно ${range5(night.start, night.end)}`));
  }
  nodes.push(h('ul', { class: 'hero-facts' }, facts));
  nodes.push(h('p', { class: 'hero-reason' }, ...reasonFor(st, night, headline.kind)));
  hero.replaceChildren(...nodes);
}

function reasonFor(st, night, kind) {
  const out = [];
  const a = st.headline.arrival;
  if (kind === 'now') {
    const bzSouth = isFiniteNum(st.now.bz) && st.now.bz <= -3;
    out.push(
      `Магнитная обстановка активная${isFiniteNum(st.now.kp) ? `: Kp ${F.num(st.now.kp)}` : ''}${bzSouth ? ', поле солнечного ветра повернуто к югу' : ''}. `,
      'Смотрите на север, подальше от городских огней.',
    );
    return out;
  }
  if (a) {
    const from = a.flares?.length ? ` после вспышки ${a.flares.join(', ')}` : '';
    const lead = a.kind === 'hit' ? `К Земле идёт выброс${from}.` : a.kind === 'glancing' ? `Выброс${from} заденет Землю краем.` : `Выброс${from} слегка коснётся Земли.`;
    out.push(
      h('strong', {}, lead),
      ` Прилёт около ${F.dayTime(round(a.arrival, 15))} (±${a.errH}\u00a0ч)${a.kpRange ? `, ожидается Kp\u00a0${a.kpRange[0]}\u2060–\u2060${a.kpRange[1]}` : ''}.`,
    );
  } else if (night.kpMax >= 5) out.push(`NOAA ожидает магнитную бурю: Kp до ${F.num(night.kpMax)}.`);
  else if (night.kpMax >= 4) out.push(`NOAA ожидает повышенную активность: Kp до ${F.num(night.kpMax)}.`);
  else out.push(`Выбросов к Земле не ожидается, активность обычная: Kp до ${F.num(night.kpMax)}.`);

  if (isFiniteNum(night.cloudMean) && night.cloudMean >= 70) out.push(` Но небо, скорее всего, затянуто облаками.`);
  else if (isFiniteNum(night.cloudMean) && night.cloudMean >= 40) out.push(` Облачность переменная — следите за прояснениями.`);
  if (night.kpGuess) out.push(' Прогноза Kp на эту ночь ещё нет, оценка приблизительная.');
  return out;
}

// ───── Шкала по часам ─────

let selected = null;
let hideTip = null;

document.addEventListener('pointerdown', (e) => {
  if (hideTip && !e.target.closest?.('#chart')) hideTip();
});

function renderChart(st) {
  const box = $('chart');
  const tl = st.timeline || [];
  if (!tl.length) {
    box.replaceChildren(h('p', { class: 'note' }, 'Нет данных для шкалы.'));
    return;
  }
  const W = 344;
  const top = 20;
  const BH = 58;
  const base = top + BH;
  const H = base + 18;
  const step = W / tl.length;
  const x = (i) => i * step;
  const t0 = tl[0].t;
  const xAt = (ms) => ((ms - t0) / HOUR) * step;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-hidden': 'true' });
  svg.append(
    s(
      'defs',
      {},
      s(
        'linearGradient',
        { id: 'aurora-gradient', x1: 0, y1: top, x2: 0, y2: base, gradientUnits: 'userSpaceOnUse' },
        s('stop', { offset: '0', 'stop-color': '#b48cff' }),
        s('stop', { offset: '0.45', 'stop-color': '#7fd6c4' }),
        s('stop', { offset: '1', 'stop-color': '#5be3a3' }),
      ),
    ),
  );

  // Светлое время суток
  let i = 0;
  while (i < tl.length) {
    if (tl[i].dark > 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < tl.length && tl[j].dark === 0) j++;
    svg.append(s('rect', { class: 'chart-day', x: x(i), y: top, width: x(j) - x(i), height: BH }));
    i = j;
  }

  svg.append(s('line', { class: 'chart-grid', x1: 0, x2: W, y1: base - BH * 0.5, y2: base - BH * 0.5 }));
  svg.append(s('text', { class: 'chart-axis', x: W, y: base - BH * 0.5 - 3, 'text-anchor': 'end' }, '50%'));

  // Влияние ожидаемых выбросов
  let cmeLabelUsed = false;
  for (const a of st.arrivals || []) {
    if (!a.arrival || a.arrivedAt || a.kind === 'miss') continue;
    const span = arrivalSpan(a);
    const x1 = Math.max(0, xAt(span.start));
    const x2 = Math.min(W, xAt(span.end));
    if (x2 - x1 < 2) continue;
    svg.append(s('line', { class: 'chart-cme', x1: x1 + 1, x2: x2 - 1, y1: 13, y2: 13 }));
    if (!cmeLabelUsed && x2 - x1 > 46) {
      svg.append(s('text', { class: 'chart-label chart-label-sun', x: x1 + 1, y: 8 }, 'выброс'));
      cmeLabelUsed = true;
    }
  }

  // Столбики шанса
  tl.forEach((p, k) => {
    if (p.score <= 0.005) return;
    const hgt = Math.max(1.5, p.score * BH);
    svg.append(
      s('rect', {
        class: `chart-bar${p.kpGuess ? ' is-guess' : ''}`,
        x: x(k) + 0.55,
        y: base - hgt,
        width: Math.max(1, step - 1.1),
        height: hgt,
        rx: 1.2,
      }),
    );
  });

  svg.append(s('line', { class: 'chart-base', x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5 }));

  // Отметка «сейчас»
  const nx = Math.max(0.5, xAt(Date.now()));
  svg.append(s('line', { class: 'chart-now', x1: nx, x2: nx, y1: top - 2, y2: base + 4 }));

  // Подписи суток
  tl.forEach((p, k) => {
    if (F.localParts(p.t).hour !== 0) return;
    svg.append(s('line', { class: 'chart-base', x1: x(k), x2: x(k), y1: base, y2: base + 5 }));
    if (x(k) < W - 34) svg.append(s('text', { class: 'chart-axis', x: x(k) + 3, y: base + 14 }, `${F.weekday(p.t)}, ${F.localParts(p.t).day}`));
  });
  svg.append(s('text', { class: 'chart-axis', x: nx + 3, y: base + 14 }, 'сейчас'));

  const sel = s('rect', { class: 'chart-sel', x: 0, y: top, width: step, height: BH, visibility: 'hidden' });
  svg.append(sel);

  const tip = h('div', { class: 'chart-tip', hidden: true });
  const show = (k) => {
    if (k == null || k < 0 || k >= tl.length) {
      tip.hidden = true;
      sel.setAttribute('visibility', 'hidden');
      return;
    }
    selected = k;
    const p = tl[k];
    sel.setAttribute('x', x(k));
    sel.setAttribute('visibility', 'visible');
    const lines = [h('b', {}, `${F.dayShort(p.t)}, ${F.range(p.t, p.t + HOUR)}`)];
    lines.push(h('span', {}, p.dark > 0 ? `шанс ${pct(p.score)}` : 'светло, сияние не видно'));
    lines.push(h('br'), h('span', {}, `Kp\u00a0${F.num(p.kp)}${p.kpGuess ? ' (прогноза нет)' : p.kpFromCme ? ' с учётом выброса' : ''}`));
    if (isFiniteNum(p.cloud)) lines.push(h('br'), h('span', {}, `облака ${Math.round(p.cloud)}%`));
    tip.replaceChildren(...lines);
    tip.hidden = false;
    const px = ((x(k) + step / 2) / W) * box.clientWidth;
    tip.style.left = `${Math.min(box.clientWidth - 70, Math.max(70, px))}px`;
  };

  // Касание или ведение пальцем по шкале показывает подсказку для часа.
  const pick = (e) => {
    const r = svg.getBoundingClientRect();
    show(Math.floor(((e.clientX - r.left) / r.width) * tl.length));
  };
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons) pick(e);
  });
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') show(null);
  });
  hideTip = () => show(null);

  const bestNight = [...(st.nights || [])].sort((a, b) => b.maxScore - a.maxScore)[0];
  box.setAttribute('tabindex', '0');
  box.setAttribute('role', 'group');
  box.setAttribute(
    'aria-label',
    bestNight?.best
      ? `Шанс по часам на трое суток. Лучше всего ${F.nightLabel(bestNight.start, bestNight.end, Date.now())}, ${range5(bestNight.best.start, bestNight.best.end)}, шанс ${bestNight.level.label}. Стрелками можно листать часы.`
      : 'Шанс по часам на трое суток. Стрелками можно листать часы.',
  );
  box.onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const k = selected == null ? 0 : selected + (e.key === 'ArrowRight' ? 1 : -1);
    show(Math.max(0, Math.min(tl.length - 1, k)));
  };
  box.onblur = () => show(null);

  const legend = h(
    'ul',
    { class: 'chart-legend' },
    h('li', {}, h('span', { class: 'swatch swatch-bar' }), 'шанс в тёмное время'),
    h('li', {}, h('span', { class: 'swatch swatch-day' }), 'светло'),
    cmeLabelUsed || (st.arrivals || []).some((a) => a.arrival && !a.arrivedAt)
      ? h('li', {}, h('span', { class: 'swatch swatch-cme' }), 'влияние выброса')
      : null,
    tl.some((p) => p.kpGuess && p.score > 0.005) ? h('li', {}, h('span', { class: 'swatch swatch-guess' }), 'нет прогноза Kp') : null,
  );
  box.replaceChildren(svg, tip, legend);
}

// ───── Обстановка сейчас ─────

function renderNow(st) {
  const n = st.now;
  const now = Date.now();
  let status;
  if (n.dark > 0) {
    status = `Темно: Солнце на ${F.num(-n.alt, 0)}° под горизонтом.`;
    if (st.dataOk || n.kp != null) status += ` Шанс прямо сейчас ${n.level.label}.`;
  }
  else {
    const next = (st.nights || []).find((x) => x.start > now);
    const sun = n.alt > 0 ? `Солнце на ${F.num(n.alt, 0)}° над горизонтом` : 'сумерки';
    status = `Светло, ${sun}.${next ? ` Стемнеет к ${F.time(r5(next.start))}.` : ''}`;
  }
  $('now-status').textContent = status;

  const reading = (label, value, unit, hint, good) =>
    h(
      'div',
      { class: 'reading' },
      h('dt', {}, label),
      h('dd', {}, h('span', { class: 'reading-value' }, value, unit && value !== '—' ? h('span', { class: 'reading-unit' }, unit) : null), h('span', { class: `reading-hint${good ? ' is-good' : ''}` }, hint)),
    );

  const kpHint =
    n.kp == null ? 'нет данных' : n.kp >= 5 ? `буря G${Math.min(5, Math.floor(n.kp) - 4)}` : n.kpSource === 'measured' ? 'измерено' : 'оценка NOAA';
  const bzHint =
    n.bz == null ? 'нет данных' : n.bz <= -5 ? 'к югу — хорошо' : n.bz < -1 ? 'слабо к югу' : n.bz > 1 ? 'к северу — мешает' : 'около нуля';
  const vHint = n.speed == null ? 'нет данных' : n.speed >= 600 ? 'очень быстрый' : n.speed >= 480 ? 'быстрый' : 'обычный';
  const useClouds = withDefaults(current.settings).useClouds;
  const cHint = !useClouds ? 'не учитываются' : n.cloud == null ? 'нет данных' : n.cloud < 25 ? 'ясно' : n.cloud < 65 ? 'переменная' : 'пасмурно';

  $('readings').replaceChildren(
    reading('Kp', F.num(n.kp), '', kpHint, n.kp >= 4),
    reading('Bz', F.signed(n.bz), 'нТл', bzHint, n.bz <= -5),
    reading('Ветер', n.speed == null ? '—' : String(Math.round(n.speed)), 'км/с', vHint, n.speed >= 480),
    reading('Облака', useClouds && n.cloud != null ? `${Math.round(n.cloud)}%` : '—', '', cHint, useClouds && n.cloud != null && n.cloud < 25),
  );

  $('ovation').textContent =
    n.ovation != null
      ? `Модель овала OVATION (NOAA): вероятность ${Math.round(n.ovation)}% над городом, до ${Math.round(n.ovationNorth)}% севернее.`
      : '';
}

// ───── Вспышки и выбросы ─────

const STATUS_TEXT = {
  miss: 'Выброс уходит мимо Земли — сияния от него не ждём.',
  none: 'Выброса не было — на сияние эта вспышка не повлияет.',
  unknown: 'Выброс есть, направление пока не рассчитано.',
};

function eventStatus(e, now) {
  const p = e.prediction;
  if (p?.arrivedAt) {
    const span = arrivalSpan(p);
    const tail = span.end > now ? ` Влияние может продолжаться до ${F.dayTime(r5(span.end))}.` : '';
    return { cls: 'st-arrived', text: `Выброс дошёл до Земли ${F.dayTime(p.arrivedAt)}.${tail}` };
  }
  if (p?.arrival && p.kind !== 'miss') {
    const when = `${F.dayTime(round(p.arrival, 15))} (±${p.errH}\u00a0ч)`;
    const kp = p.kpRange ? `, ожидается Kp\u00a0${p.kpRange[0]}\u2060–\u2060${p.kpRange[1]}` : '';
    const lead = p.kind === 'hit' ? 'Выброс идёт к Земле.' : p.kind === 'glancing' ? 'Выброс заденет Землю краем.' : 'Выброс слегка коснётся Земли.';
    return { cls: `st-${p.kind}`, text: `${lead} Прилёт около ${when}${kp}.` };
  }
  if (e.status === 'pending') {
    return e.farSide
      ? { cls: 'st-miss', text: 'Вспышка у края диска: выброс, если он будет, скорее всего пройдёт мимо Земли.' }
      : { cls: 'st-pending', text: 'Ждём данных о выбросе: коронографы и модель NASA обычно дают ответ через 3–12 ч.' };
  }
  return { cls: `st-${e.status}`, text: STATUS_TEXT[e.status] || STATUS_TEXT.none };
}

function watchNode(e, now) {
  const ws = (e.watch || []).filter((w) => w.end > now);
  if (!ws.length) return null;
  if (e.span?.tentative) {
    const names = ws.slice(0, 2).map((w) => F.nightLabel(w.start, w.end, now));
    return h('p', { class: 'event-watch' }, 'Если выброс пойдёт к Земле, сияние ориентировочно ', h('b', {}, names.join(' или ')), '.');
  }
  const w = ws.find((x) => x.best) || ws[0];
  const extra = ws.filter((x) => x !== w)[0];
  return h(
    'p',
    { class: 'event-watch' },
    'Когда смотреть: ',
    h('b', {}, F.nightLabel(w.start, w.end, now)),
    w.best ? `, лучше ${range5(w.best.start, w.best.end)}` : `, ${range5(w.start, w.end)}`,
    extra ? `; запасной вариант — ${F.nightLabel(extra.start, extra.end, now)}` : '',
    '.',
  );
}

function methodNote(e) {
  const p = e.prediction;
  let text = null;
  if (p?.method === 'enlil') text = 'Прогноз модели WSA-ENLIL, NASA';
  else if (p?.method === 'dbm') text = `Оценка по скорости выброса ${Math.round(p.speed)} км/с`;
  else if (e.type === 'flare' && !e.link) text = 'Данные GOES, NOAA';
  if (!text && !e.link) return null;
  return h(
    'p',
    { class: 'event-source' },
    text ? `${text}. ` : '',
    e.link ? h('a', { href: e.link, target: '_blank', rel: 'noopener' }, 'Запись в каталоге DONKI') : null,
  );
}

function renderEvents(st) {
  const list = $('events');
  const now = Date.now();
  const events = (st.events || [])
    .filter((e) => {
      const p = e.prediction;
      if (p?.arrivedAt) return arrivalSpan(p).end > now - 6 * HOUR;
      if (['hit', 'glancing', 'minor', 'pending', 'unknown'].includes(e.status)) return true;
      return now - (e.peak ?? e.start) < 48 * HOUR;
    })
    .slice(0, 6);
  if (!events.length) {
    const s24 = st.strongest24h;
    list.replaceChildren(
      h(
        'li',
        { class: 'events-empty' },
        `За двое суток не было вспышек класса ${withDefaults(current.settings).flareMinClass} и сильнее, и выбросов к Земле не ожидается.`,
        s24 ? ` Самая сильная вспышка за сутки — ${s24.cls}.` : '',
      ),
    );
    return;
  }
  list.replaceChildren(
    ...events.map((e) => {
      const st0 = eventStatus(e, now);
      const letter = (e.cls || '').charAt(0).toUpperCase();
      const badge =
        e.type === 'cme'
          ? h('div', { class: 'event-class is-cme' }, 'выброс')
          : h('div', { class: `event-class${letter === 'X' ? ' is-x' : letter === 'C' ? ' is-c' : ''}` }, e.cls);
      const when =
        e.type === 'cme'
          ? `${F.dayTime(e.start)}${e.source ? `, область ${e.source}` : ''}, без сильной вспышки`
          : `${F.dayTime(e.peak)}${e.source ? `, область ${e.source}` : ''}`;
      return h(
        'li',
        { class: 'event' },
        badge,
        h(
          'div',
          {},
          h('p', { class: 'event-when' }, when),
          h('p', { class: 'event-status' }, dot(st0.cls), h('span', {}, st0.text)),
          watchNode(e, now),
          methodNote(e),
        ),
      );
    }),
  );
}

// ───── Ночи ─────

function renderNights(st) {
  const table = $('nights');
  const now = Date.now();
  const nights = st.nights || [];
  if (!nights.length) {
    table.replaceChildren(h('caption', { class: 'note' }, 'В ближайшие трое суток тёмного времени нет.'));
    return;
  }
  const head = h('thead', {}, h('tr', {}, h('th', {}, 'Ночь'), h('th', {}, 'Лучше всего'), h('th', {}, 'Шанс'), h('th', { class: 'num' }, 'Kp')));
  const rows = nights.map((n) =>
    h(
      'tr',
      {},
      h('td', {}, n.start <= now ? 'эта ночь' : F.nightShort(n.start), h('span', { class: 'sub' }, `темно ${range5(n.start, n.end)}${n.partial ? '…' : ''}`)),
      h('td', {}, n.best ? range5(n.best.start, n.best.end) : '—', isFiniteNum(n.cloudMean) ? h('span', { class: 'sub' }, `облака ${cloudText(n.cloudMean)}`) : null),
      h('td', {}, h('span', { class: `chance level-${n.level.key}` }, dot(''), n.level.label), h('span', { class: 'sub' }, pct(n.maxScore))),
      h('td', { class: 'num' }, F.num(n.kpMax), n.cme ? h('span', { class: 'sub' }, 'выброс') : n.kpGuess ? h('span', { class: 'sub' }, 'оценка') : null),
    ),
  );
  table.replaceChildren(head, h('tbody', {}, rows));
}

// ───── Источники ─────

function renderFooter(st) {
  const foot = $('footer');
  const src = current.sources || {};
  const groups = {};
  for (const v of Object.values(src)) {
    const g = (groups[v.group] ||= { ok: true, items: [] });
    g.ok = g.ok && v.ok;
    g.items.push(v);
  }
  const list = h(
    'ul',
    { class: 'sources' },
    Object.entries(GROUPS)
      .filter(([k]) => groups[k])
      .map(([k, g]) => h('li', {}, dot(groups[k].ok ? 'src-ok' : 'src-err'), h('a', { href: g.url, target: '_blank', rel: 'noopener' }, g.name))),
  );
  const failed = {};
  for (const v of Object.values(src)) {
    if (v.ok) continue;
    const key = `${v.group}|${v.error}`;
    const f = (failed[key] ||= { group: v.group, error: v.error, labels: [], lastOk: [] });
    f.labels.push(v.label);
    if (v.lastOk) f.lastOk.push(v.lastOk);
  }
  const errs = Object.values(failed).map(
    (f) =>
      `${GROUPS[f.group]?.name || f.group} (${f.labels.join(', ')}): ${f.error}.` +
      (f.lastOk.length ? ` Показаны данные от ${F.dayTime(Math.min(...f.lastOk))}.` : ''),
  );
  if (manualError && st) errs.push(`Обновление не завершилось: ${manualError}.`);
  foot.replaceChildren(
    Object.keys(groups).length ? list : '',
    ...errs.map((e) => h('p', { class: 'errors' }, e)),
    h(
      'p',
      { class: 'footer-note' },
      'Прогноз ориентировочный: время прилёта выброса известно с точностью ±6–12 ч, а облачность может испортить даже сильную бурю. Время московское.',
    ),
    h(
      'p',
      { class: 'footer-note' },
      `В фоне приложение проверяет данные ${intervalText(withDefaults(current.settings).intervalMin)} и загружает только лёгкие файлы. Солнечный ветер и овал сияния обновляются, когда приложение открыто.`,
    ),
    h('button', { class: 'link-btn', type: 'button', onclick: () => B.openLogs() }, 'Журнал работы'),
  );
}

init();
