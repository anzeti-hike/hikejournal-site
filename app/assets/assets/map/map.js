/*
 * HikeJournal map page. Runs inside an iframe (Flutter web) or a WebView (Flutter Android).
 *
 * Flutter → map:  window.hj.cmd({cmd: ...})            (Android: runJavaScript; web: postMessage {hjToMap: ...})
 * map → Flutter:  HJFlutter.postMessage(json)           (Android JavaScriptChannel) or parent.postMessage({hjFromMap: ...})
 *
 * 2D world map; above zoom 9 the map tilts into 3D terrain (Mapterhorn, LiDAR 0.5 m for Slovenia).
 */
(function () {
  'use strict';
  var ACCENT = '#22c55e';
  var WORLD = { center: [14.5, 38], zoom: innerWidth < 700 ? 0.6 : 1.6, pitch: 0, bearing: 0 };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dur = function (ms) { return reduce ? 0 : ms; };

  function send(msg) {
    try {
      if (window.HJFlutter && window.HJFlutter.postMessage) window.HJFlutter.postMessage(JSON.stringify(msg));
      else if (window.parent && window.parent !== window) window.parent.postMessage({ hjFromMap: msg }, '*');
    } catch (e) { /* ignore */ }
  }
  function showError(text) { var el = document.getElementById('err'); el.textContent = text; el.style.display = 'block'; }

  if (!window.maplibregl) { showError('Zemljevida ni bilo mogoče naložiti.'); return; }

  var settings = { satSource: 'esri', maptilerKey: '', exaggeration: 1.2, satellite: true, auto3d: true, peakLabels: true, dark: false };
  var padding = { top: 24, right: 24, bottom: 24, left: 24 };
  var hikes = [], selected = null, media = [];
  var terrainOn = false, flying = false, ready = false, queue = [];
  var peakMarkers = [], mediaMarkers = [];

  // Satellite imagery. Esri World Imagery is used without a key (personal, non-commercial use, with attribution);
  // MapTiler needs a key and falls back to Esri without one; Sentinel-2 cloudless is 10 m open data.
  function satSource(s) {
    var src = s.satSource === 'maptiler' && !s.maptilerKey ? 'esri' : s.satSource;
    if (src === 'maptiler') return {
      type: 'raster', tileSize: 512, maxzoom: 20,
      tiles: ['https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=' + encodeURIComponent(s.maptilerKey)],
      attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>'
    };
    if (src === 'sentinel') return {
      type: 'raster', tileSize: 256, maxzoom: 15,
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
      attribution: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless – s2maps.eu by EOX</a>'
    };
    // z18 is real imagery in the Alps (~0.4 m/px); z19 is mostly upsampled, so MapLibre overzooms z18 instead
    return {
      type: 'raster', tileSize: 256, maxzoom: 18,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Posnetki © <a href="https://www.esri.com/" target="_blank">Esri</a>, Maxar, Earthstar Geographics in skupnost GIS uporabnikov'
    };
  }
  function satKey(s) { return (s.satSource === 'maptiler' && s.maptilerKey ? 'maptiler:' + s.maptilerKey : (s.satSource === 'sentinel' ? 'sentinel' : 'esri')); }
  var dem = { type: 'raster-dem', tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], tileSize: 512, maxzoom: 14, encoding: 'terrarium',
              attribution: '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>' };
  var demShade = { type: 'raster-dem', tiles: dem.tiles, tileSize: 512, maxzoom: 14, encoding: 'terrarium' };

  function style() {
    var dark = settings.dark;
    return {
      version: 8,
      sources: {
        land: { type: 'geojson', data: window.HJ_LAND, attribution: 'Natural Earth' },
        borders: { type: 'geojson', data: window.HJ_BORDERS },
        sat: satSource(settings), dem: dem, demShade: demShade,
        hikes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        starts: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': dark ? '#16232c' : '#cfdbe3' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': dark ? '#232b30' : '#eef0ec' } },
        { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': dark ? '#46525a' : '#b7c0c6', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 1] } },
        { id: 'sat', type: 'raster', source: 'sat', minzoom: 4, paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6.5, 1], 'raster-fade-duration': 150 } },
        { id: 'shade', type: 'hillshade', source: 'demShade', minzoom: 5, maxzoom: 10, paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#1f2a30' } },
        { id: 'hike-casing', type: 'line', source: 'hikes', layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 5, 15, 9] } },
        { id: 'hike-line', type: 'line', source: 'hikes', layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['case', ['boolean', ['get', 'selected'], false], '#ffd400', ACCENT], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 10, 3, 15, 5.5] } },
        { id: 'hike-dot', type: 'circle', source: 'starts', maxzoom: 9,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 5, 8, 8], 'circle-color': ACCENT, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } }
      ]
    };
  }

  var map = new maplibregl.Map({ container: 'map', style: style(), center: WORLD.center, zoom: WORLD.zoom, maxPitch: 80, attributionControl: false });
  window.__hjMap = map; // for debugging from DevTools
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.on('error', function (e) { if (window.console) console.warn('map', e && e.error && e.error.message); });

  function setTerrain(on, animate) {
    if (on && !terrainOn) map.setTerrain({ source: 'dem', exaggeration: settings.exaggeration });
    if (!on && terrainOn) map.setTerrain(null);
    terrainOn = on;
    send({ type: 'mode', is3d: on });
    if (animate) map.easeTo(on ? { pitch: 60, duration: dur(1000) } : { pitch: 0, bearing: 0, duration: dur(700) });
  }
  function fly(opts, threeD) {
    flying = true;
    if (threeD) setTerrain(true, false);
    opts.duration = dur(opts.duration || 4000); opts.essential = true; opts.curve = 1.5;
    map.flyTo(opts);
    map.once('moveend', function () { flying = false; if (!threeD) setTerrain(false, false); });
  }
  map.on('zoom', function () { document.body.classList.toggle('lowzoom', map.getZoom() < 10.5); });
  // Automatic 2D/3D switch only once the camera has stopped. Switching terrain and starting easeTo from inside
  // a 'zoom' event while the user is still wheel-zooming froze the map (camera stuck "moving", zoom locked).
  function autoMode() {
    if (flying || !settings.auto3d || map.isMoving()) return;
    var z = map.getZoom();
    if (z >= 9 && !terrainOn) setTerrain(true, true);
    else if (z < 8.3 && terrainOn) setTerrain(false, true);
    // 2D: flatten a tilt left over when the user kept zooming during the switch
    else if (!terrainOn && map.getPitch() > 1) map.easeTo({ pitch: 0, bearing: 0, duration: dur(500) });
  }
  map.on('moveend', function () { setTimeout(autoMode, 0); });
  ['hike-line', 'hike-dot'].forEach(function (layer) {
    map.on('click', layer, function (e) { var f = e.features && e.features[0]; if (f) send({ type: 'select', id: f.properties.id }); });
    map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
  });

  function syncHikes() {
    map.getSource('hikes').setData({ type: 'FeatureCollection', features: hikes.map(function (h) {
      return { type: 'Feature', properties: { id: h.id, selected: h.id === selected }, geometry: { type: 'LineString', coordinates: h.coords } };
    }) });
    map.getSource('starts').setData({ type: 'FeatureCollection', features: hikes.map(function (h) {
      return { type: 'Feature', properties: { id: h.id }, geometry: { type: 'Point', coordinates: h.start } };
    }) });
    peakMarkers.forEach(function (m) { m.remove(); });
    peakMarkers = hikes.map(function (h) {
      var d = document.createElement('div'); d.className = 'pin';
      var n = document.createElement('span'); n.textContent = h.label;
      var e = document.createElement('i'); e.textContent = h.ele + ' m';
      d.appendChild(n); d.appendChild(document.createTextNode(' ')); d.appendChild(e);
      return new maplibregl.Marker({ element: d, anchor: 'bottom', offset: [0, -8], opacity: '1', opacityWhenCovered: '0.85' }).setLngLat(h.summit).addTo(map);
    });
  }
  function syncMedia() {
    mediaMarkers.forEach(function (m) { m.remove(); });
    mediaMarkers = media.map(function (f) {
      var b = document.createElement('button'); b.className = 'media-pin';
      b.setAttribute('aria-label', f.video ? 'Video' : 'Fotografija');
      b.textContent = f.video ? '▶' : '';
      b.onclick = function (ev) { ev.stopPropagation(); send({ type: 'media', id: f.id }); };
      return new maplibregl.Marker({ element: b }).setLngLat([f.lon, f.lat]).addTo(map);
    });
  }
  function bounds(list) {
    var w = 180, s = 90, e = -180, n = -90;
    list.forEach(function (h) { w = Math.min(w, h.bbox[0]); s = Math.min(s, h.bbox[1]); e = Math.max(e, h.bbox[2]); n = Math.max(n, h.bbox[3]); });
    return [[w, s], [e, n]];
  }
  function flyToHike(id) {
    var h = hikes.find(function (x) { return x.id === id; }); if (!h) return;
    var cam = map.cameraForBounds(bounds([h]), { padding: padding, bearing: h.bearing });
    if (cam) fly({ center: cam.center, zoom: Math.min(13.2, cam.zoom - 1.2), bearing: h.bearing, pitch: 52, duration: 4200 }, true);
  }
  function flyToAll() {
    if (!hikes.length) return;
    var cam = map.cameraForBounds(bounds(hikes), { padding: padding });
    if (!cam) return;
    var zoom = Math.min(13, cam.zoom - 0.25);
    fly({ center: cam.center, zoom: zoom, bearing: 0, pitch: zoom >= 9 ? 50 : 0, duration: 4500 }, zoom >= 9);
  }

  function handle(c) {
    if (!ready) { queue.push(c); return; }
    switch (c.cmd) {
      case 'hikes': hikes = c.hikes || []; selected = c.selected || null; syncHikes(); break;
      case 'select': selected = c.id; syncHikes(); break;
      case 'fly': flyToHike(c.id); break;
      case 'all': flyToAll(); break;
      case 'world': fly({ center: WORLD.center, zoom: WORLD.zoom, pitch: 0, bearing: 0, duration: 3000 }, false); break;
      case 'toggle3d': setTerrain(!terrainOn, true); break;
      case 'north': map.easeTo({ bearing: 0, duration: dur(600) }); break;
      case 'padding': padding = c.padding; break;
      case 'media': media = c.items || []; syncMedia(); break;
      case 'settings':
        var before = satKey(settings);
        settings = Object.assign(settings, c);
        if (satKey(settings) !== before) {
          map.removeLayer('sat'); map.removeSource('sat');
          map.addSource('sat', satSource(settings));
          map.addLayer({ id: 'sat', type: 'raster', source: 'sat', minzoom: 4, paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6.5, 1] } }, 'shade');
        }
        map.setLayoutProperty('sat', 'visibility', settings.satellite ? 'visible' : 'none');
        document.body.classList.toggle('nopeaks', settings.peakLabels === false);
        if (terrainOn) map.setTerrain({ source: 'dem', exaggeration: settings.exaggeration });
        break;
    }
  }

  window.hj = { cmd: function (c) { try { handle(typeof c === 'string' ? JSON.parse(c) : c); } catch (e) { if (window.console) console.error(e); } } };
  window.addEventListener('message', function (ev) { if (ev.data && ev.data.hjToMap) window.hj.cmd(ev.data.hjToMap); });

  map.on('load', function () {
    map.setSky({ 'sky-color': '#8fb0cf', 'horizon-color': '#dfe6ec', 'fog-color': '#dfe6ec', 'sky-horizon-blend': 0.6,
                 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.85, 'atmosphere-blend': 0.6 });
    document.body.classList.add('lowzoom');
    ready = true;
    queue.splice(0).forEach(handle);
    send({ type: 'ready' });
  });
})();
