import { classifyStaleness } from './staleness.js';
import { fmtGps } from './geo.js';

export const ROBOT_COLORS = { writer: '#22b8cf', executor: '#a9e34b' };

/** Age of a payload in ms (clamped >= 0 so small clock skews don't show "-1s"). */
export function ageMs(ts, now) {
  const t = Date.parse(ts ?? '');
  return Number.isNaN(t) ? Infinity : Math.max(0, now - t);
}

export function fmtAge(ms) {
  if (!Number.isFinite(ms)) return 'never';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function Badge({ state, children }) {
  return <span className={`badge badge-${state}`}>{children ?? state}</span>;
}

function Card({ title, right, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-value">{children}</span>
    </div>
  );
}

function BatteryBar({ pct }) {
  if (pct == null) return <span className="muted">n/a</span>;
  const lvl = pct < 25 ? 'LOST' : pct < 50 ? 'STALE' : 'LIVE';
  return (
    <span className="battery">
      <span className="battery-track"><span className={`battery-fill fill-${lvl}`} style={{ width: `${pct}%` }} /></span>
      <span>{pct.toFixed(0)}%</span>
    </span>
  );
}

export function RobotCard({ id, name, role, robot, now }) {
  const color = ROBOT_COLORS[id] ?? '#ced4da';
  if (!robot) {
    return (
      <Card title={<><i className="swatch" style={{ background: color }} />{name}</>} right={<Badge state="LOST">NO DATA</Badge>}>
        <div className="muted">{role} — waiting for telemetry on robots/{id}</div>
      </Card>
    );
  }
  const age = ageMs(robot.ts, now);
  const state = classifyStaleness(age);
  return (
    <Card title={<><i className="swatch" style={{ background: color }} />{name}</>} right={<Badge state={state} />}>
      <div className="muted small">{role}</div>
      <Row label="State"><span className="chip">{robot.state}</span></Row>
      <Row label="Battery"><BatteryBar pct={robot.batteryPct} /></Row>
      <Row label="Local (m)">x {robot.pos.x.toFixed(2)} · y {robot.pos.y.toFixed(2)} · θ {(((robot.theta ?? 0) * 180) / Math.PI).toFixed(0)}°</Row>
      <Row label="GPS">{fmtGps(robot.pos)}</Row>
      <Row label="Last update">{fmtAge(age)}</Row>
    </Card>
  );
}

const MISSION_STEPS = ['pending', 'active', 'done'];

export function MissionCard({ mission, beacons, onCommand }) {
  if (!mission) {
    return (
      <Card title="Mission" right={<Badge state="idle">NONE</Badge>}>
        <div className="muted">No mission yet. Select a beacon and assign it to the Executor.</div>
      </Card>
    );
  }
  const st = mission.status;
  const stepIdx = st === 'done' ? MISSION_STEPS.length : MISSION_STEPS.indexOf(st);
  const failed = st === 'failed' || st === 'cancelled';
  const tgtPos = mission.target?.pos || (mission.target?.beaconId && beacons?.[mission.target.beaconId]?.pos);
  return (
    <Card title={`Mission ${mission.id}`} right={<Badge state={failed ? 'LOST' : st === 'done' ? 'LIVE' : 'STALE'}>{st.toUpperCase()}</Badge>}>
      <div className="mission-objective">{mission.objective || '—'}</div>
      {!failed && (
        <div className="steps">
          {MISSION_STEPS.map((s, i) => (
            <div key={s} className={`step ${i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''}`}>
              <span className="step-dot" />{s}
            </div>
          ))}
        </div>
      )}
      <Row label="Robot">{mission.targetRobot}</Row>
      <Row label="Target">{mission.target?.beaconId ?? '—'}{tgtPos ? ` · ${fmtGps(tgtPos)}` : ''}</Row>
      {st !== 'done' && st !== 'cancelled' && (
        <div className="actions">
          <button className="btn btn-danger" onClick={() => onCommand?.('cancel-mission', { missionId: mission.id })}>Cancel mission</button>
        </div>
      )}
    </Card>
  );
}

export function TargetsCard({ targets }) {
  const list = Object.values(targets);
  return (
    <Card title={`Targets (${list.length})`}>
      {list.length === 0 && <div className="muted">No targets detected yet.</div>}
      {list.length > 0 && (
        <table>
          <thead><tr><th>ID</th><th>GPS</th><th>Conf.</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.id}</strong><div className="muted small">{t.source}</div></td>
                <td className="small">{fmtGps(t.pos)}</td>
                <td>
                  <span className="conf"><span className="conf-fill" style={{ width: `${(t.confidence ?? 0) * 100}%` }} /></span>
                  <span className="small"> {((t.confidence ?? 0) * 100).toFixed(0)}%</span>
                </td>
                <td><Badge state={t._stale} /><div className="muted small">{fmtAge(t._ageMs)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function BeaconPanel({ beacons, selected, onSelect, onAssign }) {
  const list = Object.values(beacons);
  return (
    <Card title={`Beacons (${list.length})`}>
      {list.length === 0 && <div className="muted">None yet — beacons dropped by the Writer appear here.</div>}
      {list.map((b) => (
        <button key={b.id} className={`beacon ${b.id === selected ? 'selected' : ''}`} onClick={() => onSelect?.(b.id === selected ? null : b.id)}>
          <span className="beacon-head">
            <strong>{b.id}</strong>
            <Badge state={b.status === 'active' ? 'LIVE' : 'LOST'}>{b.status}</Badge>
          </span>
          <span className="small">{b.info || 'no message'}</span>
          <span className="muted small">{fmtGps(b.pos)} · by {b.source} at {new Date(b.ts).toLocaleTimeString()}</span>
        </button>
      ))}
      <div className="actions">
        <button className="btn btn-primary" disabled={!selected} onClick={onAssign}>
          {selected ? `Send Executor to ${selected}` : 'Select a beacon to assign a mission'}
        </button>
      </div>
    </Card>
  );
}

export function EventFeed({ events }) {
  return (
    <Card title={`Events (${events.length})`}>
      {events.length === 0 && <div className="muted">No events yet.</div>}
      <div className="feed">
        {events.slice(0, 30).map((e) => (
          <div key={e.id} className={`event sev-${e.severity}`}>
            <span className="event-head"><strong>{e.type}</strong><span className="muted small">{new Date(e.ts).toLocaleTimeString()}</span></span>
            <span className="small">{e.note || e.id}</span>
            <span className="muted small">{e.severity} · {fmtGps(e.pos)} · {e.source}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CommandLog({ pending, acks, onRequestStatus }) {
  const pend = Object.entries(pending);
  return (
    <Card title="Commands" right={<button className="btn" onClick={onRequestStatus}>Request status</button>}>
      {pend.length === 0 && acks.length === 0 && <div className="muted">No commands sent yet.</div>}
      {pend.map(([id, p]) => (
        <div key={id} className="small">{p.action} — {p.timeout ? <Badge state="LOST">NO ACK</Badge> : <Badge state="STALE">PENDING</Badge>}</div>
      ))}
      {acks.slice(0, 5).map((a, i) => (
        <div key={i} className="small muted">ack · {a.action ?? 'sync'} · {a.status}</div>
      ))}
    </Card>
  );
}

/**
 * The challenge's system chain, live:
 * Writer -> Beacons -> Outside Network Area -> Command Post -> Executor
 */
export function SystemChain({ robots, beacons, ona, conn, mission, now }) {
  const wAge = ageMs(robots.writer?.ts, now);
  const eAge = ageMs(robots.executor?.ts, now);
  const nb = Object.keys(beacons).length;
  const nodes = [
    { name: 'Writer', sub: robots.writer ? `${robots.writer.state} · ${fmtAge(wAge)}` : 'no telemetry', state: robots.writer ? classifyStaleness(wAge) : 'LOST' },
    { name: 'Beacons', sub: nb ? `${nb} deposited` : 'none yet', state: nb ? 'LIVE' : 'idle' },
    { name: 'Outside Network', sub: ona ? `MQTT ${ona.ona}` : 'unknown', state: ona?.ona === 'connected' ? 'LIVE' : 'LOST' },
    { name: 'Command Post', sub: `link ${conn.ws}`, state: conn.ws === 'open' ? 'LIVE' : conn.ws === 'connecting' ? 'STALE' : 'LOST' },
    { name: 'Executor', sub: robots.executor ? `${robots.executor.state}${mission ? ` · ${mission.id} ${mission.status}` : ''}` : 'no telemetry', state: robots.executor ? classifyStaleness(eAge) : 'LOST' },
  ];
  return (
    <div className="chain">
      {nodes.map((n, i) => (
        <div key={n.name} className="chain-item">
          <div className={`chain-node node-${n.state}`}>
            <span className={`dot dot-${n.state}`} />
            <div>
              <div className="chain-name">{n.name}</div>
              <div className="chain-sub">{n.sub}</div>
            </div>
          </div>
          {i < nodes.length - 1 && <span className="chain-arrow">→</span>}
        </div>
      ))}
    </div>
  );
}
