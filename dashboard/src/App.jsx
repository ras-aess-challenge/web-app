import { useEffect, useState } from 'react';
import { createWSClient } from './wsClient.js';
import { targetAge, classifyStaleness } from './staleness.js';
import MapCanvas from './MapCanvas.jsx';
import { RobotPanel, MissionPanel, BeaconPanel, EventFeed } from './panels.jsx';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4311';

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
        } else if (m.kind === 'event') setEvents((p) => [m.payload, ...p].slice(0, 200));
        else if (m.kind === 'beacon') setBeacons((p) => ({ ...p, [m.payload.id]: m.payload }));
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

  const withStale = Object.fromEntries(
    Object.entries(targets).map(([id, t]) => {
      const age = targetAge(t, now);
      return [id, { ...t, _ageMs: age, _stale: classifyStaleness(age) }];
    }),
  );
  const critCount = events.filter((e) => e.severity === 'critical').length;

  return (
    <>
      <header>
        <strong>Living Map — Command Post</strong>
        <span className={`dot ${conn.ws === 'open' ? 'ok' : 'bad'}`} />
        <span>WS:{conn.ws}</span>
        <span>last:{conn.lastMsgAt ?? '—'}</span>
        <span>{new Date(now).toLocaleTimeString()}</span>
        {ona && <span>ONA:{ona.ona}</span>}
        {Object.keys(pending).length > 0 && <span className="stale-STALE">PENDING:{Object.keys(pending).length}</span>}
        {critCount > 0 && <span className="stale-LOST">CRIT:{critCount}</span>}
      </header>
      <main>
        <div>
          {conn.ws !== 'open' && <div className="panel">LINK LOST — data frozen at {conn.lastMsgAt ?? '—'}</div>}
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            {Object.keys(layers).map((k) => (
              <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => setLayers((p) => ({ ...p, [k]: !p[k] }))} />{k}</label>
            ))}
          </div>
          <MapCanvas targets={withStale} robots={robots} trails={trails} beacons={beacons} events={events} mission={mission} layers={layers} selectedBeacon={selectedBeacon} />
        </div>
        <div>
          <RobotPanel name="Writer" robot={robots.writer} now={now} />
          <RobotPanel name="Executor" robot={robots.executor} now={now} />
          <MissionPanel mission={mission} onCommand={sendCmd} />
          <div className="panel">
            <h3>Targets</h3>
            {Object.keys(withStale).length === 0 && <div>no targets yet</div>}
            <table><tbody>
              {Object.values(withStale).map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.pos.x.toFixed(1)},{t.pos.y.toFixed(1)}</td>
                  <td>{t.confidence.toFixed(2)}</td>
                  <td className={`stale-${t._stale}`}>{t._stale} {(t._ageMs / 1000).toFixed(0)}s</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <BeaconPanel beacons={beacons} selected={selectedBeacon} onSelect={setSelectedBeacon} />
          <EventFeed events={events} />
          <div className="panel">
            <button onClick={() => sendCmd('request-status')}>Request status</button>{' '}
            <button onClick={() => selectedBeacon && sendCmd('assign-mission', { beaconId: selectedBeacon, targetRobot: 'executor', objective: `Inspect ${selectedBeacon}` })} disabled={!selectedBeacon}>
              Assign mission to selected beacon
            </button>
            {Object.entries(pending).map(([id, p]) => (
              <div key={id}>…{p.action} {p.timeout ? <span className="stale-LOST">NO ACK</span> : 'sent'}</div>
            ))}
            {acks.slice(0, 5).map((a, i) => (
              <div key={i}>ack {a.action ?? ''} {a.status} for {a.ackFor}</div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
