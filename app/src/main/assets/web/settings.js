import { loadSettings, saveSettings } from './lib/settings.js';
import { muteOptions, muteStatus, untilFor } from './lib/mute.js';
import { mountPlaces } from './lib/places-ui.js';

const $ = (id) => document.getElementById(id);

function fill(s) {
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

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({
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

$('open-logs').addEventListener('click', () => window.AuroraBridge.openLogs());

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

mountPlaces({ paste: async () => window.AuroraBridge.clipboardText() }).then(() => {
  // С главного экрана пришли по «Добавить место…»
  if (location.hash === '#places') {
    $('places').scrollIntoView({ block: 'start' });
  }
});
