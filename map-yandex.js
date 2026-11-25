// Map view on the Yandex Maps JavaScript API 2.1, satellite imagery with labels.
const API = 'https://api-maps.yandex.ru/2.1/';
const pair = point => [point.lat, point.lng];
const point = coords => ({ lat: coords[0], lng: coords[1] });

function loadScript(src, timeout) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => reject(new Error('Yandex Maps: timeout')), timeout);
    script.src = src;
    script.async = true;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Yandex Maps: script failed')); };
    document.head.append(script);
  });
}

const LINE = {
  lineA: { strokeColor: '#ff8a3d', strokeWidth: 4 },
  lineB: { strokeColor: '#ffd166', strokeWidth: 4 },
  preview: { strokeColor: '#ffffff', strokeWidth: 2, strokeStyle: 'dash' }
};
const AREA = {
  roof: { strokeColor: '#ffb27a', strokeWidth: 2, strokeStyle: 'dash', fillColor: '#d9621a', fillOpacity: 0.12 },
  used: { strokeColor: '#a9bde0', strokeWidth: 1, fillColor: '#1b2a4a', fillOpacity: 0.92 },
  spare: { strokeColor: '#ffffff', strokeWidth: 1, strokeOpacity: 0.7, strokeStyle: 'dash', fillColor: '#1b2a4a', fillOpacity: 0.12 }
};
const PASS = { interactivityModel: 'default#transparent' };

export async function createYandexView(container, { center, zoom }, key) {
  const params = new URLSearchParams({ lang: 'ru_RU' });
  if (key) params.set('apikey', key);
  await loadScript(`${API}?${params}`, 10000);
  await new Promise((resolve, reject) => window.ymaps.ready(resolve, reject));
  const { ymaps } = window;

  const map = new ymaps.Map(container, {
    center: pair(center), zoom, type: 'yandex#hybrid', controls: ['zoomControl']
  }, { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true });
  map.controls.add(new ymaps.control.TypeSelector({
    mapTypes: ['yandex#hybrid', 'yandex#satellite', 'yandex#map'],
    options: { panoramasItemMode: 'off', float: 'right' }
  }));
  map.behaviors.disable(['dblClickZoom', 'scrollZoom']);
  map.events.add('click', () => map.behaviors.enable('scrollZoom'));
  map.events.add('mouseleave', () => map.behaviors.disable('scrollZoom'));

  const shapes = new ymaps.GeoObjectCollection();
  const panelLayer = new ymaps.GeoObjectCollection();
  map.geoObjects.add(panelLayer);
  map.geoObjects.add(shapes);

  const Label = ymaps.templateLayoutFactory.createClass('<div class="edge-label"><span>{{ properties.text }}</span></div>');
  const Corner = ymaps.templateLayoutFactory.createClass('<div class="corner-wrap ymap"><div class="corner"></div></div>');
  let markers = [];
  let dragging = -1;
  let previewLine = null;
  let hereMark = null;

  return {
    provider: 'yandex',
    onClick: callback => map.events.add('click', event => callback(point(event.get('coords')))),
    onMove: callback => map.events.add('mousemove', event => callback(point(event.get('coords')))),
    onZoom: callback => map.events.add('boundschange', event => {
      if (event.get('newZoom') !== event.get('oldZoom')) callback();
    }),
    getZoom: () => map.getZoom(),
    getCenter: () => point(map.getCenter()),
    setView: (target, level) => map.setCenter(pair(target), level, { checkZoomRange: true }),
    fitPoints: points => map.setBounds(ymaps.util.bounds.fromPoints(points.map(pair)), { checkZoomRange: true, zoomMargin: 40 }),

    draw({ polygons = [], lines = [], labels = [] }) {
      shapes.removeAll();
      for (const shape of polygons) shapes.add(new ymaps.Polygon([shape.points.map(pair)], {}, { ...AREA[shape.kind], ...PASS }));
      for (const line of lines) shapes.add(new ymaps.Polyline(line.points.map(pair), {}, { ...LINE[line.kind], ...PASS }));
      for (const label of labels) {
        shapes.add(new ymaps.Placemark(pair(label.point), { text: label.text }, { iconLayout: Label, ...PASS, zIndex: 700 }));
      }
    },

    preview(points) {
      if (!points) {
        if (previewLine) map.geoObjects.remove(previewLine);
        previewLine = null;
      } else if (previewLine) {
        previewLine.geometry.setCoordinates(points.map(pair));
      } else {
        previewLine = new ymaps.Polyline(points.map(pair), {}, { ...LINE.preview, ...PASS });
        map.geoObjects.add(previewLine);
      }
    },

    handles(points, { drag, dragEnd }) {
      while (markers.length > points.length) map.geoObjects.remove(markers.pop());
      points.forEach((position, index) => {
        if (!markers[index]) {
          const marker = new ymaps.Placemark(pair(position), {}, {
            draggable: true, iconLayout: Corner, zIndex: 800, zIndexDrag: 800,
            iconShape: { type: 'Circle', coordinates: [0, 0], radius: 22 }
          });
          marker.events.add('dragstart', () => { dragging = index; });
          marker.events.add('drag', () => drag(index, point(marker.geometry.getCoordinates())));
          marker.events.add('dragend', () => { dragging = -1; dragEnd(index); });
          map.geoObjects.add(marker);
          markers[index] = marker;
        } else if (dragging !== index) {
          markers[index].geometry.setCoordinates(pair(position));
        }
      });
    },

    panels(used, spare) {
      panelLayer.removeAll();
      if (spare.length) panelLayer.add(new ymaps.Polygon(spare.map(panel => panel.map(pair)), {}, { ...AREA.spare, ...PASS }));
      if (used.length) panelLayer.add(new ymaps.Polygon(used.map(panel => panel.map(pair)), {}, { ...AREA.used, ...PASS }));
    },

    here(target) {
      if (hereMark) map.geoObjects.remove(hereMark);
      hereMark = new ymaps.Placemark(pair(target), {}, { preset: 'islands#geolocationIcon', ...PASS });
      map.geoObjects.add(hereMark);
    }
  };
}
