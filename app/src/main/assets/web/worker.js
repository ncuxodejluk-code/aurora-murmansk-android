// Фоновая проверка: приложение открывает эту страницу в невидимом WebView по расписанию.
import { refresh } from './refresh.js';

const B = window.AuroraBridge;
refresh('alarm').then(
  () => B.workerDone(true),
  (e) => {
    console.error('фоновая проверка', e);
    B.workerDone(false);
  },
);
