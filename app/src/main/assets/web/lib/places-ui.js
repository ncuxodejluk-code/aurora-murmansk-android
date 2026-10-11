// Блок «Места наблюдения» на странице настроек: список мест и добавление нового по координатам.
// Общий для расширения и приложения. Все изменения сохраняются сразу, без кнопки «Сохранить».

import { loadSettings, saveSettings } from './settings.js';
import {
  MAX_PLACES,
  parseCoords,
  coordsText,
  coordsHuman,
  findNear,
  addPlacePatch,
  renamePlacePatch,
  removePlacePatch,
  restorePlacePatch,
} from './places.js';

const SVG = 'http://www.w3.org/2000/svg';

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

function icon(d) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

const PENCIL = 'M10.8 2.6l2.6 2.6-7.6 7.6-3.1.5.5-3.1z M9.4 4l2.6 2.6';
const CROSS = 'M4 4l8 8M12 4l-8 8';

/**
 * paste — необязательная функция, которая возвращает текст из буфера обмена (в приложении).
 */
export function mountPlaces({ paste } = {}) {
  const $ = (id) => document.getElementById(id);
  const list = $('place-list');
  const coords = $('coords');
  const result = $('coords-result');
  const nameStep = $('name-step');
  const nameInput = $('place-name');
  const status = $('places-status');
  const pasteBtn = $('coords-paste');

  let settings = null;
  let parsed = null;
  let editing = null;
  let editValue = '';

  // ───── Список ─────

  function renderList() {
    if (!settings) return;
    list.replaceChildren(...settings.places.map((p, i) => item(p, i)));
    if (editing) {
      const input = list.querySelector('.place-rename');
      if (input && document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  function item(p, i) {
    const active = p.id === settings.placeId;
    if (editing === p.id) {
      const input = h('input', {
        class: 'place-rename',
        type: 'text',
        maxlength: '40',
        value: editValue,
        'aria-label': `Новое название для «${p.name}»`,
        oninput: (e) => (editValue = e.target.value),
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitRename(p);
          } else if (e.key === 'Escape') {
            editing = null;
            renderList();
          }
        },
      });
      return h(
        'li',
        { class: 'place-item is-editing' },
        input,
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => commitRename(p) }, 'Сохранить'),
        h(
          'button',
          {
            class: 'link',
            type: 'button',
            onclick: () => {
              editing = null;
              renderList();
            },
          },
          'Отмена',
        ),
      );
    }
    return h(
      'li',
      { class: `place-item${active ? ' is-active' : ''}` },
      h(
        'button',
        { class: 'place-pick', type: 'button', 'aria-pressed': String(active), onclick: () => choose(p) },
        h('span', { class: 'place-radio', 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'place-text' },
          h('span', { class: 'place-title' }, p.name),
          h('span', { class: 'place-coords' }, coordsText(p.lat, p.lon, 4)),
        ),
        active ? h('span', { class: 'place-badge' }, 'выбрано') : null,
      ),
      h(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          title: 'Переименовать',
          'aria-label': `Переименовать «${p.name}»`,
          onclick: () => {
            editing = p.id;
            editValue = p.name;
            renderList();
          },
        },
        icon(PENCIL),
      ),
      settings.places.length > 1
        ? h(
            'button',
            { class: 'icon-btn', type: 'button', title: 'Удалить', 'aria-label': `Удалить «${p.name}»`, onclick: () => remove(p, i) },
            icon(CROSS),
          )
        : null,
    );
  }

  async function choose(p) {
    if (p.id === settings.placeId) return;
    settings = await saveSettings({ placeId: p.id });
    renderList();
    say(`Выбрано место «${p.name}». Прогноз пересчитывается.`);
  }

  async function commitRename(p) {
    const patch = renamePlacePatch(await loadSettings(), p.id, editValue);
    if (!patch) {
      say('Название не может быть пустым.', true);
      return;
    }
    editing = null;
    settings = await saveSettings(patch);
    renderList();
    say(`Название сохранено: «${editValue.trim()}».`);
  }

  async function remove(p, index) {
    const current = await loadSettings();
    const wasActive = p.id === current.placeId;
    const patch = removePlacePatch(current, p.id);
    if (!patch) return;
    settings = await saveSettings(patch);
    renderList();
    say(
      wasActive ? `Место «${p.name}» удалено, выбрано «${settings.location.name}».` : `Место «${p.name}» удалено.`,
      false,
      {
        label: 'Вернуть',
        run: async () => {
          const back = restorePlacePatch(await loadSettings(), p, index, wasActive);
          if (back) settings = await saveSettings(back);
          renderList();
          say(`Место «${p.name}» возвращено.`);
        },
      },
    );
  }

  // ───── Новое место ─────

  /** fix — привести запись к правильному виду (после вставки, Enter или ухода с поля). */
  function analyse(fix) {
    const r = parseCoords(coords.value);
    parsed = r.ok ? r : null;
    if (r.ok && fix && coords.value.trim() !== r.text) coords.value = r.text;
    coords.setAttribute('aria-invalid', String(!r.ok && r.reason !== 'empty' && fix));
    renderResult(r, fix);
  }

  function renderResult(r, fix) {
    result.classList.remove('is-error', 'is-ok', 'is-soft');
    if (r.reason === 'empty') {
      result.replaceChildren();
      nameStep.hidden = true;
      return;
    }
    if (!r.ok) {
      // Пока человек печатает, не ругаемся на неполный ввод.
      result.classList.add(fix || !['one', 'none'].includes(r.reason) ? 'is-error' : 'is-soft');
      result.replaceChildren(fix || !['one', 'none'].includes(r.reason) ? r.message : 'Нужны две координаты — широта и долгота.');
      nameStep.hidden = true;
      return;
    }
    const dup = findNear(settings.places, r.lat, r.lon);
    if (dup) {
      result.classList.add('is-ok');
      result.replaceChildren(
        `Это место уже есть в списке — «${dup.name}». `,
        dup.id === settings.placeId
          ? 'Оно и так выбрано.'
          : h(
              'button',
              {
                class: 'link',
                type: 'button',
                onclick: async () => {
                  await choose(dup);
                  resetForm();
                },
              },
              'Выбрать его',
            ),
      );
      nameStep.hidden = true;
      return;
    }
    const notes = [];
    if (r.swapped) notes.push('Похоже, сначала была долгота — поменял местами.');
    if (r.center) notes.push('В ссылке нет отмеченной точки, взят центр карты — проверьте, что это нужное место.');
    if (r.warning) notes.push(r.warning);
    result.classList.add('is-ok');
    result.replaceChildren(
      h('span', { class: 'coords-ok' }, `✓ ${coordsHuman(r.lat, r.lon)}`),
      ...notes.map((n) => h('span', { class: 'coords-note' }, n)),
    );
    const wasHidden = nameStep.hidden;
    nameStep.hidden = false;
    if (r.name && !nameInput.value.trim()) nameInput.value = r.name;
    if (fix && wasHidden) nameInput.focus();
  }

  async function savePlace() {
    if (!parsed) {
      analyse(true);
      if (!parsed) return;
    }
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      say('Введите название места — так его будет проще найти в списке.', true);
      return;
    }
    const current = await loadSettings();
    if (current.places.length >= MAX_PLACES) {
      say(`В списке уже ${MAX_PLACES} мест — удалите ненужные, чтобы добавить новое.`, true);
      return;
    }
    const { added, ...patch } = addPlacePatch(current, { name, lat: parsed.lat, lon: parsed.lon });
    settings = await saveSettings(patch);
    resetForm();
    renderList();
    say(`Место «${added.name}» сохранено и выбрано. Прогноз пересчитывается.`);
  }

  function resetForm() {
    coords.value = '';
    nameInput.value = '';
    nameInput.removeAttribute('aria-invalid');
    coords.removeAttribute('aria-invalid');
    parsed = null;
    result.replaceChildren();
    nameStep.hidden = true;
  }

  // ───── Сообщения ─────

  let undoAction = null;
  function say(text, error = false, action = null) {
    undoAction = action;
    status.classList.toggle('is-error', error);
    status.replaceChildren(
      text,
      action ? ' ' : '',
      action
        ? h(
            'button',
            {
              class: 'link',
              type: 'button',
              onclick: () => {
                const a = undoAction;
                undoAction = null;
                a?.run();
              },
            },
            action.label,
          )
        : '',
    );
  }

  // ───── События ─────

  coords.addEventListener('input', () => analyse(false));
  coords.addEventListener('paste', () => setTimeout(() => analyse(true), 0));
  coords.addEventListener('change', () => analyse(true));
  coords.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    analyse(true);
    if (parsed && !nameStep.hidden) nameInput.focus();
  });
  nameInput.addEventListener('input', () => nameInput.removeAttribute('aria-invalid'));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      savePlace();
    } else if (e.key === 'Escape') resetForm();
  });
  $('place-save').addEventListener('click', savePlace);
  $('place-cancel').addEventListener('click', () => {
    resetForm();
    coords.focus();
  });

  if (pasteBtn) {
    if (!paste) pasteBtn.hidden = true;
    else {
      pasteBtn.addEventListener('click', async () => {
        let text = '';
        try {
          text = (await paste()) || '';
        } catch (e) {
          text = '';
        }
        if (!text.trim()) {
          say('В буфере обмена пусто. Скопируйте координаты на карте и нажмите «Вставить» ещё раз.', true);
          coords.focus();
          return;
        }
        coords.value = text.trim();
        analyse(true);
      });
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    loadSettings().then((s) => {
      settings = s;
      renderList();
      if (coords.value.trim()) analyse(false);
    });
  });

  return loadSettings().then((s) => {
    settings = s;
    renderList();
    return s;
  });
}
