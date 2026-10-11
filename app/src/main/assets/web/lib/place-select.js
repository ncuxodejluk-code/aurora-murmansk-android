// Быстрое переключение мест в шапке окна прогноза.

import { saveSettings } from './settings.js';
import { coordsText } from './places.js';

const ADD = '__add';

export function renderPlaceSelect(sel, settings) {
  const sig = JSON.stringify([settings.placeId, settings.places.map((p) => [p.id, p.name])]);
  if (sel.dataset.sig === sig) {
    // Браузер мог вернуть старое значение списка при переходе «назад».
    if (sel.value !== settings.placeId) sel.value = settings.placeId;
    return;
  }
  sel.dataset.sig = sig;
  const opt = (value, label, extra = {}) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if (extra.disabled) o.disabled = true;
    return o;
  };
  sel.replaceChildren(
    ...settings.places.map((p) => opt(p.id, p.name)),
    opt('', '──────────', { disabled: true }),
    opt(ADD, settings.places.length > 1 ? 'Добавить или изменить места…' : 'Добавить место…'),
  );
  sel.value = settings.placeId;
  sel.title = `${settings.location.name}: ${coordsText(settings.location.lat, settings.location.lon, 4)}`;
  fitWidth(sel, settings.location.name);
}

let canvas = null;

/** Ширина списка — по выбранному названию, а не по самому длинному пункту. */
function fitWidth(sel, text) {
  try {
    const cs = getComputedStyle(sel);
    canvas ||= document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const extra =
      parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    sel.style.width = `${Math.ceil(ctx.measureText(text).width + extra + 2)}px`;
  } catch {
    sel.style.width = '';
  }
}

/** Шрифт мог догрузиться позже — пересчитать ширину. */
export function refitPlaceSelect(sel, settings) {
  fitWidth(sel, settings.location.name);
}

/** openManager — открыть настройки на блоке мест. */
export function bindPlaceSelect(sel, { getSettings, openManager }) {
  sel.addEventListener('change', async () => {
    const s = getSettings();
    const v = sel.value;
    if (v === ADD || !v) {
      sel.value = s.placeId;
      openManager();
      return;
    }
    if (v !== s.placeId) await saveSettings({ placeId: v });
  });
}
