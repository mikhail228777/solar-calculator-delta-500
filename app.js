import { mountCalculator } from './calculator-template.js';
import { calculateBackup, calculateSolar, BACKUP_EFFICIENCY, MONTHS, PANEL, SYSTEM_LOSS } from './solar.js?v=2';
import { loadClimate, localCity, searchAddresses } from './providers.js';

const element = id => document.getElementById(id);
const industry = document.body.dataset.mode === 'industry';
mountCalculator(element('workspace'), industry);

const form = element('calculator');
const address = element('address');
const find = element('find');
const calculate = element('calculate');
const addressResults = element('address-results');
const results = element('results');
const initialLocation = localCity('Ростов-на-Дону');
const defaultPanelCount = industry ? null : 10;
const backupMonth = element('backup-month');
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
let dayEstimate;

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

function stationSize() {
  const roofField = element('roof-area');
  const panelsField = element('panels');
  const area = roofField.value.trim() ? parseDecimal(roofField.value) : null;
  if (area !== null && (!Number.isFinite(area) || area <= 0)) {
    return { field: roofField, error: 'Укажите свободную площадь больше нуля.' };
  }

  const capacity = area === null ? null : Math.floor(area / PANEL.squareMeters + 1e-10);
  if (capacity === 0) {
    return { field: roofField, error: `Для одной панели нужно примерно ${format(PANEL.squareMeters, 3)} м² свободного ската.` };
  }

  const automatic = panelsField.value === '' && !panelsField.validity.badInput;
  const count = automatic ? capacity ?? defaultPanelCount : panelsField.valueAsNumber;
  if (count === null) {
    return { field: roofField, error: 'Укажите свободную площадь крыши или количество панелей в параметрах.' };
  }
  if (!panelsField.validity.valid || !Number.isSafeInteger(count)) {
    return { capacity, field: panelsField, error: 'Укажите целое число панелей от 1.' };
  }
  if (capacity !== null && count > capacity) {
    return { capacity, field: panelsField, error: `Для этой площади укажите не больше ${format(capacity)} панелей.` };
  }
  return { area, capacity, count, fromRoof: automatic && capacity !== null };
}

function updateStationSummary() {
  const size = stationSize();
  const summary = element('station-summary');
  summary.hidden = size.fromRoof === true;
  summary.textContent = size.error
    ? ''
    : `${format(size.count)} шт. · ${format(size.count * PANEL.kilowatts, 1)} кВт`;
  element('panels').placeholder = size.capacity ?? defaultPanelCount ?? '';

  const hint = element('roof-capacity');
  const estimate = size.field?.id === 'roof-area' && element('roof-area').value.trim() ? size.error
    : size.capacity ? `По площади до ${format(size.capacity)} шт. · ${format(size.capacity * PANEL.kilowatts, 1)} кВт` : '';
  hint.textContent = estimate;
  hint.hidden = !estimate;
}

function readInputs() {
  const size = stationSize();
  if (size.error) invalidField(size.field, size.error);
  const tilt = element('tilt');
  if (!tilt.checkValidity() || !Number.isInteger(tilt.valueAsNumber)) {
    invalidField(tilt, 'Укажите наклон от 0 до 90 градусов.');
  }
  const inputs = {
    ...location,
    panels: size.count,
    roofArea: size.area,
    roofCapacity: size.capacity,
    fromRoof: size.fromRoof,
    tilt: tilt.valueAsNumber,
    azimuth: Number(element('azimuth').value),
    direction: element('azimuth').selectedOptions[0].textContent.toLocaleLowerCase('ru-RU'),
    tariff: optionalAmount('tariff', 0.01, 1000, 'Укажите тариф от 0,01 до 1 000 ₽ за кВт·ч.'),
    cost: optionalAmount('cost', 1, Number.MAX_SAFE_INTEGER, 'Укажите стоимость станции в рублях или оставьте поле пустым.')
  };
  if (industry) {
    const share = optionalAmount('self-use', 0, 100, 'Укажите долю выработки на объекте от 0 до 100%.');
    return {
      ...inputs,
      consumption: optionalAmount('consumption', 0, Number.MAX_SAFE_INTEGER, 'Укажите неотрицательное потребление в кВт·ч за месяц.'),
      selfUse: share === null ? null : share / 100,
      maintenance: optionalAmount('maintenance', 0, Number.MAX_SAFE_INTEGER, 'Укажите неотрицательные расходы на обслуживание за год.') ?? 0
    };
  }

  const bill = optionalAmount('bill', 0, Number.MAX_SAFE_INTEGER, 'Укажите неотрицательные расходы на электроэнергию за месяц.');
  const watts = optionalAmount('backup-load', 1, Number.MAX_SAFE_INTEGER, 'Укажите среднюю мощность приборов в ваттах, от 1 Вт.');
  return {
    ...inputs,
    bill,
    battery: optionalAmount('battery', 0, Number.MAX_SAFE_INTEGER, 'Укажите полезную ёмкость батареи в кВт·ч. Если батареи нет, введите 0.'),
    load: watts === null ? null : watts / 1000,
    charge: optionalAmount('charge', 0, 100, 'Укажите заряд от 0 до 100%.') ?? 100,
    inverter: optionalAmount('inverter', 0.001, Number.MAX_SAFE_INTEGER, 'Укажите положительную мощность резервного выхода в кВт.')
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

function formatDuration(hours) {
  const minutes = Math.round(hours * 60);
  if (minutes === 0) return hours === 0 ? '0 ч' : 'Менее минуты';

  const wholeHours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const parts = [];
  if (wholeHours) parts.push(`${format(wholeHours)} ч`);
  if (remainingMinutes) parts.push(`${remainingMinutes} мин`);
  return `≈ ${parts.join(' ')}`;
}

function updateDailyEstimate() {
  const { daily, load } = dayEstimate;
  element('solar-daily-energy').textContent = `≈ ${format(daily[Number(backupMonth.value)], 1)} кВт·ч`;
  element('daily-load-metric').hidden = load === null;
  element('daily-load').textContent = load === null ? '' : `${format(load * 24, 1)} кВт·ч`;
}

function renderBackup(data, inputs) {
  const backup = calculateBackup(inputs);
  element('backup-metric').hidden = backup === null;
  const note = element('backup-note');
  if (backup === null) {
    note.textContent = 'Для оценки резерва укажите полезную ёмкость аккумулятора и среднюю мощность нужных приборов.';
  } else if (backup.hours === null) {
    element('backup-time').textContent = 'Выше лимита';
    note.textContent = 'Средняя нагрузка выше мощности резервного выхода. Уменьшите нагрузку или проверьте параметры инвертора.';
  } else {
    element('backup-time').textContent = formatDuration(backup.hours);
    note.textContent = `Нагрузка ${format(inputs.load * 1000, 1)} Вт, заряд ${format(inputs.charge, 1)}%. Доступно приборам около ${format(backup.energy, 2)} кВт·ч при КПД ${format(BACKUP_EFFICIENCY * 100)}%. Для работы при отключении проверьте резервный выход инвертора и пусковую мощность приборов.`;
  }
  note.hidden = false;

  dayEstimate = { daily: data.daily, load: inputs.load };
  updateDailyEstimate();
}

function renderEconomics(data, inputs) {
  element('saving-metric').hidden = data.saving === null;
  element('saving').textContent = data.saving === null ? '' : `≈ ${format(data.saving)} ₽`;
  element('payback-metric').hidden = data.payback === null;
  const roundedPayback = data.payback === null ? 0 : Math.round(data.payback * 10) / 10;
  element('payback').textContent = data.payback === null ? ''
    : roundedPayback === 0 ? 'Менее 0,1 года' : `≈ ${format(roundedPayback, 1)} ${pluralYears(roundedPayback)}`;

  let hint = '';
  if (data.saving === null) {
    if (industry) hint = 'Для расчёта экономии укажите потребление, тариф и долю выработки для своих нужд.';
    else if (inputs.bill !== null || inputs.tariff !== null || inputs.cost !== null) {
      hint = 'Добавьте расходы за месяц и тариф, чтобы увидеть экономию в рублях.';
    }
  } else if (data.saving <= 0) {
    hint = 'Экономия после расходов равна нулю или отрицательна. При этих вводных срок окупаемости определить нельзя.';
  } else if (inputs.cost === null) {
    hint = 'Добавьте стоимость станции с монтажом, чтобы оценить срок окупаемости.';
  }
  element('economic-hint').textContent = hint;
  element('economic-hint').hidden = !hint;
}

function renderResult(climate, inputs, demo) {
  const data = calculateSolar(climate.irradiation, inputs);
  const count = `${inputs.fromRoof ? 'до ' : ''}${format(inputs.panels)} шт.`;
  const roof = inputs.roofArea === null ? '' : ` · свободная площадь ${format(inputs.roofArea, 2)} м²`;
  element('result-location').textContent = `${inputs.label}${roof} · ${count} · ${format(data.power, 1)} кВт${demo ? ' · пример с условными вводными' : ''}`;
  element('generation').textContent = `≈ ${format(data.annual)} кВт·ч`;
  if (!industry) renderBackup(data, inputs);
  renderEconomics(data, inputs);

  const roofNote = inputs.roofArea === null ? '' : ' Раскладку уточняют по форме и размерам ската.';
  element('result-note').textContent = `Источник · ${climate.source}. Тень от зданий и деревьев требует проверки на месте.${roofNote}`;
  element('result-method').textContent = [
    `Один модуль Delta PV TOP даёт 500 Вт номинальной мощности. Площадь модулей ${format(data.panelArea, 1)} м² без креплений и проходов.`,
    inputs.roofArea === null ? '' : `Площадь одного модуля ${format(PANEL.squareMeters, 3)} м². В свободной зоне ${format(inputs.roofArea, 2)} м² по площади помещается до ${format(inputs.roofCapacity)} шт.`,
    `В расчёте наклон ${inputs.tilt}°, направление — ${inputs.direction}, потери системы ${format(SYSTEM_LOSS * 100)}%.`,
    data.saving === null ? '' : `В расчёте ${format(inputs.selfUse * 100, 1)}% выработки идёт на свои нужды в пределах среднего потребления за месяц. Это около ${format(data.used)} кВт·ч в год. Экономия на счёте около ${format(data.grossSaving)} ₽ в год.`,
    !industry || data.saving === null ? '' : `Из экономии вычтены расходы на обслуживание ${format(inputs.maintenance)} ₽ в год.`,
    data.payback === null ? '' : 'Простая окупаемость равна цене с монтажом, делённой на годовую экономию после расходов. Тариф принят постоянным.'
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
  if (event.target.id === 'panels' || event.target.id === 'roof-area') updateStationSummary();
  if (event.target.id === 'latitude' || event.target.id === 'longitude') {
    location = null;
    element('point-description').hidden = true;
    setStatus('');
  }
});

element('demo').addEventListener('click', () => {
  form.reset();
  choosePoint(initialLocation, { syncAddress: true });
  const values = industry
    ? { 'roof-area': '1 800', tilt: '15', consumption: '90 000', tariff: '9,50', 'self-use': '85', cost: '18 000 000', maintenance: '250 000' }
    : { 'roof-area': '30', battery: '10', 'backup-load': '500', inverter: '3', bill: '5 000', tariff: '6,00', cost: '450 000' };
  for (const [id, value] of Object.entries(values)) element(id).value = value;
  for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
  updateStationSummary();
  calculateResult(true);
});

element('edit').addEventListener('click', () => {
  address.focus({ preventScroll: true });
  form.scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', block: 'start' });
});
if (backupMonth) {
  backupMonth.value = String(new Date().getMonth());
  backupMonth.addEventListener('change', updateDailyEstimate);
}
updateStationSummary();
