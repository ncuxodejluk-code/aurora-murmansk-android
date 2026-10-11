import { DEFAULT_PLACE, normalizePlaces } from './places.js';

export const DEFAULTS = {
  intervalMin: 15,
  // Выбранное место. Хранится для расчёта, а сам список — в places.
  location: { name: DEFAULT_PLACE.name, lat: DEFAULT_PLACE.lat, lon: DEFAULT_PLACE.lon },
  places: [{ ...DEFAULT_PLACE }],
  placeId: DEFAULT_PLACE.id,
  flareMinClass: 'M1',
  useClouds: true,
  notifyFlares: true,
  notifyArrivals: true,
  notifyNow: true,
  notifyNight: true,
  notifyPausedUntil: null, // null — включены, число — выключены до этого времени, 'forever' — совсем
};

export const INTERVALS = [10, 15, 30, 60, 180];

export function withDefaults(saved) {
  const s = { ...DEFAULTS, ...(saved || {}) };
  const { places, placeId } = normalizePlaces(saved);
  s.places = places;
  s.placeId = placeId;
  const p = places.find((x) => x.id === placeId);
  s.location = { name: p.name, lat: p.lat, lon: p.lon };
  if (!INTERVALS.includes(Number(s.intervalMin))) s.intervalMin = DEFAULTS.intervalMin;
  if (s.notifyPausedUntil !== 'forever' && typeof s.notifyPausedUntil !== 'number') s.notifyPausedUntil = null;
  return s;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return withDefaults(settings);
}

/** Сохраняет изменения. Место выбирается через placeId и places, settings.location пересчитывается само. */
export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = withDefaults({ ...current, ...patch });
  await chrome.storage.local.set({ settings: next });
  return next;
}
