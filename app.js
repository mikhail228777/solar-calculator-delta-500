import { calculateSolar, MONTHS, PANEL, SELF_USE, SYSTEM_LOSS } from './solar.js';
import { loadClimate, localCity, searchAddresses } from './providers.js';

const element = id => document.getElementById(id);
const form = element('calculator');
const address = element('address');
const find = element('find');
const calculate = element('calculate');
const addressResults = element('address-results');
const results = element('results');
const initialLocation = localCity('Ростов-на-Дону');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const format = (number, decimals = 0) => number.toLocaleString('ru-RU', { maximumFractionDigits: decimals });
const pluralYears = value => {
  if (!Number.isInteger(value)) return 'года';
  if (value % 100 >= 11 && value % 100 <= 14) return 'лет';
  if (value % 10 === 1) return 'год';
  return value % 10 >= 2 && value % 10 <= 4 ? 'года' : 'лет';
};

let location = null;
let activeSearch;
let activeCalculation;
let map;
let mapTiles;
let marker;
let mapHasTiles = false;
let tileTimeout;

function setStatus(message) {
  const status = element('address-status');
  status.textContent = message;
  status.hidden = !message;
}

function setError(message = '') {
  const error = element('form-error');
  error.textContent = message;
  error.hidden = !message;
}

function setCalculating(busy) {
  calculate.disabled = busy;
  calculate.setAttribute('aria-busy', String(busy));
  calculate.firstChild.textContent = busy ? 'Рассчитываем… ' : 'Рассчитать ';
}

function resetResult() {
  activeCalculation?.abort();
  activeCalculation = undefined;
  setCalculating(false);
  results.hidden = true;
}

function resetSearch() {
  activeSearch?.abort();
  activeSearch = undefined;
  find.disabled = false;
  addressResults.hidden = true;
  addressResults.replaceChildren();
}

function updateStationSummary() {
  const count = element('panels').valueAsNumber;
  const summary = element('station-summary');
  summary.textContent = element('panels').checkValidity() && count > 0
    ? `${format(count)} шт. · ${format(count * PANEL.kilowatts, 1)} кВт`
    : 'Укажите число панелей';
}

function updateSatelliteLink(point) {
  const target = new URL('https://yandex.ru/maps/');
  target.search = new URLSearchParams({
    ll: `${point.lon},${point.lat}`,
    z: '16',
    l: 'sat',
    pt: `${point.lon},${point.lat},pm2gnm`
  });
  element('satellite-link').href = target;
}

function updateMarker(point) {
  if (!map) return;
  if (!marker) {
    marker = L.marker([point.lat, point.lon], {
      draggable: true,
      title: 'Выбранное местоположение'
    }).addTo(map);
    marker.on('dragend', () => {
      if (!mapHasTiles) {
        if (location) marker.setLatLng([location.lat, location.lon]);
        return;
      }
      const next = marker.getLatLng().wrap();
      choosePoint({ lat: next.lat, lon: next.lng, label: 'Точка на карте', kind: 'point' }, { center: false });
    });
  } else {
    marker.setLatLng([point.lat, point.lon]);
  }
}

function choosePoint(point, { center = true, syncAddress = false } = {}) {
  resetSearch();
  resetResult();
  setError();
  location = point;
  if (syncAddress) address.value = point.label;
  address.removeAttribute('aria-invalid');
  element('latitude').value = point.lat.toFixed(6);
  element('longitude').value = point.lon.toFixed(6);
  element('latitude').removeAttribute('aria-invalid');
  element('longitude').removeAttribute('aria-invalid');
  const detail = element('point-description');
  detail.hidden = false;
  detail.textContent = point.kind === 'point'
    ? `Выбрано ${format(point.lat, 4)}, ${format(point.lon, 4)}`
    : point.description;
  setStatus('');
  updateSatelliteLink(point);
  updateMarker(point);
  if (map && center) map.setView([point.lat, point.lon], point.kind === 'city' ? 11 : 16);
}

function mapUnavailable() {
  if (element('map-panel').hidden) return;
  mapHasTiles = false;
  const message = element('map-message');
  message.textContent = 'Карта недоступна. Можно выбрать город или указать координаты.';
  message.hidden = false;
  element('coordinate-details').open = true;
}

function createMap() {
  if (!window.L) {
    mapUnavailable();
    return;
  }
  const point = location ?? initialLocation;
  map = L.map('map', { scrollWheelZoom: false, worldCopyJump: true })
    .setView([point.lat, point.lon], point.kind === 'city' ? 11 : 16);
  map.attributionControl.setPrefix(false);
  mapTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  mapTiles.on('loading', () => {
    mapHasTiles = false;
    clearTimeout(tileTimeout);
    tileTimeout = setTimeout(mapUnavailable, 5000);
  });
  mapTiles.on('tileload', () => {
    clearTimeout(tileTimeout);
    mapHasTiles = true;
    element('map-message').hidden = true;
  });
  mapTiles.on('load', () => {
    if (!mapHasTiles) {
      clearTimeout(tileTimeout);
      mapUnavailable();
    }
  });
  mapTiles.addTo(map);
  if (location) updateMarker(location);
  map.on('click', event => {
    if (!mapHasTiles) return;
    const point = event.latlng.wrap();
    choosePoint({ lat: point.lat, lon: point.lng, label: 'Точка на карте', kind: 'point' }, { center: false });
  });
}

function openMap() {
  const show = element('map-panel').hidden;
  element('map-panel').hidden = false;
  element('map-toggle').setAttribute('aria-expanded', 'true');
  element('map-toggle').lastElementChild.textContent = '↑';
  if (!map) {
    createMap();
  } else if (show) {
    map.invalidateSize({ pan: false });
    if (!mapHasTiles && !mapTiles.isLoading()) mapUnavailable();
  }
}

element('map-toggle').addEventListener('click', () => {
  if (element('map-panel').hidden) {
    openMap();
  } else {
    element('map-panel').hidden = true;
    element('map-toggle').setAttribute('aria-expanded', 'false');
    element('map-toggle').lastElementChild.textContent = '↓';
  }
});

function parseDecimal(value) {
  const clean = value.trim().replace(/[\u00A0\u202F\s]+/g, '').replace(',', '.');
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean) ? Number(clean) : NaN;
}

function invalidField(field, message) {
  const details = field.closest('details');
  if (details) details.open = true;
  field.setAttribute('aria-invalid', 'true');
  field.focus();
  throw new Error(message);
}

function applyCoordinates() {
  const latitude = element('latitude');
  const longitude = element('longitude');
  const lat = parseDecimal(latitude.value);
  const lon = parseDecimal(longitude.value);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    return invalidField(latitude, 'Укажите широту от −90 до 90.');
  }
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
    return invalidField(longitude, 'Укажите долготу от −180 до 180.');
  }
  choosePoint({ lat, lon, label: 'Точка по координатам', kind: 'point' });
}

element('apply-point').addEventListener('click', () => {
  try {
    applyCoordinates();
  } catch (error) {
    setError(error.message);
  }
});

function showAddresses(points, calculateAfterSelection) {
  addressResults.replaceChildren();
  for (const point of points) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const description = document.createElement('small');
    description.textContent = point.description;
    button.type = 'button';
    button.append(point.label, description);
    button.addEventListener('click', () => {
      choosePoint(point, { syncAddress: true });
      if (point.kind === 'building') openMap();
      if (calculateAfterSelection) calculateResult();
      else calculate.focus({ preventScroll: true });
    });
    item.append(button);
    addressResults.append(item);
  }
  addressResults.hidden = false;
}

async function findAddress(calculateAfterSelection = false) {
  const query = address.value.trim();
  if (query.length < 3) {
    setError('Введите адрес или город, либо выберите точку на карте.');
    address.focus();
    return;
  }

  resetSearch();
  setError();
  const city = localCity(query);
  if (city) {
    choosePoint(city, { syncAddress: true });
    if (calculateAfterSelection) calculateResult();
    return;
  }

  const request = new AbortController();
  activeSearch = request;
  find.disabled = true;
  setStatus('Ищем адрес…');
  try {
    const points = await searchAddresses(query, request.signal);
    if (activeSearch !== request) return;
    if (points.length) {
      setStatus('Выберите объект из списка.');
      showAddresses(points, calculateAfterSelection);
    } else {
      setStatus('Адрес не найден. Уточните запрос, выберите город или укажите точку на карте.');
    }
  } catch {
    if (activeSearch === request) {
      setStatus('Поиск адресов недоступен. Введите название крупного города или укажите координаты.');
    }
  } finally {
    if (activeSearch === request) {
      activeSearch = undefined;
      find.disabled = false;
    }
  }
}

find.addEventListener('click', () => findAddress());
address.addEventListener('keydown', event => {
  if (event.key === 'Escape') resetSearch();
  if (event.key === 'Enter') {
    event.preventDefault();
    findAddress();
  }
});
address.addEventListener('input', () => {
  resetSearch();
  location = null;
  marker?.remove();
  marker = undefined;
  element('point-description').hidden = true;
  element('latitude').value = '';
  element('longitude').value = '';
  updateSatelliteLink(initialLocation);
  setStatus('');
});

function optionalAmount(id, min, max, message) {
  const field = element(id);
  if (field.value.trim() === '') return null;
  const value = parseDecimal(field.value);
  if (!Number.isFinite(value) || value < min || value > max) invalidField(field, message);
  return value;
}

function readInputs() {
  const panels = element('panels');
  const tilt = element('tilt');
  if (!panels.checkValidity() || !Number.isInteger(panels.valueAsNumber)) {
    invalidField(panels, 'Укажите целое число панелей от 1 до 10 000.');
  }
  if (!tilt.checkValidity() || !Number.isInteger(tilt.valueAsNumber)) {
    invalidField(tilt, 'Укажите наклон от 0 до 90 градусов.');
  }
  return {
    ...location,
    panels: panels.valueAsNumber,
    tilt: tilt.valueAsNumber,
    azimuth: Number(element('azimuth').value),
    bill: optionalAmount('bill', 0, 100_000_000, 'Укажите сумму счёта за месяц в рублях.'),
    tariff: optionalAmount('tariff', 0.01, 1000, 'Укажите тариф от 0,01 до 1 000 ₽ за кВт·ч.'),
    cost: optionalAmount('cost', 1, 1_000_000_000, 'Укажите стоимость станции в рублях или оставьте поле пустым.')
  };
}

function drawChart(monthly) {
  const chart = element('chart');
  const selection = element('chart-value');
  const high = Math.max(...monthly, 1);
  chart.replaceChildren();
  selection.textContent = 'кВт·ч';
  monthly.forEach((energy, index) => {
    const button = document.createElement('button');
    const plot = document.createElement('span');
    const bar = document.createElement('span');
    const label = document.createElement('span');
    const tooltip = `${MONTHS[index]} · ${format(energy)} кВт·ч`;
    button.type = 'button';
    button.title = tooltip;
    button.setAttribute('aria-label', tooltip);
    button.setAttribute('aria-pressed', 'false');
    plot.className = 'plot-area';
    bar.className = 'plot-bar';
    bar.style.height = `${Math.max(energy > 0 ? 1.5 : 0, energy / high * 100)}%`;
    label.textContent = MONTHS[index];
    plot.append(bar);
    button.append(plot, label);
    button.addEventListener('click', () => {
      for (const item of chart.children) item.setAttribute('aria-pressed', String(item === button));
      selection.textContent = tooltip;
    });
    chart.append(button);
  });
}

function renderResult(climate, inputs, demo) {
  const data = calculateSolar(climate.irradiation, inputs);
  element('result-location').textContent = `${inputs.label} · ${format(inputs.panels)} шт. · ${format(data.power, 1)} кВт${demo ? ' · пример' : ''}`;
  element('generation').textContent = `≈ ${format(data.annual)} кВт·ч`;
  element('saving-metric').hidden = data.saving === null;
  element('saving').textContent = data.saving === null ? '' : `≈ ${format(data.saving)} ₽`;
  element('payback-metric').hidden = data.payback === null;
  const roundedPayback = data.payback === null ? 0 : Math.round(data.payback * 10) / 10;
  element('payback').textContent = data.payback === null ? ''
    : roundedPayback === 0 ? 'Менее 0,1 года' : `≈ ${format(roundedPayback, 1)} ${pluralYears(roundedPayback)}`;
  const economicHint = element('economic-hint');
  economicHint.hidden = data.saving !== null;
  economicHint.textContent = 'Добавьте счёт за свет и тариф, чтобы увидеть экономию в рублях.';
  element('result-note').textContent = `Источник · ${climate.source}. Оценка по солнечным данным местности. Тень от зданий и деревьев требует проверки на месте.`;
  const direction = element('azimuth').selectedOptions[0].textContent.toLocaleLowerCase('ru-RU');
  element('result-method').textContent = [
    `Один модуль Delta PV TOP даёт 500 Вт номинальной мощности. Площадь модулей ${format(data.panelArea, 1)} м² без креплений и проходов.`,
    `В расчёте наклон ${inputs.tilt}°, направление — ${direction}, потери системы ${format(SYSTEM_LOSS * 100)}%.`,
    data.saving === null ? '' : `Модель предполагает, что объект использует ${format(SELF_USE * 100)}% выработки, в пределах среднего потребления по счёту за месяц. Оценка собственного потребления ${format(data.used)} кВт·ч в год. Доходы от продажи в сеть исключены из расчёта.`,
    data.payback === null ? '' : 'Простая окупаемость равна цене с монтажом, делённой на годовую экономию. Тариф принят постоянным.'
  ].filter(Boolean).join(' ');
  drawChart(data.monthly);
  results.hidden = false;
  element('results-title').focus({ preventScroll: true });
  results.scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', block: 'start' });
}

async function calculateResult(demo = false) {
  let inputs;
  try {
    inputs = readInputs();
  } catch (error) {
    setError(error.message);
    return;
  }

  activeCalculation?.abort();
  const request = new AbortController();
  activeCalculation = request;
  setError();
  setCalculating(true);
  try {
    const climate = await loadClimate(inputs, request.signal);
    if (activeCalculation === request) renderResult(climate, inputs, demo);
  } catch {
    if (activeCalculation === request) {
      setError('Для этой точки не удалось получить данные NASA POWER. Попробуйте позже или запустите пример для Ростова.');
    }
  } finally {
    if (activeCalculation === request) {
      activeCalculation = undefined;
      setCalculating(false);
    }
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (activeCalculation) return;
  if (location) {
    calculateResult();
  } else if (element('latitude').value.trim() || element('longitude').value.trim()) {
    try {
      applyCoordinates();
      calculateResult();
    } catch (error) {
      setError(error.message);
    }
  } else if (address.value.trim()) {
    findAddress(true);
  } else {
    setError('Укажите адрес, город или точку на карте.');
    address.focus();
  }
});

form.addEventListener('input', event => {
  event.target.removeAttribute('aria-invalid');
  setError();
  resetResult();
  if (event.target.id === 'panels') updateStationSummary();
  if (event.target.id === 'latitude' || event.target.id === 'longitude') {
    location = null;
    element('point-description').hidden = true;
    setStatus('');
  }
});

element('demo').addEventListener('click', () => {
  form.reset();
  choosePoint(initialLocation, { syncAddress: true });
  element('bill').value = '5 000';
  element('tariff').value = '6,00';
  for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
  updateStationSummary();
  calculateResult(true);
});

element('edit').addEventListener('click', () => {
  address.focus({ preventScroll: true });
  form.scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', block: 'start' });
});
updateStationSummary();
