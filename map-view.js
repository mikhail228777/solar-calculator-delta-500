import { YANDEX_MAPS_KEY } from './config.js';

// Yandex imagery is the freshest for Russian cities; Esri (spring 2025 for Rostov) is the alternative
// a visitor can switch to, and the fallback when Yandex does not load.
export async function createMapView(container, options, preferred = 'yandex') {
  if (preferred === 'esri') {
    const { createLeafletView } = await import('./map-leaflet.js?v=2');
    return createLeafletView(container, options);
  }
  try {
    const { createYandexView } = await import('./map-yandex.js?v=2');
    return await createYandexView(container, options, YANDEX_MAPS_KEY);
  } catch (error) {
    console.warn('Яндекс Карты недоступны, показываем снимки Esri.', error);
    container.replaceChildren();
    const { createLeafletView } = await import('./map-leaflet.js?v=2');
    return createLeafletView(container, options);
  }
}
