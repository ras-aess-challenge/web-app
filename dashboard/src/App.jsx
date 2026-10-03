import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { createWSClient } from './wsClient.js';
import { targetAge, classifyStaleness } from './staleness.js';
import MapCanvas from './MapCanvas.jsx';
import {
  RobotCard, MissionCard, TargetsCard, BeaconPanel, EventFeed, CommandLog, SystemChain,
  ROBOT_COLORS, ageMs, fmtAge,
} from './panels.jsx';
const OlMap = lazy(() => import('./OlMap.jsx'));
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4311';

function Pill({ label, value, state = 'idle' }) {
  return (
    <span className={`pill pill-${state}`}>
      <span className={`dot dot-${state}`} />
      <span className="pill-label">{label}</span>
      <span className="pill-value">{value}</span>
    </span>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="lg-tri" style={{ borderBottomColor: ROBOT_COLORS.writer }} />Writer</span>
      <span><i className="lg-tri" style={{ borderBottomColor: ROBOT_COLORS.executor }} />Executor</span>
      <span><i className="lg-diamond" />Beacon</span>
      <span><i className="lg-circle" />Target (±2σ)</span>
      <span><i className="lg-square" />Event</span>
      <span><i className="lg-dash" />Mission path</span>
    </div>
  );
}

export default function App() {
  const [targets, setTargets] = useState({});
  const [robots, setRobots] = useState({});
  const [trails, setTrails] = useState({ writer: [], executor: [] });
  const [beacons, setBeacons] = useState({});
  const [events, setEvents] = useState([]);
  const [mission, setMission] = useState(null);
  const [acks, setAcks] = useState([]);
  const [ona, setOna] = useState(null);
  const [pending, setPending] = useState({});
  const [conn, setConn] = useState({ ws: 'connecting', lastMsgAt: null });
  const [now, setNow] = useState(Date.now());
  const [client, setClient] = useState(null);
  const [layers, setLayers] = useState({ trails: true, beacons: true, events: true, targets: true });
  const [selectedBeacon, setSelectedBeacon] = useState(null);
  const [mapMode, setMapMode] = useState('openlayers'); // openlayers | canvas

  useEffect(() => {
    const c = createWSClient({
      url: WS_URL,
      onStatus: (s) => setConn((p) => ({ ...p, ...s })),
      onEnvelope: (m) => {
        if (m.kind === 'target') setTargets((p) => ({ ...p, [m.payload.id]: m.payload }));
        else if (m.kind === 'telemetry') {
          setRobots((p) => ({ ...p, [m.payload.id]: m.payload }));
          setTrails((p) => {
            const arr = [...(p[m.payload.id] || []), m.payload.pos].slice(-300);
            return { ...p, [m.payload.id]: arr };
          });
        } else if (m.kind === 'event') {
          setEvents((p) => [m.payload, ...p.filter((e) => e.id !== m.payload.id)].slice(0, 200));
        } else if (m.kind === 'beacon') setBeacons((p) => ({ ...p, [m.payload.id]: m.payload }));
        else if (m.kind === 'mission') setMission(m.payload);
        else if (m.kind === 'cmd.ack') {
          setAcks((p) => [m.payload, ...p].slice(0, 20));
          if (m.payload?.ackFor) setPending((p) => {
            const n = { ...p }; delete n[m.payload.ackFor]; return n;
          });
        } else if (m.kind === 'ona.status') setOna(m.payload);
      },
    });
    setClient(c);
    return () => c.close();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const sendCmd = (action, extra = {}) => {
    const id = `dash-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setPending((p) => ({ ...p, [id]: { action, at: new Date().toISOString() } }));
    client?.send({
      kind: 'cmd', id, ts: new Date().toISOString(),
      source: 'dashboard', payload: { action, ...extra },
    });
    // expire pending after 10s (no ack -> show timeout)
    setTimeout(() => setPending((p) => (p[id] ? { ...p, [id]: { ...p[id], timeout: true } } : p)), 10000);
  };

  const withStale = useMemo(() => Object.fromEntries(
    Object.entries(targets).map(([id, t]) => {
      const age = targetAge(t, now);
      return [id, { ...t, _ageMs: Math.max(0, age), _stale: classifyStaleness(age) }];
    }),
  ), [targets, now]);
  const critCount = events.filter((e) => e.severity === 'critical').length;
  const lastAge = ageMs(conn.lastMsgAt, now);
  const linkState = conn.ws === 'open' ? 'LIVE' : conn.ws === 'connecting' ? 'STALE' : 'LOST';
  const onaState = !ona ? 'idle' : ona.ona === 'connected' ? 'LIVE' : 'LOST';

  const mapProps = { targets: withStale, robots, trails, beacons, events, mission, layers, selectedBeacon };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◎</span>
          <div>
            <div className="title">The Living Map</div>
            <div className="subtitle">Command Post · TSYP14 IEEE RAS × AESS</div>
          </div>
        </div>
        <div className="pills">
          <Pill label="Link" value={conn.ws} state={linkState} />
          <Pill label="ONA / MQTT" value={ona?.ona ?? '…'} state={onaState} />
          <Pill label="Last msg" value={fmtAge(lastAge)} state={conn.lastMsgAt ? classifyStaleness(lastAge) : 'idle'} />
          <Pill label="Tracked" value={ona?.tracked ?? '—'} />
          <Pill label="Dropped" value={ona?.dropped ?? '—'} state={ona?.dropped ? 'STALE' : 'idle'} />
          {Object.keys(pending).length > 0 && <Pill label="Pending" value={Object.keys(pending).length} state="STALE" />}
          {critCount > 0 && <Pill label="Critical" value={critCount} state="LOST" />}
          <span className="clock">{new Date(now).toLocaleTimeString()}</span>
        </div>
      </header>

      {conn.ws !== 'open' && (
        <div className="banner">LINK LOST — data frozen at {conn.lastMsgAt ? new Date(conn.lastMsgAt).toLocaleTimeString() : '—'} · reconnecting…</div>
      )}

      <SystemChain robots={robots} beacons={beacons} ona={ona} conn={conn} mission={mission} now={now} />

      <main className="layout">
        <div className="col-main">
          <section className="card map-card">
            <div className="toolbar">
              <div className="toggles">
                {Object.keys(layers).map((k) => (
                  <label key={k} className={`toggle ${layers[k] ? 'on' : ''}`}>
                    <input type="checkbox" checked={layers[k]} onChange={() => setLayers((p) => ({ ...p, [k]: !p[k] }))} />{k}
                  </label>
                ))}
              </div>
              <div className="seg">
                <button className={mapMode === 'openlayers' ? 'active' : ''} onClick={() => setMapMode('openlayers')}>GPS map</button>
                <button className={mapMode === 'canvas' ? 'active' : ''} onClick={() => setMapMode('canvas')}>Local frame</button>
              </div>
            </div>
            {mapMode === 'openlayers' ? (
              <Suspense fallback={<div className="map-loading">loading map…</div>}>
                <OlMap {...mapProps} />
              </Suspense>
            ) : (
              <MapCanvas {...mapProps} />
            )}
            <Legend />
          </section>
          <div className="grid-2">
            <TargetsCard targets={withStale} />
            <EventFeed events={events} />
          </div>
        </div>

        <aside className="col-side">
          <RobotCard id="writer" name="Writer" role="Explores the GPS-denied zone and drops beacons" robot={robots.writer} now={now} />
          <RobotCard id="executor" name="Executor" role="Receives the mission and navigates with inherited beacons" robot={robots.executor} now={now} />
          <MissionCard mission={mission} beacons={beacons} onCommand={sendCmd} />
          <BeaconPanel
            beacons={beacons}
            selected={selectedBeacon}
            onSelect={setSelectedBeacon}
            onAssign={() => selectedBeacon && sendCmd('assign-mission', { beaconId: selectedBeacon, targetRobot: 'executor', objective: `Inspect ${selectedBeacon}` })}
          />
          <CommandLog pending={pending} acks={acks} onRequestStatus={() => sendCmd('request-status')} />
        </aside>
      </main>
    </div>
  );
}
