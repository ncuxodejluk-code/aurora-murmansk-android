import { DEFAULTS, loadSettings, saveSettings } from './lib/settings.js';
import { muteOptions, muteStatus, untilFor } from './lib/mute.js';

const $ = (id) => document.getElementById(id);

function fill(s) {
  $('name').value = s.location.name;
  $('lat').value = s.location.lat;
  $('lon').value = s.location.lon;
  $('interval').value = String(s.intervalMin);
  $('clouds').checked = s.useClouds;
  $('flare-class').value = s.flareMinClass;
  $('n-flares').checked = s.notifyFlares;
  $('n-arrivals').checked = s.notifyArrivals;
  $('n-night').checked = s.notifyNight;
  $('n-now').checked = s.notifyNow;
}

function say(text, error = false) {
  const el = $('saved');
  el.textContent = text;
  el.classList.toggle('is-error', error);
}

$('reset-place').addEventListener('click', () => {
  $('name').value = DEFAULTS.location.name;
  $('lat').value = DEFAULTS.location.lat;
  $('lon').value = DEFAULTS.location.lon;
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lat = Number(String($('lat').value).replace(',', '.'));
  const lon = Number(String($('lon').value).replace(',', '.'));
  const latOk = Number.isFinite(lat) && lat >= 40 && lat <= 90;
  const lonOk = Number.isFinite(lon) && lon >= -180 && lon <= 180;
  $('lat').setAttribute('aria-invalid', String(!latOk));
  $('lon').setAttribute('aria-invalid', String(!lonOk));
  if (!latOk || !lonOk) {
    say(!latOk ? 'Широта должна быть от 40 до 90°.' : 'Долгота должна быть от −180 до 180°.', true);
    return;
  }
  await saveSettings({
    location: { name: $('name').value.trim() || 'Без названия', lat, lon },
    intervalMin: Number($('interval').value),
    useClouds: $('clouds').checked,
    flareMinClass: $('flare-class').value,
    notifyFlares: $('n-flares').checked,
    notifyArrivals: $('n-arrivals').checked,
    notifyNight: $('n-night').checked,
    notifyNow: $('n-now').checked,
  });
  try {
    window.AuroraBridge.reschedule();
  } catch (err) {
    console.error(err);
  }
  say('Сохранено. Прогноз пересчитается, когда вы вернётесь к нему.');
});

$('back').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = 'index.html';
});

try {
  $('version').textContent = `Версия ${window.AuroraBridge.appVersion()}`;
} catch (err) {
  $('version').hidden = true;
}

function fillMute(s) {
  const sel = $('mute-select');
  sel.replaceChildren(
    ...muteOptions(s).map((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      return opt;
    }),
  );
  sel.value = 'current';
}

$('mute-select').addEventListener('change', async (e) => {
  const v = e.target.value;
  if (v === 'current') return;
  const s = await saveSettings({ notifyPausedUntil: v === 'on' ? null : untilFor(v) });
  fillMute(s);
  say(`Уведомления ${muteStatus(s)}.`);
});

loadSettings().then((s) => {
  fill(s);
  fillMute(s);
});
