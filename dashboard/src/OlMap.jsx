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
import { boundingExtent, buffer } from 'ol/extent.js';
import { Attribution, ScaleLine, defaults as defaultControls } from 'ol/control.js';
import { Stroke, Fill, Style, Text, RegularShape, Circle as CircleStyle } from 'ol/style.js';
import { ANCHOR, ANCHOR_MERC, toMap } from './geo.js';
import { ROBOT_COLORS } from './panels.jsx';

// Local (x,y) meters -> map coordinates (true meters, see geo.js).
const P = toMap;

// Both bases are centered on the site anchor (local origin), ~4 cm per pixel.
const HOME = { center: ANCHOR_MERC, resolution: 0.05 };
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

function gridFeatures(extent = 30, step = 2) {
  const feats = [];
  for (let g = -extent; g <= extent; g += step) {
    feats.push(new Feature({ geometry: new LineString([P(-extent, g), P(extent, g)]), major: g % 10 === 0 }));
    feats.push(new Feature({ geometry: new LineString([P(g, -extent), P(g, extent)]), major: g % 10 === 0 }));
  }
  return feats;
}

const staleColor = (s) => (s === 'LOST' ? '#ff5252' : s === 'STALE' ? '#ffb020' : '#35d07f');

function label(text, opts = {}) {
  return new Text({
    text,
    font: '600 12px system-ui, sans-serif',
    fill: new Fill({ color: '#f1f5f9' }),
    backgroundFill: new Fill({ color: 'rgba(11,14,19,0.85)' }),
    padding: [2, 5, 2, 5],
    ...opts,
  });
}

// Every position the map draws, for "fit to data".
function dataCoords({ robots, targets, beacons, trails, mission }) {
  const pts = [];
  for (const r of Object.values(robots || {})) if (r?.pos) pts.push(P(r.pos.x, r.pos.y));
  for (const t of Object.values(targets || {})) if (t?.pos) pts.push(P(t.pos.x, t.pos.y));
  for (const b of Object.values(beacons || {})) if (b?.pos) pts.push(P(b.pos.x, b.pos.y));
  for (const arr of Object.values(trails || {})) for (const p of arr || []) pts.push(P(p.x, p.y));
  if (mission?.target?.pos) pts.push(P(mission.target.pos.x, mission.target.pos.y));
  return pts;
}

// Same props as MapCanvas so App can A/B them.
export default function OlMap({ targets, robots, trails, beacons, events, mission, layers, selectedBeacon }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const srcRef = useRef(null);
  const sigRef = useRef('');
  const fittedRef = useRef(false);
  const [base, setBase] = useState('osm'); // osm | blank
  const [follow, setFollow] = useState('none'); // none | writer | executor

  // Cheap signature of everything the map draws (excludes volatile timestamps).
  function dataSig() {
    const r = (n) => Math.round(n * 100) / 100;
    const trailSig = Object.entries(trails || {}).map(([id, pts]) => `${id}:${pts.length}:${pts.length ? `${r(pts[pts.length - 1].x)},${r(pts[pts.length - 1].y)}` : ''}`);
    const robotSig = Object.values(robots || {}).map((o) => `${o.id}:${r(o.pos.x)},${r(o.pos.y)},${o.theta},${o.state}`);
    const beaconSig = Object.values(beacons || {}).map((b) => `${b.id}:${r(b.pos.x)},${r(b.pos.y)},${b.status}`);
    const eventSig = (events || []).slice(0, 50).map((e) => e.id);
    const missionSig = mission ? `${mission.id}:${mission.status}:${mission.target?.beaconId}:${mission.target?.pos ? `${r(mission.target.pos.x)},${r(mission.target.pos.y)}` : ''}` : 'none';
    const targetSig = Object.values(targets || {}).map((t) => `${t.id}:${r(t.pos.x)},${r(t.pos.y)},${t.confidence?.toFixed(2)},${t._stale}`);
    return JSON.stringify([trailSig, robotSig, beaconSig, eventSig, missionSig, targetSig, selectedBeacon, layers]);
  }

  function fitToData(animate = true) {
    const v = mapRef.current?.getView();
    const pts = dataCoords({ robots, targets, beacons, trails, mission });
    if (!v || pts.length === 0) return false;
    // Always include the area around the local origin (writer start) so the
    // first fit shows the whole site, not just one robot.
    pts.push(P(-8, -6), P(8, 6));
    const ext = buffer(boundingExtent(pts), 4); // + ~4 m margin
    v.fit(ext, { padding: [40, 40, 40, 40], minResolution: 0.02, maxZoom: 28, duration: animate ? 300 : 0 });
    return true;
  }

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
    const minor = new Style({ stroke: new Stroke({ color: '#1c2530', width: 1 }) });
    const major = new Style({ stroke: new Stroke({ color: '#2b3a4b', width: 1.5 }) });
    const osmLayer = new TileLayer({ source: new OSM(), zIndex: -1 });
    const gridLayer = new VectorLayer({ source: src.grid, style: (f) => (f.get('major') ? major : minor), zIndex: 0, visible: false });
    const trailsLayer = new VectorLayer({ source: src.trails, zIndex: 1 });
    const missionLayer = new VectorLayer({ source: src.mission, zIndex: 2 });
    const eventsLayer = new VectorLayer({ source: src.events, zIndex: 3 });
    const beaconsLayer = new VectorLayer({ source: src.beacons, zIndex: 4 });
    const targetsLayer = new VectorLayer({ source: src.targets, zIndex: 5 });
    const robotsLayer = new VectorLayer({ source: src.robots, zIndex: 6 });
    const map = new Map({
      target: divRef.current,
      layers: [osmLayer, gridLayer, trailsLayer, missionLayer, eventsLayer, beaconsLayer, targetsLayer, robotsLayer],
      view: new View({ center: HOME.center, resolution: HOME.resolution, minResolution: 0.005, maxResolution: 50 }),
      controls: defaultControls({ zoom: false, rotate: false }).extend([
        new Attribution({ collapsible: true }),
        new ScaleLine({ units: 'metric' }),
      ]),
    });
    mapRef.current = map;
    srcRef.current = { src, osmLayer, gridLayer, layers: { trailsLayer, missionLayer, eventsLayer, beaconsLayer, targetsLayer } };
    return () => map.setTarget(null);
  }, []);

  // base switch: OSM tiles vs offline grid (same center: the site anchor)
  useEffect(() => {
    if (!srcRef.current) return;
    srcRef.current.osmLayer.setVisible(base === 'osm');
    srcRef.current.gridLayer.setVisible(base === 'blank');
  }, [base]);

  useEffect(() => {
    if (!srcRef.current) return;
    // First data: zoom so every robot / target / beacon is on screen.
    if (!fittedRef.current && Object.keys(robots || {}).length > 0) fittedRef.current = fitToData(false);
    // follow camera stays live every render (cheap: one setCenter)
    if (follow !== 'none' && robots?.[follow]) {
      mapRef.current?.getView().setCenter(P(robots[follow].pos.x, robots[follow].pos.y));
    }
    const sig = dataSig();
    if (sig === sigRef.current) return; // no real change since last rebuild
    sigRef.current = sig;
    const { src, layers: L } = srcRef.current;
    L.trailsLayer.setVisible(!!layers.trails);
    L.beaconsLayer.setVisible(!!layers.beacons);
    L.eventsLayer.setVisible(!!layers.events);
    L.targetsLayer.setVisible(!!layers.targets);

    // trails (spatial memory)
    src.trails.clear();
    if (layers.trails) {
      for (const [rid, pts] of Object.entries(trails || {})) {
        if (!pts || pts.length < 2) continue;
        const f = new Feature({ geometry: new LineString(pts.map((p) => P(p.x, p.y))) });
        f.setStyle([
          new Style({ stroke: new Stroke({ color: 'rgba(11,14,19,0.6)', width: 6 }) }),
          new Style({ stroke: new Stroke({ color: ROBOT_COLORS[rid] ?? '#ced4da', width: 3 }) }),
        ]);
        src.trails.addFeature(f);
      }
    }
    // beacons
    src.beacons.clear();
    if (layers.beacons) {
      for (const b of Object.values(beacons || {})) {
        const f = new Feature({ geometry: new Point(P(b.pos.x, b.pos.y)) });
        const sel = b.id === selectedBeacon;
        const styles = [new Style({
          image: new RegularShape({ points: 4, radius: 12, angle: 0, fill: new Fill({ color: sel ? '#ffd43b' : '#4dabf7' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
          text: label(b.id, { offsetY: -20 }),
        })];
        if (sel) styles.push(new Style({ image: new CircleStyle({ radius: 20, stroke: new Stroke({ color: '#ffd43b', width: 2, lineDash: [4, 4] }) }) }));
        f.setStyle(styles);
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
            points: 4, radius: 8, angle: Math.PI / 4,
            fill: new Fill({ color: e.severity === 'critical' ? '#ff5252' : e.severity === 'warn' ? '#ffb020' : '#868e96' }),
            stroke: new Stroke({ color: '#0b0e13', width: 1 }),
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
      ring.setStyle(new Style({ image: new CircleStyle({ radius: 16, stroke: new Stroke({ color, width: 3 }) }), text: label(`${mission.id} · ${mission.status}`, { offsetY: 28 }) }));
      src.mission.addFeature(line);
      src.mission.addFeature(ring);
    } else if (mpos && mission?.status === 'done') {
      const ring = new Feature({ geometry: new Point(P(mpos.x, mpos.y)) });
      ring.setStyle(new Style({
        image: new CircleStyle({ radius: 16, stroke: new Stroke({ color: '#35d07f', width: 3 }) }),
        text: label(`✓ ${mission.id} done`, { offsetY: 28, fill: new Fill({ color: '#35d07f' }) }),
      }));
      src.mission.addFeature(ring);
    }
    // robots (oriented triangles, white outline so they pop on any base)
    src.robots.clear();
    for (const [rid, r] of Object.entries(robots || {})) {
      if (!r) continue;
      const f = new Feature({ geometry: new Point(P(r.pos.x, r.pos.y)) });
      f.setStyle([
        new Style({ image: new CircleStyle({ radius: 18, fill: new Fill({ color: `${ROBOT_COLORS[rid] ?? '#ced4da'}33` }) }) }),
        new Style({
          image: new RegularShape({
            points: 3, radius: 14, rotation: Math.PI / 2 - (r.theta || 0),
            fill: new Fill({ color: ROBOT_COLORS[rid] ?? '#ced4da' }),
            stroke: new Stroke({ color: '#fff', width: 2 }),
          }),
          text: label(`${rid} · ${r.state}`, { offsetY: -26 }),
        }),
      ]);
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
          image: new CircleStyle({ radius: 6, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#0b0e13', width: 2 }) }),
          text: label(`${t.id} ${((t.confidence ?? 0) * 100).toFixed(0)}%`, { offsetX: 12, textAlign: 'left' }),
        }));
        src.targets.addFeature(el);
        src.targets.addFeature(dot);
      }
    }
  });

  const zoom = (f) => {
    const v = mapRef.current?.getView();
    if (!v) return;
    v.animate({ resolution: Math.min(50, Math.max(0.005, v.getResolution() * f)), duration: 150 });
  };

  return (
    <div>
      <div className="map-tools">
        <div className="seg">
          <button onClick={() => zoom(1 / 1.5)} title="Zoom in">+</button>
          <button onClick={() => zoom(1.5)} title="Zoom out">−</button>
          <button onClick={() => fitToData(true)} title="Show all robots, targets and beacons">Fit</button>
        </div>
        <div className="seg">
          <button className={base === 'osm' ? 'active' : ''} onClick={() => setBase('osm')}>Street map</button>
          <button className={base === 'blank' ? 'active' : ''} onClick={() => setBase('blank')}>Offline grid</button>
        </div>
        <div className="seg">
          <span className="seg-label">Follow</span>
          {['none', 'writer', 'executor'].map((k) => (
            <button key={k} className={follow === k ? 'active' : ''} onClick={() => setFollow(k)}>{k}</button>
          ))}
        </div>
        <span className="muted small">anchor {ANCHOR[1].toFixed(5)}, {ANCHOR[0].toFixed(5)}</span>
      </div>
      <div ref={divRef} className="ol-map" />
    </div>
  );
}
