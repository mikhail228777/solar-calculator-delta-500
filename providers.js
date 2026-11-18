const API_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SOLAR_PARAMETER = 'ALLSKY_SFC_SW_DWN';
const PHOTON = 'https://photon.komoot.io/api/';
const NASA = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
const ARCHIVE = './data/nasa-power-climatology.json';
let archiveRequest;
const climateCache = new Map();
const addressCache = new Map();

const CITIES = [
  ['Ростов-на-Дону', 47.2357, 39.7015],
  ['Москва', 55.7558, 37.6176],
  ['Санкт-Петербург', 59.9386, 30.3141],
  ['Краснодар', 45.0355, 38.9753],
  ['Екатеринбург', 56.8389, 60.6057],
  ['Казань', 55.7963, 49.1088],
  ['Новосибирск', 55.0084, 82.9357],
  ['Владивосток', 43.1155, 131.8855],
  ['Астрахань', 46.3497, 48.0408],
  ['Калининград', 54.7104, 20.4522],
  ['Самара', 53.1959, 50.1002],
  ['Нижний Новгород', 56.3287, 44.0020],
  ['Воронеж', 51.6608, 39.2003],
  ['Волгоград', 48.7080, 44.5133],
  ['Красноярск', 56.0106, 92.8526],
  ['Иркутск', 52.2864, 104.2807],
  ['Уфа', 54.7351, 55.9587],
  ['Хабаровск', 48.4802, 135.0719]
];

function normalizeCity(value) {
  return value.toLocaleLowerCase('ru-RU').trim().replace(/^г(?:ород)?[.\s]+/, '')
    .replace(/[,\s]+россия$/, '').replace(/[-–—\s]+/g, ' ').trim().replace(/ё/g, 'е');
}

export function localCity(query) {
  const normalized = normalizeCity(query);
  const city = CITIES.find(([name]) => normalizeCity(name) === normalized);
  return city ? { label: city[0], lat: city[1], lon: city[2], kind: 'city', description: 'Центр города' } : null;
}

function validIrradiation(values) {
  return Array.isArray(values) && values.length === 12
    && values.every(value => Number.isFinite(value) && value >= 0 && value <= 15);
}

function coordinatePair(lat, lon) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

async function jsonFrom(url, signal) {
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function archive() {
  if (!archiveRequest) {
    archiveRequest = jsonFrom(ARCHIVE).catch(error => {
      archiveRequest = undefined;
      throw error;
    });
  }
  return archiveRequest;
}

export async function loadClimate(point, signal) {
  const lat = Math.floor(Math.min(89.999999, point.lat)) + 0.5;
  const lon = Math.floor(point.lon === 180 ? -180 : point.lon) + 0.5;
  const key = `${lat},${lon}`;
  let data;
  try {
    data = await archive();
  } catch {
    // Routes outside the bundled data use the same published source.
  }
  signal?.throwIfAborted();

  const stored = data?.cells?.[key];
  if (data?.parameter === SOLAR_PARAMETER && data.units === 'kWh/m²/day' && validIrradiation(stored)) {
    return { irradiation: stored, source: 'NASA POWER · архив' };
  }
  if (climateCache.has(key)) return climateCache.get(key);

  const url = new URL(NASA);
  url.search = new URLSearchParams({
    parameters: SOLAR_PARAMETER,
    community: 'RE',
    latitude: String(lat),
    longitude: String(lon),
    format: 'JSON'
  });
  const weather = await jsonFrom(url, signal);
  const parameter = weather?.properties?.parameter?.[SOLAR_PARAMETER];
  const values = API_MONTHS.map(month => parameter?.[month]);
  const units = weather?.parameters?.[SOLAR_PARAMETER]?.units?.toLowerCase()
    .replace(/[\s^-]/g, '').replace('²', '2').replace('kwhr', 'kwh');
  if ((units && units !== 'kwh/m2/day') || !validIrradiation(values)) {
    throw new Error('NASA POWER: неполные данные или неожиданные единицы измерения');
  }

  const climate = { irradiation: values, source: 'NASA POWER · API' };
  climateCache.set(key, climate);
  return climate;
}

function photonPoint(feature) {
  const [lon, lat] = feature?.geometry?.coordinates ?? [];
  const info = feature?.properties;
  if (!info || !coordinatePair(lat, lon) || info.countrycode?.toUpperCase() !== 'RU') return null;

  const house = [info.street ?? info.name, info.housenumber].filter(Boolean).join(', ');
  const parts = info.housenumber ? [house, info.city, info.state] : [info.name, info.city, info.state];
  const label = [...new Set(parts.filter(part => typeof part === 'string' && part.trim()))].join(', ');
  if (!label) return null;

  const description = info.housenumber ? 'Дом'
    : info.type === 'street' ? 'Улица'
      : 'Населённый пункт или район';
  return { label, lat, lon, kind: info.housenumber ? 'building' : 'area', description };
}

export async function searchAddresses(query, signal) {
  const key = query.toLocaleLowerCase('ru-RU');
  if (addressCache.has(key)) return addressCache.get(key);

  const url = new URL(PHOTON);
  url.search = new URLSearchParams({ q: query, lang: 'ru', limit: '5', countrycode: 'RU' });
  const data = await jsonFrom(url, signal);
  if (!Array.isArray(data?.features)) throw new Error('Photon: неожиданный ответ');

  const points = data.features.map(photonPoint).filter(Boolean);
  if (addressCache.size >= 30) addressCache.delete(addressCache.keys().next().value);
  addressCache.set(key, points);
  return points;
}
