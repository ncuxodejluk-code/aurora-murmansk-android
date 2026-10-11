// Мост между страницей и Android-приложением.
// Подменяет chrome.storage.local (хранилище в приложении, общее для всех экранов
// и фоновой проверки) и пропускает запросы к NOAA, NASA и Open-Meteo через приложение,
// чтобы браузерные ограничения CORS не мешали.
(function () {
  'use strict';
  var B = window.AuroraBridge;
  if (!B) {
    console.error('AuroraBridge недоступен');
    return;
  }

  var listeners = [];

  function read(key) {
    var raw = B.storageGet(key);
    return raw == null ? undefined : JSON.parse(raw);
  }

  function keyList(keys) {
    if (keys == null) return JSON.parse(B.storageKeys());
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    return Object.keys(keys);
  }

  function fire(changes) {
    listeners.slice().forEach(function (fn) {
      try {
        fn(changes, 'local');
      } catch (e) {
        console.error(e);
      }
    });
  }

  var local = {
    get: function (keys) {
      return new Promise(function (resolve) {
        var out = {};
        keyList(keys).forEach(function (k) {
          var v = read(k);
          if (v !== undefined) out[k] = v;
        });
        resolve(out);
      });
    },
    set: function (items) {
      return new Promise(function (resolve) {
        var keys = Object.keys(items);
        var changes = {};
        keys.forEach(function (k) {
          var oldValue = read(k);
          var json = JSON.stringify(items[k] === undefined ? null : items[k]);
          B.storageSet(k, json);
          changes[k] = { oldValue: oldValue, newValue: JSON.parse(json) };
        });
        B.storageChanged(JSON.stringify(keys));
        fire(changes);
        resolve();
      });
    },
    remove: function (keys) {
      return new Promise(function (resolve) {
        var list = keyList(keys);
        var changes = {};
        list.forEach(function (k) {
          changes[k] = { oldValue: read(k), newValue: undefined };
          B.storageRemove(k);
        });
        B.storageChanged(JSON.stringify(list));
        fire(changes);
        resolve();
      });
    },
  };

  // Вызывается приложением, когда данные поменял другой экран или фоновая проверка.
  window.__auroraStorageChanged = function (keys) {
    var changes = {};
    keys.forEach(function (k) {
      changes[k] = { newValue: read(k) };
    });
    fire(changes);
  };

  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: local,
    onChanged: {
      addListener: function (fn) {
        listeners.push(fn);
      },
      removeListener: function (fn) {
        listeners = listeners.filter(function (x) {
          return x !== fn;
        });
      },
    },
  };

  var HOSTS = /^https:\/\/(services\.swpc\.noaa\.gov|ccmc\.gsfc\.nasa\.gov|api\.open-meteo\.com|api\.met\.no)\//;
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (!url || !HOSTS.test(url)) return realFetch(input, init);
    return realFetch('/net?u=' + encodeURIComponent(url), init).then(function (res) {
      // Приложение помечает так обрыв связи, чтобы ошибка читалась как «нет связи с сервером».
      if (res.headers.get('X-Aurora-Error') === 'network') throw new TypeError('network');
      return res;
    });
  };
})();
