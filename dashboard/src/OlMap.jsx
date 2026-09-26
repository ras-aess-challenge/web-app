import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import { fromLonLat } from 'ol/proj.js';
import { Attribution, defaults as defaultControls } from 'ol/control.js';
import { Stroke, Fill, Style, Text, RegularShape, Circle as CircleStyle } from 'ol/style.js';

// Site anchor: local (x,y) meters are plotted as ANCHOR_MERC + [x, y].
// EPSG:3857 units are meters, so offsets are exact for small sites.
// Placeholder default: Tunis, Tunisia — set VITE_ANCHOR_LON/LAT to the real test site.
const ANCHOR = [
  Number(import.meta.env?.VITE_ANCHOR_LON ?? 10.1815),
  Number(import.meta.env?.VITE_ANCHOR_LAT ?? 36.8065),
];
const ANCHOR_MERC = fromLonLat(ANCHOR);
const P = (x, y) => [ANCHOR_MERC[0] + x, ANCHOR_MERC[1] + y];

const HOME_BLANK = { center: [0, 0], resolution: 0.05 };
const HOME_OSM = { center: ANCHOR_MERC, resolution: 0.5 };
const K = 2; // ellipse ~95%

function ellipseRing(cx, cy, sx, sy, angleDeg, k = K, n = 64) {
  const a = (-angleDeg * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ex = Math.cos(t) * sx * k, ey = Math.sin(t) * sy * k;
    ring.push(P(cx + ex * Math.cos(a) - ey * Math.sin(a), cy + ex * Math.sin(a) + ey * Math.cos(a)));
  }
  return [ring];
}

function gridFeatures(extent = 24, step = 2) {
  const feats = [];
  for (let g = -extent; g <= extent; g += step) {
    feats.push(new Feature({ geometry: new LineString([P(-extent, g), P(extent, g)]) }));
    feats.push(new Feature({ geometry: new LineString([P(g, -extent), P(g, extent)]) }));
  }
  return feats;
}

const staleColor = (s) => (s === 'LOST' ? '#ff5252' : s === 'STALE' ? '#ffb020' : '#35d07f');

// Same props as MapCanvas so App can A/B them.
export default function OlMap({ targets, robots, trails, beacons, events, mission, layers, selectedBeacon }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const srcRef = useRef(null);
  const [base, setBase] = useState('osm'); // osm | blank
  const [follow, setFollow] = useState('none'); // none | writer | executor

  useEffect(() => {
    const src = {
      grid: new VectorSource({ features: gridFeatures() }),
      trails: new VectorSource(),
      beacons: new VectorSource(),
      events: new VectorSource(),
      mission: new VectorSource(),
      robots: new VectorSource(),
      targets: new VectorSource(),
    };
    const osmLayer = new TileLayer({ source: new OSM(), zIndex: -1 });
    const gridLayer = new VectorLayer({ source: src.grid, style: new Style({ stroke: new Stroke({ color: '#1c2530', width: 1 }) }), zIndex: 0 });
    const trailsLayer = new VectorLayer({ source: src.trails, zIndex: 1 });
    const missionLayer = new VectorLayer({ source: src.mission, zIndex: 2 });
    const eventsLayer = new VectorLayer({ source: src.events, zIndex: 3 });
    const beaconsLayer = new VectorLayer({ source: src.beacons, zIndex: 4 });
    const targetsLayer = new VectorLayer({ source: src.targets, zIndex: 5 });
    const robotsLayer = new VectorLayer({ source: src.robots, zIndex: 6 });
    const map = new Map({
      target: divRef.current,
      layers: [osmLayer, gridLayer, trailsLayer, missionLayer, eventsLayer, beaconsLayer, targetsLayer, robotsLayer],
      view: new View({ center: HOME_OSM.center, resolution: HOME_OSM.resolution, minResolution: 0.005, maxResolution: 50 }),
      controls: defaultControls({ zoom: false, rotate: false }).extend([new Attribution({ collapsible: true })]),
    });
    mapRef.current = map;
    srcRef.current = { src, osmLayer, gridLayer, layers: { trailsLayer, missionLayer, eventsLayer, beaconsLayer, targetsLayer } };
    return () => map.setTarget(null);
  }, []);

  // base switch: OSM tiles vs offline grid
  useEffect(() => {
    if (!srcRef.current) return;
    srcRef.current.osmLayer.setVisible(base === 'osm');
    srcRef.current.gridLayer.setVisible(base === 'blank');
    const v = mapRef.current?.getView();
    if (v) {
      const home = base === 'osm' ? HOME_OSM : HOME_BLANK;
      v.setCenter(home.center);
      v.setResolution(home.resolution);
    }
  }, [base]);

  useEffect(() => {
    if (!srcRef.current) return;
    const { src, layers: L } = srcRef.current;
    L.trailsLayer.setVisible(!!layers.trails);
    L.beaconsLayer.setVisible(!!layers.beacons);
    L.eventsLayer.setVisible(!!layers.events);
    L.targetsLayer.setVisible(!!layers.targets);

    // trails
    src.trails.clear();
    if (layers.trails) {
      for (const [rid, pts] of Object.entries(trails || {})) {
        if (!pts || pts.length < 2) continue;
        src.trails.addFeature(new Feature({
          geometry: new LineString(pts.map((p) => P(p.x, p.y))),
        }));
        src.trails.getFeatures().at(-1).setStyle(new Style({ stroke: new Stroke({ color: rid === 'writer' ? '#22b8cf' : '#a9e34b', width: 3 }) }));
      }
    }
    // beacons
    src.beacons.clear();
    if (layers.beacons) {
      for (const b of Object.values(beacons || {})) {
        const f = new Feature({ geometry: new Point(P(b.pos.x, b.pos.y)) });
        const sel = b.id === selectedBeacon;
        f.setStyle(new Style({
          image: new RegularShape({ points: 4, radius: 10, rotation: Math.PI / 4, fill: new Fill({ color: sel ? '#ffd43b' : '#4dabf7' }), stroke: new Stroke({ color: '#0b0e13', width: 1 }) }),
          text: new Text({ text: b.id, offsetY: -15, fill: new Fill({ color: '#111' }), backgroundFill: new Fill({ color: 'rgba(255,255,255,0.8)' }), padding: [1, 3, 1, 3] }),
        }));
        src.beacons.addFeature(f);
      }
    }
    // events
    src.events.clear();
    if (layers.events) {
      for (const e of (events || []).slice(0, 50)) {
        const f = new Feature({ geometry: new Point(P(e.pos.x, e.pos.y)) });
        f.setStyle(new Style({
          image: new RegularShape({
            points: 4, radius: 9, rotation: 0,
            fill: new Fill({ color: e.severity === 'critical' ? '#ff5252' : e.severity === 'warn' ? '#ffb020' : '#868e96' }),
          }),
        }));
        src.events.addFeature(f);
      }
    }
    // mission link + ring
    src.mission.clear();
    const mpos = mission?.target?.pos || (mission?.target?.beaconId && beacons?.[mission.target.beaconId]?.pos);
    if (mpos && robots?.executor && mission?.status !== 'done' && mission?.status !== 'cancelled') {
      const color = mission?.status === 'failed' ? '#ff5252' : mission?.status === 'pending' ? '#ffd43b' : '#e599f7';
      const line = new Feature({ geometry: new LineString([P(robots.executor.pos.x, robots.executor.pos.y), P(mpos.x, mpos.y)]) });
      line.setStyle(new Style({ stroke: new Stroke({ color, width: 3, lineDash: [10, 8] }) }));
      const ring = new Feature({ geometry: new Point(P(mpos.x, mpos.y)) });
      ring.setStyle(new Style({ image: new CircleStyle({ radius: 14, stroke: new Stroke({ color, width: 3 }) }) }));
      src.mission.addFeature(line);
      src.mission.addFeature(ring);
    } else if (mpos && mission?.status === 'done') {
      const ring = new Feature({ geometry: new Point(P(mpos.x, mpos.y)) });
      ring.setStyle(new Style({
        image: new CircleStyle({ radius: 14, stroke: new Stroke({ color: '#35d07f', width: 3 }) }),
        text: new Text({ text: '✓', fill: new Fill({ color: '#35d07f' }) }),
      }));
      src.mission.addFeature(ring);
    }
    // robots
    src.robots.clear();
    for (const [rid, r] of Object.entries(robots || {})) {
      if (!r) continue;
      const f = new Feature({ geometry: new Point(P(r.pos.x, r.pos.y)) });
      f.setStyle(new Style({
        image: new RegularShape({
          points: 3, radius: 12, rotation: Math.PI / 2 - (r.theta || 0),
          fill: new Fill({ color: rid === 'writer' ? '#22b8cf' : '#a9e34b' }),
          stroke: new Stroke({ color: '#0b0e13', width: 1 }),
        }),
        text: new Text({ text: rid, offsetY: -19, fill: new Fill({ color: '#111' }), backgroundFill: new Fill({ color: 'rgba(255,255,255,0.85)' }), padding: [1, 4, 1, 4] }),
      }));
      src.robots.addFeature(f);
    }
    // targets + ellipses (LOST targets dimmed so stale ghosts don't dominate)
    src.targets.clear();
    if (layers.targets) {
      for (const t of Object.values(targets || {})) {
        const lost = t._stale === 'LOST';
        const el = new Feature({ geometry: new Polygon(ellipseRing(t.pos.x, t.pos.y, t.uncertainty.sigmaX, t.uncertainty.sigmaY, t.uncertainty.angleDeg)) });
        el.setStyle(new Style({
          stroke: new Stroke({ color: lost ? staleColor(t._stale) + '66' : staleColor(t._stale), width: 2 }),
          fill: new Fill({ color: staleColor(t._stale) + '22' }),
        }));
        const dot = new Feature({ geometry: new Point(P(t.pos.x, t.pos.y)) });
        dot.setStyle(new Style({
          image: new CircleStyle({ radius: 6, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#0b0e13', width: 1 }), opacity: lost ? 0.35 : 1 }),
          text: new Text({ text: `${t.id} ${(t.confidence ?? 0).toFixed(2)}`, offsetX: 13, textAlign: 'left', fill: new Fill({ color: '#111' }), backgroundFill: new Fill({ color: 'rgba(255,255,255,0.85)' }), padding: [1, 4, 1, 4], opacity: lost ? 0.5 : 1 }),
        }));
        src.targets.addFeature(el);
        src.targets.addFeature(dot);
      }
    }
    // follow camera
    if (follow !== 'none' && robots?.[follow]) {
      mapRef.current?.getView().setCenter(P(robots[follow].pos.x, robots[follow].pos.y));
    }
  });

  const zoom = (f) => {
    const v = mapRef.current?.getView();
    if (!v) return;
    v.setResolution(Math.min(50, Math.max(0.005, v.getResolution() * f)));
  };
  const reset = () => {
    const v = mapRef.current?.getView();
    if (!v) return;
    const home = base === 'osm' ? HOME_OSM : HOME_BLANK;
    v.setCenter(home.center);
    v.setResolution(home.resolution);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => zoom(1 / 1.2)}>+</button>
        <button onClick={() => zoom(1.2)}>−</button>
        <button onClick={reset}>reset</button>
        <span>
          <button onClick={() => setBase('osm')} disabled={base === 'osm'}>real map</button>{' '}
          <button onClick={() => setBase('blank')} disabled={base === 'blank'}>grid</button>
        </span>
        <span>
          follow:
          <button onClick={() => setFollow('none')} disabled={follow === 'none'}>none</button>{' '}
          <button onClick={() => setFollow('writer')} disabled={follow === 'writer'}>writer</button>{' '}
          <button onClick={() => setFollow('executor')} disabled={follow === 'executor'}>executor</button>
        </span>
        <span style={{ color: '#9fb2c8' }}>openlayers · drag pan · wheel zoom · anchor {ANCHOR[0].toFixed(4)},{ANCHOR[1].toFixed(4)}</span>
      </div>
      <div ref={divRef} style={{ width: '100%', height: 480, background: '#0e1319', border: '1px solid #222' }} />
    </div>
  );
}
