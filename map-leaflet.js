// Fallback map view on Leaflet with Esri World Imagery, used when Yandex Maps does not load.
const STYLE = {
  roof: { color: '#ffb27a', weight: 2, dashArray: '6 5', fillColor: '#d9621a', fillOpacity: 0.12 },
  lineA: { color: '#ff8a3d', weight: 4 },
  lineB: { color: '#ffd166', weight: 4 },
  preview: { color: '#ffffff', weight: 2, dashArray: '4 6' },
  used: { color: '#a9bde0', weight: 0.7, fillColor: '#1b2a4a', fillOpacity: 0.92 },
  spare: { color: '#ffffff', weight: 1, opacity: 0.6, dashArray: '3 3', fillColor: '#1b2a4a', fillOpacity: 0.12 }
};
const point = latlng => ({ lat: latlng.lat, lng: latlng.lng });

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './leaflet.css';
  document.head.append(css);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './leaflet.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.append(script);
  });
}

export async function createLeafletView(container, { center, zoom }) {
  await loadLeaflet();
  const { L } = window;
  const map = L.map(container, {
    center: [center.lat, center.lng], zoom, maxZoom: 21, doubleClickZoom: false, scrollWheelZoom: false, worldCopyJump: true
  });
  map.attributionControl.setPrefix(false);
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19, maxZoom: 21, attribution: 'Снимки © Esri, Maxar, Earthstar Geographics'
  });
  const places = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19, maxZoom: 21, zIndex: 2
  });
  const scheme = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19, maxZoom: 21, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  const satellite = L.layerGroup([imagery, places]).addTo(map);
  L.control.layers({ 'Спутник': satellite, 'Схема': scheme }, null, { position: 'topright' }).addTo(map);
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());

  const shapes = L.layerGroup().addTo(map);
  const panelLayer = L.layerGroup().addTo(map);
  const renderer = L.canvas({ padding: 0.4 });
  const cornerIcon = L.divIcon({ className: 'corner-wrap', html: '<div class="corner"></div>', iconSize: [44, 44], iconAnchor: [22, 22] });
  const hereIcon = L.divIcon({ className: '', html: '<div class="here"></div>', iconSize: [0, 0] });
  const labelIcon = text => L.divIcon({ className: 'edge-label', html: `<span>${text}</span>`, iconSize: [0, 0] });
  let markers = [];
  let dragging = -1;
  let previewLine = null;
  let hereMark = null;

  return {
    provider: 'esri',
    onClick: callback => map.on('click', event => callback(point(event.latlng))),
    onMove: callback => map.on('mousemove', event => callback(point(event.latlng))),
    onZoom: callback => map.on('zoomend', callback),
    getZoom: () => map.getZoom(),
    getCenter: () => point(map.getCenter()),
    setView: (target, level) => map.setView([target.lat, target.lng], level),
    fitPoints: points => map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 20 }),

    draw({ polygons = [], lines = [], labels = [] }) {
      shapes.clearLayers();
      for (const shape of polygons) L.polygon(shape.points, { ...STYLE[shape.kind], interactive: false }).addTo(shapes);
      for (const line of lines) L.polyline(line.points, { ...STYLE[line.kind], interactive: false }).addTo(shapes);
      for (const label of labels) L.marker(label.point, { icon: labelIcon(label.text), interactive: false, keyboard: false }).addTo(shapes);
    },

    preview(points) {
      if (!points) {
        if (previewLine) map.removeLayer(previewLine);
        previewLine = null;
      } else if (previewLine) {
        previewLine.setLatLngs(points);
      } else {
        previewLine = L.polyline(points, { ...STYLE.preview, interactive: false }).addTo(map);
      }
    },

    handles(points, { drag, dragEnd }) {
      while (markers.length > points.length) map.removeLayer(markers.pop());
      points.forEach((position, index) => {
        if (!markers[index]) {
          const marker = L.marker(position, { draggable: true, icon: cornerIcon, keyboard: false, autoPan: true, zIndexOffset: 1000 });
          marker.on('dragstart', () => { dragging = index; });
          marker.on('drag', () => drag(index, point(marker.getLatLng())));
          marker.on('dragend', () => { dragging = -1; dragEnd(index); });
          markers[index] = marker.addTo(map);
        } else if (dragging !== index) {
          markers[index].setLatLng(position);
        }
      });
    },

    panels(used, spare) {
      panelLayer.clearLayers();
      for (const panel of spare) L.polygon(panel, { ...STYLE.spare, renderer, interactive: false }).addTo(panelLayer);
      for (const panel of used) L.polygon(panel, { ...STYLE.used, renderer, interactive: false }).addTo(panelLayer);
    },

    here(target) {
      if (hereMark) map.removeLayer(hereMark);
      hereMark = L.marker(target, { icon: hereIcon, interactive: false, keyboard: false }).addTo(map);
    }
  };
}
