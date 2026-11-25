import { YANDEX_MAPS_KEY } from './config.js';

// Yandex imagery is the freshest for Russian cities; Esri stays as a fallback.
export async function createMapView(container, options) {
  try {
    const { createYandexView } = await import('./map-yandex.js?v=1');
    return await createYandexView(container, options, YANDEX_MAPS_KEY);
  } catch (error) {
    console.warn('Яндекс Карты недоступны, показываем снимки Esri.', error);
    container.replaceChildren();
    const { createLeafletView } = await import('./map-leaflet.js?v=1');
    return createLeafletView(container, options);
  }
}
