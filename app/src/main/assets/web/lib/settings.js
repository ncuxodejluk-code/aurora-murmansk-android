export const DEFAULTS = {
  intervalMin: 15,
  location: { name: 'Мурманск', lat: 68.9585, lon: 33.0827 },
  flareMinClass: 'M1',
  useClouds: true,
  notifyFlares: true,
  notifyArrivals: true,
  notifyNow: true,
  notifyNight: true,
};

export const INTERVALS = [10, 15, 30, 60, 180];

export function withDefaults(saved) {
  const s = { ...DEFAULTS, ...(saved || {}) };
  s.location = { ...DEFAULTS.location, ...(saved?.location || {}) };
  if (!INTERVALS.includes(Number(s.intervalMin))) s.intervalMin = DEFAULTS.intervalMin;
  return s;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return withDefaults(settings);
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = withDefaults({ ...current, ...patch, location: { ...current.location, ...(patch.location || {}) } });
  await chrome.storage.local.set({ settings: next });
  return next;
}
