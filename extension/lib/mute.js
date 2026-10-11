// Пауза уведомлений: на время или пока пользователь сам не включит.
// Хранится в settings.notifyPausedUntil: null — включены, число — выключены до этого момента,
// 'forever' — выключены совсем.

import * as F from './format.js';

const HOUR = 3600000;

export function isMuted(settings, now = Date.now()) {
  const u = settings?.notifyPausedUntil;
  return u === 'forever' || (typeof u === 'number' && u > now);
}

/** Ближайшие 9:00 по Москве (UTC+3, без перехода на летнее время). */
function nextMorning(now) {
  const msk = new Date(now + 3 * HOUR);
  let t = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), 9, 0) - 3 * HOUR;
  if (t <= now + 30 * 60000) t += 24 * HOUR;
  return t;
}

export function untilFor(choice, now = Date.now()) {
  switch (choice) {
    case '1h':
      return now + HOUR;
    case '3h':
      return now + 3 * HOUR;
    case 'morning':
      return nextMorning(now);
    case 'day':
      return now + 24 * HOUR;
    case 'forever':
      return 'forever';
    default:
      return null;
  }
}

/** Короткое состояние: «включены», «выключены до 14:00», «выключены, пока не включите». */
export function muteStatus(settings, now = Date.now()) {
  if (!isMuted(settings, now)) return 'включены';
  const u = settings.notifyPausedUntil;
  if (u === 'forever') return 'выключены, пока не включите';
  const sameDay = F.localParts(u).key === F.localParts(now).key;
  return `выключены до ${sameDay ? F.time(u) : F.dayTime(u)}`;
}

/** Варианты для выпадающего списка: первым идёт текущее состояние. */
export function muteOptions(settings, now = Date.now()) {
  const muted = isMuted(settings, now);
  const opts = [{ value: 'current', label: muteStatus(settings, now) }];
  if (muted) opts.push({ value: 'on', label: 'включить' });
  opts.push(
    { value: '1h', label: 'выключить на 1 час' },
    { value: '3h', label: 'выключить на 3 часа' },
    { value: 'morning', label: 'выключить до 9 утра' },
    { value: 'day', label: 'выключить на сутки' },
  );
  if (settings?.notifyPausedUntil !== 'forever') opts.push({ value: 'forever', label: 'выключить совсем' });
  return opts;
}
