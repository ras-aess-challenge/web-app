import { useEffect, useRef } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import { Stroke, Fill, Style, Text, RegularShape, Circle as CircleStyle } from 'ol/style.js';

const HOME = { center: [0, 0], resolution: 0.05 };
const K = 2; // ellipse ~95%

// meters -> map units is identity (EPSG:3857 units are meters)
function ellipseRing(cx, cy, sx, sy, angleDeg, k = K, n = 64) {
  const a = (-angleDeg * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ex = Math.cos(t) * sx * k, ey = Math.sin(t) * sy * k;
    ring.push([cx + ex * Math.cos(a) - ey * Math.sin(a), cy + ex * Math.sin(a) + ey * Math.cos(a)]);
  }
  return [ring];
}

function gridFeatures(extent = 24, step = 2) {
  const feats = [];
  for (let g = -extent; g <= extent; g += step) {
    feats.push(new Feature({ geometry: new LineString([[-extent, g], [extent, g]]) }));
    feats.push(new Feature({ geometry: new LineString([[g, -extent], [g, extent]]) }));
  }
  return feats;
}

const staleColor = (s) => (s === 'LOST' ? '#ff5252' : s === 'STALE' ? '#ffb020' : '#35d07f');

// Same props as MapCanvas so App can A/B them.
export default function OlMap({ targets, robots, trails, beacons, events, mission, layers, selectedBeacon }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const srcRef = useRef(null);

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
    const gridLayer = new VectorLayer({ source: src.grid, style: new Style({ stroke: new Stroke({ color: '#1c2530', width: 1 }) }), zIndex: 0 });
    const trailsLayer = new VectorLayer({ source: src.trails, zIndex: 1 });
    const missionLayer = new VectorLayer({ source: src.mission, zIndex: 2 });
    const eventsLayer = new VectorLayer({ source: src.events, zIndex: 3 });
    const beaconsLayer = new VectorLayer({ source: src.beacons, zIndex: 4 });
    const targetsLayer = new VectorLayer({ source: src.targets, zIndex: 5 });
    const robotsLayer = new VectorLayer({ source: src.robots, zIndex: 6 });
    const map = new Map({
      target: divRef.current,
      layers: [gridLayer, trailsLayer, missionLayer, eventsLayer, beaconsLayer, targetsLayer, robotsLayer],
      view: new View({ center: HOME.center, resolution: HOME.resolution, minResolution: 0.005, maxResolution: 2 }),
      controls: [],
    });
    mapRef.current = map;
    srcRef.current = { src, layers: { trailsLayer, missionLayer, eventsLayer, beaconsLayer, targetsLayer } };
    return () => map.setTarget(null);
  }, []);

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
          geometry: new LineString(pts.map((p) => [p.x, p.y])),
        }));
        src.trails.getFeatures().at(-1).setStyle(new Style({ stroke: new Stroke({ color: rid === 'writer' ? '#22b8cf' : '#a9e34b', width: 2 }) }));
      }
    }
    // beacons
    src.beacons.clear();
    if (layers.beacons) {
      for (const b of Object.values(beacons || {})) {
        const f = new Feature({ geometry: new Point([b.pos.x, b.pos.y]) });
        const sel = b.id === selectedBeacon;
        f.setStyle(new Style({
          image: new RegularShape({ points: 4, radius: 9, rotation: Math.PI / 4, fill: new Fill({ color: sel ? '#ffd43b' : '#4dabf7' }) }),
          text: new Text({ text: b.id, offsetY: -14, fill: new Fill({ color: '#9fb2c8' }) }),
        }));
        src.beacons.addFeature(f);
      }
    }
    // events
    src.events.clear();
    if (layers.events) {
      for (const e of (events || []).slice(0, 50)) {
        const f = new Feature({ geometry: new Point([e.pos.x, e.pos.y]) });
        f.setStyle(new Style({
          image: new RegularShape({
            points: 4, radius: 8, rotation: 0,
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
      const line = new Feature({ geometry: new LineString([[robots.executor.pos.x, robots.executor.pos.y], [mpos.x, mpos.y]]) });
      line.setStyle(new Style({ stroke: new Stroke({ color, width: 2, lineDash: [10, 8] }) }));
      const ring = new Feature({ geometry: new Point([mpos.x, mpos.y]) });
      ring.setStyle(new Style({ image: new CircleStyle({ radius: 14, stroke: new Stroke({ color, width: 2 }) }) }));
      src.mission.addFeature(line);
      src.mission.addFeature(ring);
    } else if (mpos && mission?.status === 'done') {
      const ring = new Feature({ geometry: new Point([mpos.x, mpos.y]) });
      ring.setStyle(new Style({
        image: new CircleStyle({ radius: 14, stroke: new Stroke({ color: '#35d07f', width: 2 }) }),
        text: new Text({ text: '✓', fill: new Fill({ color: '#35d07f' }) }),
      }));
      src.mission.addFeature(ring);
    }
    // robots
    src.robots.clear();
    for (const [rid, r] of Object.entries(robots || {})) {
      if (!r) continue;
      const f = new Feature({ geometry: new Point([r.pos.x, r.pos.y]) });
      f.setStyle(new Style({
        image: new RegularShape({
          points: 3, radius: 11, rotation: Math.PI / 2 - (r.theta || 0),
          fill: new Fill({ color: rid === 'writer' ? '#22b8cf' : '#a9e34b' }),
        }),
        text: new Text({ text: rid, offsetY: -18, fill: new Fill({ color: '#fff' }) }),
      }));
      src.robots.addFeature(f);
    }
    // targets + ellipses
    src.targets.clear();
    if (layers.targets) {
      for (const t of Object.values(targets || {})) {
        const el = new Feature({ geometry: new Polygon(ellipseRing(t.pos.x, t.pos.y, t.uncertainty.sigmaX, t.uncertainty.sigmaY, t.uncertainty.angleDeg)) });
        el.setStyle(new Style({ stroke: new Stroke({ color: staleColor(t._stale), width: 2 }) }));
        const dot = new Feature({ geometry: new Point([t.pos.x, t.pos.y]) });
        dot.setStyle(new Style({
          image: new CircleStyle({ radius: 5, fill: new Fill({ color: '#fff' }) }),
          text: new Text({ text: `${t.id} ${(t.confidence ?? 0).toFixed(2)}`, offsetX: 12, textAlign: 'left', fill: new Fill({ color: '#9fb2c8' }) }),
        }));
        src.targets.addFeature(el);
        src.targets.addFeature(dot);
      }
    }
  });

  const zoom = (f) => {
    const v = mapRef.current?.getView();
    if (!v) return;
    v.setResolution(Math.min(2, Math.max(0.005, v.getResolution() * f)));
  };
  const reset = () => {
    const v = mapRef.current?.getView();
    if (!v) return;
    v.setCenter(HOME.center);
    v.setResolution(HOME.resolution);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <button onClick={() => zoom(1 / 1.2)}>+</button>
        <button onClick={() => zoom(1.2)}>−</button>
        <button onClick={reset}>reset</button>
        <span style={{ color: '#9fb2c8' }}>openlayers · drag pan · wheel zoom · 1 unit = 1 m</span>
      </div>
      <div ref={divRef} style={{ width: '100%', height: 480, background: '#0e1319', border: '1px solid #222' }} />
    </div>
  );
}
