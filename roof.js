import { calculateSolar } from './solar.js?v=2';
import { loadClimate, localCity, searchAddresses } from './providers.js';
import {
  layoutPanels, manualRect, optimalTilt, rectCenter, rectCorners, rectFromPoints, resizeRect,
  toLocal, winterNoonElevation, PANEL_KW, PANEL_LONG
} from './geometry.js?v=2';
import { createMapView } from './map-view.js?v=2';

// Conditional inputs for the demo. Replace with the regional tariff table and the price list.
const MODES = {
  home: { tariff: 7, price: 70000, selfUse: 60, chips: [1500, 3000, 5000, 10000] },
  business: { tariff: 10, price: 60000, selfUse: 85, chips: [15000, 30000, 60000, 150000] }
};
const BASE_KWH = 150;
const KWH_PER_M2 = 2;
const BATTERY_KWH = 5;
const BATTERY_USABLE = 0.9;
const DISCHARGE_EFFICIENCY = 0.9;
const BACKUP_LOAD_KW = 0.3;
const NIGHT_SHARE = 0.5;
const DEGRADATION = 0.005;
const DRAW_MIN_ZOOM = 16;
const MAX_DRAWN_PANELS = 3000;
const HOME_MAX_PANELS = 30; // 15 kW, the microgeneration limit for selling surplus to the grid
const START = { lat: 47.2357, lng: 39.7015 };
const MONTH_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTH_LETTER = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д'];
const MONTH_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const $ = id => document.getElementById(id);
const fmt = (value, digits = 0) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const money = value => fmt(Math.round(value / (Math.abs(value) >= 10000 ? 100 : 10)) * (Math.abs(value) >= 10000 ? 100 : 10));
const energy = value => fmt(value >= 1000 ? Math.round(value / 10) * 10 : Math.round(value));
const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = text => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

function plural(value, [one, few, many]) {
  const n = Math.abs(Math.round(value));
  if (n % 100 >= 11 && n % 100 <= 14) return many;
  if (n % 10 === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 ? few : many;
}

function years(value) {
  if (value >= 10) {
    const rounded = Math.round(value);
    return `${rounded} ${plural(rounded, ['год', 'года', 'лет'])}`;
  }
  const rounded = Math.round(value * 2) / 2;
  return Number.isInteger(rounded) ? `${rounded} ${plural(rounded, ['год', 'года', 'лет'])}` : `${fmt(rounded, 1)} года`;
}

function parseNumber(text) {
  const value = Number(String(text).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const state = {
  points: [],
  rect: null,
  layout: null,
  roof: 'pitched',
  azimuth: 180,
  tilt: 30,
  mode: 'home',
  bill: null,
  houseArea: null,
  tariff: null,
  price: null,
  selfUse: null,
  panels: null,
  chosen: null,
  here: null,
  shown: false
};

// ---------- Map ----------
// The map view is created once the Yandex (or fallback) API has loaded; until then it is null.
let view = null;

function setHint(text) {
  $('draw-hint').textContent = text;
}

function updateHint() {
  if (state.rect) setHint('Готово! Белые точки можно перетащить, чтобы точнее совпасть с краями крыши.');
  else if (state.points.length === 2) setHint('Теперь нажмите на противоположный край крыши — это линия Б.');
  else if (state.points.length === 1) setHint('Нажмите на соседний угол — получится линия А.');
  else if (!view || view.getZoom() < DRAW_MIN_ZOOM) setHint('Приблизьте карту к своему дому.');
  else setHint('Нажмите на угол крыши — это начало линии А.');
}

function updateTools() {
  const empty = !state.rect && state.points.length === 0;
  $('undo').disabled = empty;
  $('restart').disabled = empty;
}

function handlePositions() {
  if (!state.rect) return state.points;
  const corners = rectCorners(state.rect);
  return [corners[0], corners[1], corners[2]];
}

function syncHandles() {
  view?.handles(handlePositions(), {
    drag: onHandleDrag,
    dragEnd: () => {
      syncHandles();
      roofChanged();
    }
  });
}

let dragFrame = 0;
function onHandleDrag(index, position) {
  if (state.rect) {
    const positions = handlePositions().slice();
    positions[index] = position;
    const rect = rectFromPoints(positions[0], positions[1], positions[2]);
    if (rect) state.rect = rect;
  } else {
    state.points[index] = position;
  }
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = 0;
    redraw();
    updateDims();
    updateLayout();
  });
}

const midpoint = (p, q) => ({ lat: (p.lat + q.lat) / 2, lng: (p.lng + q.lng) / 2 });
const distance = (p, q) => {
  const d = toLocal(p, q);
  return Math.hypot(d.x, d.y);
};

function redraw() {
  if (!view) return;
  if (state.rect) {
    const corners = rectCorners(state.rect);
    view.draw({
      polygons: [{ points: corners, kind: 'roof' }],
      lines: [{ points: [corners[0], corners[1]], kind: 'lineA' }, { points: [corners[1], corners[2]], kind: 'lineB' }],
      labels: [
        { point: midpoint(corners[0], corners[1]), text: `А · ${fmt(state.rect.a, 1)} м` },
        { point: midpoint(corners[1], corners[2]), text: `Б · ${fmt(state.rect.b, 1)} м` }
      ]
    });
  } else if (state.points.length === 2) {
    const [first, second] = state.points;
    view.draw({
      lines: [{ points: [first, second], kind: 'lineA' }],
      labels: [{ point: midpoint(first, second), text: `А · ${fmt(distance(first, second), 1)} м` }]
    });
  } else {
    view.draw({});
  }
}

function clearPreview() {
  view?.preview(null);
}

function onMapMove(position) {
  if (state.rect || !state.points.length) return clearPreview();
  view.preview([state.points[state.points.length - 1], position]);
}

function onMapClick(position) {
  if (state.rect) return;
  if (view.getZoom() < DRAW_MIN_ZOOM) {
    setHint('Сначала приблизьте карту к дому — так углы встанут точнее.');
    return;
  }
  state.points.push(position);
  if (state.points.length === 3) {
    const rect = rectFromPoints(...state.points);
    if (!rect) {
      state.points.pop();
      setHint('Точка слишком близко к линии А. Нажмите на противоположный край крыши.');
      return;
    }
    state.rect = rect;
    clearPreview();
  }
  syncHandles();
  redraw();
  updateHint();
  updateTools();
  if (state.rect) roofChanged();
}

$('undo').addEventListener('click', () => {
  if (state.rect) {
    state.points = handlePositions().slice(0, 2);
    state.rect = null;
  } else {
    state.points.pop();
  }
  clearPreview();
  syncHandles();
  redraw();
  updateHint();
  updateTools();
  roofChanged();
});

$('restart').addEventListener('click', () => {
  state.points = [];
  state.rect = null;
  clearPreview();
  syncHandles();
  redraw();
  updateHint();
  updateTools();
  roofChanged();
});

// ---------- Typed dimensions ----------
function updateDims() {
  const a = $('len-a');
  const b = $('len-b');
  if (state.rect) {
    if (document.activeElement !== a) a.value = fmt(state.rect.a, 1);
    if (document.activeElement !== b) b.value = fmt(state.rect.b, 1);
    $('area-out').textContent = `${fmt(state.rect.a * state.rect.b)} м²`;
  } else {
    $('area-out').textContent = '—';
  }
}

function typedDims() {
  const a = parseNumber($('len-a').value);
  const b = parseNumber($('len-b').value);
  if (!a || !b || a > 500 || b > 500) return;
  if (state.rect) {
    state.rect = resizeRect(state.rect, a, b);
  } else {
    state.rect = manualRect(view ? view.getCenter() : START, a, b);
    view?.fitPoints(rectCorners(state.rect));
  }
  state.points = handlePositions();
  syncHandles();
  redraw();
  updateHint();
  updateTools();
  roofChanged();
}

$('len-a').addEventListener('change', typedDims);
$('len-b').addEventListener('change', typedDims);

// ---------- Panel layout ----------
function flatNote(lat) {
  const tilt = optimalTilt(lat);
  const sun = winterNoonElevation(lat);
  const gap = PANEL_LONG * Math.sin(tilt * Math.PI / 180) / Math.tan(sun * Math.PI / 180);
  return `На плоской крыше панели ставят рядами на юг под углом ${tilt}° — лучший угол для широты ${fmt(lat, 1)}°. `
    + `Между рядами оставляем около ${fmt(gap, 1)} м, чтобы зимой ряды не затеняли друг друга. `
    + 'Чем южнее дом, тем выше зимнее солнце и тем плотнее можно ставить ряды.';
}

function updateLayout() {
  const lat = state.rect ? rectCenter(state.rect).lat : (view ? view.getCenter().lat : START.lat);
  $('flat-note').textContent = flatNote(lat);
  if (!state.rect) {
    state.layout = null;
    $('fit-out').hidden = true;
    return;
  }
  state.layout = layoutPanels(state.rect, { roof: state.roof, azimuth: state.azimuth, tilt: state.tilt, lat });
  drawPanels();
  const { count } = state.layout;
  const fit = $('fit-out');
  fit.hidden = false;
  fit.innerHTML = count
    ? `Поместится до <b>${fmt(count)} ${plural(count, ['панели', 'панелей', 'панелей'])}</b> — до ${fmt(count * PANEL_KW, 1)} кВт.`
    : 'Панель размером 2 × 1,1 м не помещается с отступами от края. Отметьте участок побольше.';
}

// Panels of the chosen station are solid; the rest of the roof's capacity is outlined.
function drawPanels() {
  if (!state.layout) {
    view?.panels([], []);
    return;
  }
  const solid = state.chosen ?? state.layout.count;
  const panels = state.layout.panels.slice(0, MAX_DRAWN_PANELS);
  view?.panels(panels.slice(0, solid), panels.slice(solid));
}

let recalcTimer = 0;
function roofChanged() {
  state.panels = null;
  state.chosen = null;
  updateDims();
  updateLayout();
  updateProgress();
  if (state.shown) {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(() => calculate({ scroll: false }), 250);
  }
}

// ---------- Address search and location ----------
let activeSearch;

function status(text, bad = false) {
  const element = $('search-status');
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle('bad', bad);
}

// Phones get one extra zoom step so that a finger can hit the corners of a small roof.
const closeZoom = () => (window.innerWidth < 600 ? 20 : 19);

function goTo(point, zoom) {
  state.here = point;
  updateProgress();
  view?.setView(point, zoom);
  view?.here(point);
  updateHint();
  updateLayout();
  $('step-roof').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectPlace(place) {
  $('found').hidden = true;
  const zoom = place.kind === 'building' ? closeZoom() : place.kind === 'city' ? 13 : 17;
  status(place.kind === 'building' ? `Показываем: ${place.label}` : `Показываем: ${place.label}. Найдите свой дом на снимке.`);
  goTo({ lat: place.lat, lng: place.lon }, zoom);
}

$('search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('address').value.trim();
  if (query.length < 3) {
    status('Введите город, улицу и номер дома.', true);
    return;
  }
  activeSearch?.abort();
  activeSearch = new AbortController();
  const { signal } = activeSearch;
  $('find').disabled = true;
  status('Ищем адрес…');
  const list = $('found');
  list.hidden = true;
  try {
    const city = localCity(query);
    const places = city ? [city] : await searchAddresses(query, signal);
    if (signal.aborted) return;
    if (!places.length) {
      status('Адрес не найден. Попробуйте написать иначе или найдите дом на карте.', true);
      return;
    }
    if (places.length === 1) {
      selectPlace(places[0]);
      return;
    }
    status('Выберите подходящий адрес:');
    list.replaceChildren(...places.map(place => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `${icon('pin')}<span>${escapeHtml(place.label)}<small>${escapeHtml(place.description)}</small></span>`;
      button.addEventListener('click', () => selectPlace(place));
      item.append(button);
      return item;
    }));
    list.hidden = false;
  } catch (error) {
    if (!signal.aborted) status('Поиск не ответил. Попробуйте ещё раз или найдите дом на карте вручную.', true);
  } finally {
    if (activeSearch?.signal === signal) $('find').disabled = false;
  }
});

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    status('Браузер не умеет определять местоположение. Найдите дом по адресу.', true);
    return;
  }
  status('Определяем местоположение…');
  navigator.geolocation.getCurrentPosition(position => {
    status('Синяя точка — вы. Найдите рядом свою крышу.');
    goTo({ lat: position.coords.latitude, lng: position.coords.longitude }, closeZoom());
  }, error => {
    status(error.code === 1
      ? 'Доступ к местоположению запрещён. Найдите дом по адресу.'
      : 'Не удалось определить местоположение. Найдите дом по адресу.', true);
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});

// ---------- Roof type ----------
function syncRoofControls() {
  $('pitched-opts').hidden = state.roof !== 'pitched';
  $('flat-note').hidden = state.roof !== 'flat';
}

document.querySelectorAll('input[name="roof"]').forEach(input => input.addEventListener('change', () => {
  state.roof = input.value;
  syncRoofControls();
  roofChanged();
}));
document.querySelectorAll('input[name="azimuth"]').forEach(input => input.addEventListener('change', () => {
  state.azimuth = Number(input.value);
  roofChanged();
}));
document.querySelectorAll('input[name="tilt"]').forEach(input => input.addEventListener('change', () => {
  state.tilt = Number(input.value);
  roofChanged();
}));

// ---------- Consumption ----------
const settings = () => {
  const base = MODES[state.mode];
  return {
    tariff: state.tariff ?? base.tariff,
    price: state.price ?? base.price,
    selfUse: (state.selfUse ?? base.selfUse) / 100
  };
};

function renderBillChips() {
  $('bill-chips').replaceChildren(...MODES[state.mode].chips.map(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${fmt(value)} ₽`;
    button.addEventListener('click', () => {
      $('bill').value = fmt(value);
      state.bill = value;
      consumptionChanged();
    });
    return button;
  }));
}

function updateAreaEstimate() {
  const area = state.houseArea;
  const note = $('area-estimate');
  if (!area) {
    note.textContent = `Посчитаем по среднему: ${BASE_KWH} кВт·ч в месяц на базовые приборы и ещё ${KWH_PER_M2} кВт·ч на каждый квадратный метр.`;
    return;
  }
  const kwh = BASE_KWH + KWH_PER_M2 * area;
  note.textContent = `Дом ${fmt(area)} м² тратит в среднем ≈ ${energy(kwh)} кВт·ч в месяц — это ${fmt(kwh / 730, 2)} кВт·ч каждый час, `
    + `или ≈ ${money(kwh * settings().tariff)} ₽ в месяц.`;
}

function syncModeControls() {
  const home = state.mode === 'home';
  $('by-area').hidden = !home;
  $('bill').placeholder = home ? 'Например, 3 000' : 'Например, 30 000';
  renderBillChips();
  $('a-tariff').value = fmt(settings().tariff, 2);
  $('a-price').value = fmt(settings().price);
  $('a-self').value = fmt(settings().selfUse * 100);
}

function consumptionChanged() {
  $('calc-error').hidden = true;
  state.panels = null;
  updateAreaEstimate();
  updateProgress();
  if (state.shown) {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(() => calculate({ scroll: false }), 250);
  }
}

document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', () => {
  state.mode = input.value;
  state.tariff = null;
  state.price = null;
  state.selfUse = null;
  syncModeControls();
  consumptionChanged();
}));

$('bill').addEventListener('input', () => {
  state.bill = parseNumber($('bill').value);
  consumptionChanged();
});
$('house-area').addEventListener('input', () => {
  state.houseArea = parseNumber($('house-area').value);
  consumptionChanged();
});

function assumptionChanged(key, id, scale = 1) {
  $(id).addEventListener('change', () => {
    const value = parseNumber($(id).value);
    state[key] = value === null ? null : value * scale;
    syncModeControls();
    consumptionChanged();
  });
}
assumptionChanged('tariff', 'a-tariff');
assumptionChanged('price', 'a-price');
assumptionChanged('selfUse', 'a-self');

// ---------- Calculation ----------
function fail(message, stepId) {
  const error = $('calc-error');
  error.textContent = message;
  error.hidden = false;
  if (stepId) $(stepId).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let calcToken = 0;
async function calculate({ scroll = true } = {}) {
  $('calc-error').hidden = true;
  if (!state.rect) return fail('Отметьте крышу на карте или введите длину и ширину (шаг 2).', 'step-roof');
  if (!state.layout?.count) return fail('На отмеченном участке не помещается ни одной панели. Отметьте участок побольше.', 'step-roof');

  const { tariff, price, selfUse } = settings();
  let consumption;
  let consumptionText;
  if (state.bill) {
    consumption = state.bill / tariff;
    consumptionText = `по платежу ${money(state.bill)} ₽ и тарифу ${fmt(tariff, 2)} ₽ — ${energy(consumption)} кВт·ч в месяц`;
  } else if (state.mode === 'home' && state.houseArea) {
    consumption = BASE_KWH + KWH_PER_M2 * state.houseArea;
    consumptionText = `по площади дома: ${BASE_KWH} + ${KWH_PER_M2} × ${fmt(state.houseArea)} м² = ${energy(consumption)} кВт·ч в месяц`;
  } else {
    return fail(state.mode === 'home' ? 'Укажите платёж за свет или площадь дома.' : 'Укажите платёж за свет.', 'step-use');
  }

  const token = ++calcToken;
  const button = $('calculate');
  button.disabled = true;
  button.textContent = 'Считаем…';
  const center = rectCenter(state.rect);
  let climate;
  try {
    climate = await loadClimate({ lat: center.lat, lon: center.lng });
  } catch {
    if (token === calcToken) fail('Не удалось загрузить данные о солнце для этой точки. Проверьте интернет и попробуйте ещё раз.');
    return;
  } finally {
    if (token === calcToken) {
      button.disabled = false;
      button.textContent = 'Пересчитать';
    }
  }
  if (token !== calcToken) return;

  const layout = state.layout;
  const options = { lat: center.lat, tilt: layout.tilt, azimuth: layout.azimuth, tariff, selfUse, consumption };
  // Size the station so that a year's output roughly equals a year's consumption, within the roof.
  const perPanel = calculateSolar(climate.irradiation, { ...options, panels: 1 }).annual;
  const capacity = layout.count;
  const needed = Math.max(1, Math.ceil(consumption * 12 / perPanel));
  const limit = state.mode === 'home' ? Math.min(capacity, HOME_MAX_PANELS) : capacity;
  const recommended = Math.min(needed, limit);
  const count = state.panels ? Math.min(state.panels, capacity) : recommended;
  const cost = count * PANEL_KW * price;
  const result = calculateSolar(climate.irradiation, { ...options, panels: count, cost });
  state.chosen = count;
  drawPanels();
  const firstShow = $('result').hidden;
  $('result').hidden = false; // the chart measures its container, so it must be visible first
  if (firstShow) $('result').classList.add('reveal');
  renderResult({ result, layout, count, capacity, needed, recommended, consumption, consumptionText, tariff, price, cost, lat: center.lat });
  state.shown = true;
  writeHash();
  $('result').hidden = false;
  if (scroll) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('calculate').addEventListener('click', () => calculate());
$('lead-button').addEventListener('click', () => {
  $('lead-note').textContent = 'Это демо-версия: форму заявки подключим, когда будут контакты для отправки (Telegram или почта).';
});

function renderResult({ result, layout, count, capacity, needed, recommended, consumption, consumptionText, tariff, price, cost, lat }) {
  const home = state.mode === 'home';
  const power = result.power;
  const panelsWord = plural(count, ['панель', 'панели', 'панелей']);
  const range = $('count-range');
  range.max = String(capacity);
  range.value = String(count);
  $('count-out').textContent = fmt(count);
  let note;
  if (count === recommended) {
    note = recommended < needed
      ? (recommended < capacity
        ? `Для частного дома предлагаем до ${HOME_MAX_PANELS} панелей (15 кВт) — до этой мощности излишки можно продавать в сеть.`
        : `Больше на отмеченный участок не помещается. Чтобы покрыть всё потребление, нужно ${fmt(needed)}.`)
      : 'Столько панелей за год выработают примерно столько же, сколько вы тратите.';
  } else {
    note = `Под ваше потребление рекомендуем ${fmt(recommended)}. На участке помещается до ${fmt(capacity)}.`;
  }
  $('count-note').textContent = note;
  const yearUse = consumption * 12;
  const coverage = Math.min(100, Math.round(result.used / yearUse * 100));
  const surplus = Math.max(0, result.annual - result.used);
  const summer = result.daily[6];
  const winter = result.daily[11];
  const decade = Array.from({ length: 10 }, (_, year) => result.saving * (1 - DEGRADATION) ** year).reduce((a, b) => a + b, 0);
  const dailyUse = consumption * 12 / 365;
  const batteries = Math.min(6, Math.max(1, Math.ceil(dailyUse * NIGHT_SHARE / (BATTERY_KWH * BATTERY_USABLE))));
  const backupHours = BATTERY_KWH * BATTERY_USABLE * DISCHARGE_EFFICIENCY / BACKUP_LOAD_KW;

  const placement = layout.roof === 'flat'
    ? `ряды на юг под углом ${layout.tilt}°, между рядами ${fmt(layout.rowGap, 1)} м, отступ от края 0,5 м`
    : `панели лежат по скату с уклоном ${layout.tilt}°, отступ от края 0,3 м`;

  const monthSaving = result.saving / 12;
  const selfShare = result.annual ? Math.round(result.used / result.annual * 100) : 0;
  $('result-hero').innerHTML = `
    <p class="saving-label">Вы сэкономите</p>
    <p class="saving">≈ ${money(monthSaving)} ₽<small> в месяц</small></p>
    <p class="saving-sub">≈ ${money(result.saving)} ₽ в год</p>
    <div class="coverage" role="img" aria-label="Панели закроют ${coverage}% счёта за свет"><i style="width:${coverage}%"></i></div>
    <div class="coverage-label"><span>Панели закроют ${coverage}% счёта</span><span>100%</span></div>
    <span class="station">${icon('panel')}${fmt(count)} ${panelsWord} · ${fmt(power, 1)} кВт</span>`;

  $('result-body').innerHTML = `
    <div class="kpis">
      <div class="kpi"><i class="kpi-icon">${icon('zap')}</i><span>Выработка за год</span><b>${energy(result.annual)} кВт·ч</b>
        <small>летом ≈ ${fmt(summer, summer < 10 ? 1 : 0)} кВт·ч в день, зимой ≈ ${fmt(winter, 1)}</small></div>
      <div class="kpi"><i class="kpi-icon">${icon('clock')}</i><span>Окупаемость</span><b>${result.payback ? `≈ ${years(result.payback)}` : '—'}</b>
        <small>без учёта продажи излишков</small></div>
      <div class="kpi"><i class="kpi-icon">${icon('wallet')}</i><span>Стоимость станции</span><b>≈ ${money(cost)} ₽</b>
        <small>при ${money(price)} ₽ за 1 кВт под ключ</small></div>
      <div class="kpi"><i class="kpi-icon">${icon('home')}</i><span>Ваш расход</span><b>${energy(consumption)} кВт·ч</b>
        <small>в месяц · ≈ ${fmt(consumption / 730, 2)} кВт·ч каждый час</small></div>
    </div>
    <div class="card">
      <h3>${icon('sun')}Выработка по месяцам</h3>
      <div class="legend"><span><i class="sw-bar"></i>Выработка панелей</span><span><i class="sw-ref"></i>Ваше потребление</span></div>
      <div class="chart" id="chart"></div>
      <details class="table-view"><summary>Показать таблицей</summary>
        <table><thead><tr><th>Месяц</th><th>Выработка, кВт·ч</th><th>Потребление, кВт·ч</th></tr></thead>
        <tbody>${result.monthly.map((value, index) => `<tr><td>${MONTH_FULL[index]}</td><td>${energy(value)}</td><td>${energy(consumption)}</td></tr>`).join('')}</tbody></table>
      </details>
    </div>
    <div class="card">
      <h3>${icon('zap')}Куда уходит энергия</h3>
      <div class="split" role="img" aria-label="Сразу тратится ${selfShare}%, излишки ${100 - selfShare}%"><i class="self" style="width:${selfShare}%"></i><i class="extra" style="flex:1"></i></div>
      <div class="legend"><span><i class="sw-self"></i>Сразу тратится — ${energy(result.used)} кВт·ч</span><span><i class="sw-extra"></i>Излишки — ${energy(surplus)} кВт·ч</span></div>
      <p>${surplus > 1 ? `Излишки можно продать в сеть${home ? ' или запасти в аккумуляторе' : ''}. В экономию они не включены.` : 'Излишков почти нет — вся энергия уходит на свои нужды.'}</p>
    </div>
    ${home ? `<div class="card">
      <h3>${icon('battery')}Аккумуляторы</h3>
      <div class="batteries" aria-hidden="true">${icon('battery').repeat(batteries)}</div>
      <p>Чтобы вечером и ночью тоже жить от солнца, нужно примерно <b>${batteries} ${plural(batteries, ['аккумулятор', 'аккумулятора', 'аккумуляторов'])} по ${BATTERY_KWH} кВт·ч</b>.
      Если отключат свет, один аккумулятор продержит холодильник, свет и роутер (≈ 300 Вт) около <b>${fmt(Math.floor(backupHours))} часов</b>.</p>
    </div>` : `<div class="card">
      <h3>${icon('wallet')}За 10 лет</h3>
      <p>Экономия за 10 лет — около <b>${money(decade)} ₽</b> по сегодняшнему тарифу, с учётом износа панелей 0,5% в год. Если тариф будет расти, экономия будет больше.</p>
    </div>`}
    <div class="actions">
      <button type="button" class="btn ghost" id="show-map">${icon('map')}Панели на карте</button>
      <button type="button" class="btn ghost" id="share">${icon('share')}Поделиться</button>
    </div>`;

  $('assume-list').innerHTML = `
    <li>Солнце: многолетние данные NASA POWER для точки ${fmt(lat, 2)}° с. ш.</li>
    <li>Панель Delta PV TOP 500 Вт, 1961 × 1134 мм: ${placement}.</li>
    <li>Потери в инверторе, проводах, от нагрева и пыли — 20%.</li>
    <li>Потребление ${consumptionText}.</li>
    <li>${home ? 'Дом' : 'Предприятие'} сразу тратит ${fmt(settings().selfUse * 100)}% выработки, остальное — излишки.</li>
    <li>Тариф ${fmt(tariff, 2)} ₽ и цена ${money(price)} ₽ за кВт — условные, для примера. Перед запуском подставим тарифы региона и прайс.</li>`;

  lastChart = { monthly: result.monthly, consumption };
  drawChart();
  $('show-map').addEventListener('click', () => {
    $('step-roof').scrollIntoView({ behavior: 'smooth', block: 'start' });
    view?.fitPoints(rectCorners(state.rect));
  });
  $('share').addEventListener('click', share);
}

// ---------- Chart ----------
let lastChart = null;

function niceStep(max) {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(k => k * power).find(step => step >= raw);
}

function drawChart() {
  const box = $('chart');
  if (!box || !lastChart) return;
  const { monthly, consumption } = lastChart;
  const width = Math.max(280, box.clientWidth || 600);
  const height = 210;
  const left = 46;
  const right = 6;
  const top = 10;
  const bottom = 24;
  const step = niceStep(Math.max(...monthly, consumption) * 1.05);
  const max = step * Math.ceil(Math.max(...monthly, consumption) * 1.05 / step);
  const y = value => top + (height - top - bottom) * (1 - value / max);
  const band = (width - left - right) / 12;
  const barWidth = Math.max(6, Math.min(36, band - 6));
  const labels = band < 34 ? MONTH_LETTER : MONTH_SHORT;

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Выработка панелей по месяцам и среднее потребление">`;
  for (let value = 0; value <= max + 1e-9; value += step) {
    svg += `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/>`;
    svg += `<text class="axis" x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${fmt(value)}</text>`;
  }
  monthly.forEach((value, index) => {
    const x = left + band * index + (band - barWidth) / 2;
    const y0 = y(0);
    const y1 = y(value);
    const r = Math.min(4, barWidth / 2, Math.max(0, y0 - y1));
    const path = `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barWidth - r} Q${x + barWidth},${y1} ${x + barWidth},${y1 + r} V${y0} Z`;
    svg += `<rect class="hit" data-i="${index}" x="${left + band * index}" y="${top}" width="${band}" height="${height - top - bottom}"/>`;
    svg += `<path class="bar" d="${path}"/>`;
    svg += `<text class="axis" x="${left + band * index + band / 2}" y="${height - 6}" text-anchor="middle">${labels[index]}</text>`;
  });
  svg += `<line class="ref" x1="${left}" x2="${width - right}" y1="${y(consumption)}" y2="${y(consumption)}"/>`;
  svg += '</svg><div class="tip" hidden></div>';
  box.innerHTML = svg;

  const tip = box.querySelector('.tip');
  const bars = box.querySelectorAll('.bar');
  const show = index => {
    bars.forEach((bar, i) => bar.classList.toggle('on', i === index));
    tip.innerHTML = `<b>${MONTH_FULL[index]}</b><br>Выработка: ${energy(monthly[index])} кВт·ч<br>Потребление: ${energy(consumption)} кВт·ч`;
    tip.hidden = false;
    const half = tip.offsetWidth / 2 + 4;
    const x = Math.min(Math.max(left + band * index + band / 2, half), width - half);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.min(y(monthly[index]), y(consumption))}px`;
  };
  const hide = () => {
    tip.hidden = true;
    bars.forEach(bar => bar.classList.remove('on'));
  };
  box.querySelectorAll('.hit').forEach(hit => {
    const index = Number(hit.dataset.i);
    hit.addEventListener('pointerenter', () => show(index));
    hit.addEventListener('click', () => show(index));
  });
  box.querySelector('svg').addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse') hide();
  });
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 150);
});

// ---------- Share link ----------
function writeHash() {
  const params = new URLSearchParams();
  if (state.rect) {
    params.set('r', handlePositions().map(point => `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`).join(';'));
  }
  params.set('roof', state.roof);
  if (state.roof === 'pitched') {
    params.set('az', state.azimuth);
    params.set('tilt', state.tilt);
  }
  params.set('mode', state.mode);
  if (state.bill) params.set('bill', state.bill);
  if (state.houseArea) params.set('area', state.houseArea);
  if (state.tariff) params.set('tariff', state.tariff);
  if (state.price) params.set('price', state.price);
  if (state.selfUse) params.set('self', state.selfUse);
  if (state.panels) params.set('n', state.panels);
  history.replaceState(null, '', `#${params}`);
}

async function share() {
  writeHash();
  const button = $('share');
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Мой расчёт солнечных панелей', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    button.textContent = 'Ссылка скопирована';
  } catch (error) {
    if (error?.name !== 'AbortError') button.textContent = 'Скопируйте адрес страницы';
  }
}

function setRadio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
  return Boolean(input);
}

function restore() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (setRadio('roof', params.get('roof'))) state.roof = params.get('roof');
  if (setRadio('azimuth', params.get('az'))) state.azimuth = Number(params.get('az'));
  if (setRadio('tilt', params.get('tilt'))) state.tilt = Number(params.get('tilt'));
  if (setRadio('mode', params.get('mode'))) state.mode = params.get('mode');
  state.bill = parseNumber(params.get('bill') ?? '');
  state.houseArea = parseNumber(params.get('area') ?? '');
  state.tariff = parseNumber(params.get('tariff') ?? '');
  state.price = parseNumber(params.get('price') ?? '');
  state.selfUse = parseNumber(params.get('self') ?? '');
  const panels = parseNumber(params.get('n') ?? '');
  if (state.bill) $('bill').value = fmt(state.bill);
  if (state.houseArea) {
    $('house-area').value = fmt(state.houseArea);
    if (!state.bill) $('by-area').open = true;
  }
  const points = (params.get('r') ?? '').split(';').map(pair => pair.split(',').map(Number))
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
    .map(([lat, lng]) => ({ lat, lng }));
  if (points.length === 3) {
    state.rect = rectFromPoints(...points);
    if (state.rect) state.points = handlePositions();
  }
  return { ready: Boolean(state.rect && (state.bill || state.houseArea)), panels };
}

$('count-range').addEventListener('input', () => {
  state.panels = Number($('count-range').value);
  $('count-out').textContent = fmt(state.panels);
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => calculate({ scroll: false }), 120);
});

// ---------- Map events ----------
function attachView() {
  document.documentElement.dataset.map = view?.provider ?? 'none';
  $('map-note').hidden = view?.provider !== 'esri';
  if (!view) return;
  view.onClick(onMapClick);
  view.onMove(onMapMove);
  view.onZoom(updateHint);
  if (state.here) view.here(state.here);
  syncHandles();
  redraw();
  drawPanels();
  updateHint();
}

// ---------- Step progress ----------
const progressLinks = [...document.querySelectorAll('.progress a')];
function updateProgress() {
  const done = {
    place: Boolean(state.here || state.rect),
    roof: Boolean(state.layout?.count),
    type: Boolean(state.layout?.count),
    use: Boolean(state.bill || (state.mode === 'home' && state.houseArea))
  };
  for (const link of progressLinks) {
    const finished = done[link.dataset.step];
    link.classList.toggle('done', finished);
    link.querySelector('.dot').innerHTML = finished ? icon('check') : String(progressLinks.indexOf(link) + 1);
  }
}

if ('IntersectionObserver' in window) {
  const watcher = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const step = entry.target.id.replace('step-', '');
      progressLinks.forEach(link => link.classList.toggle('active', link.dataset.step === step));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('.step').forEach(step => watcher.observe(step));
}

// ---------- Start ----------
async function start() {
  const restored = restore();
  syncRoofControls();
  syncModeControls();
  updateAreaEstimate();
  updateDims();
  updateLayout();
  updateTools();
  try {
    view = await createMapView($('map'), { center: START, zoom: 12 });
  } catch (error) {
    console.error(error);
    $('map').textContent = 'Карта не загрузилась. Введите длину и ширину крыши вручную.';
  }
  attachView();
  if (view && state.rect) view.fitPoints(rectCorners(state.rect));
  roofChanged();
  if (restored.ready) {
    state.panels = restored.panels && Math.round(restored.panels);
    calculate({ scroll: false });
  }
}

start();
