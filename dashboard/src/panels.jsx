export function RobotPanel({ name, robot, now }) {
  if (!robot) return <div className="panel"><h3>{name}</h3><div>no data</div></div>;
  const ageS = ((now - Date.parse(robot.ts)) / 1000).toFixed(0);
  const stale = ageS > 15 ? 'LOST' : ageS > 5 ? 'STALE' : 'LIVE';
  return (
    <div className="panel">
      <h3>{name} <span className={`stale-${stale}`}>{stale}</span></h3>
      <div>pos {robot.pos.x.toFixed(1)},{robot.pos.y.toFixed(1)} θ{(robot.theta ?? 0).toFixed(2)}</div>
      <div>state {robot.state} {robot.batteryPct != null ? `batt ${robot.batteryPct.toFixed(0)}%` : ''}</div>
      <div>age {ageS}s</div>
    </div>
  );
}

export function MissionPanel({ mission, onCommand }) {
  if (!mission) return <div className="panel"><h3>Mission</h3><div>none</div></div>;
  return (
    <div className="panel">
      <h3>Mission {mission.id} — {mission.status}</h3>
      <div>{mission.objective}</div>
      <div>target {mission.target?.beaconId ?? `${mission.target?.pos?.x ?? '?'},${mission.target?.pos?.y ?? '?'}`}</div>
      <div>
        <button onClick={() => onCommand?.('cancel-mission', { missionId: mission.id })}>Cancel</button>
      </div>
    </div>
  );
}

export function BeaconPanel({ beacons, selected, onSelect }) {
  const list = Object.values(beacons);
  const sel = selected ? beacons[selected] : null;
  return (
    <div className="panel">
      <h3>Beacons ({list.length})</h3>
      {list.length === 0 && <div>none yet — writer beacons appear here</div>}
      {list.map((b) => (
        <div key={b.id}>
          <button onClick={() => onSelect?.(b.id)}>{b.id}</button> {b.pos.x.toFixed(1)},{b.pos.y.toFixed(1)} {b.status}
        </div>
      ))}
      {sel && <div><strong>{sel.id}</strong>: {sel.info} <em>({sel.source} {new Date(sel.ts).toLocaleTimeString()})</em></div>}
    </div>
  );
}

export function EventFeed({ events }) {
  return (
    <div className="panel">
      <h3>Events ({events.length})</h3>
      {events.length === 0 && <div>no events yet</div>}
      {events.slice(0, 30).map((e) => (
        <div key={e.id}>[{e.severity}] {e.type} {e.id} @ {e.pos.x.toFixed(1)},{e.pos.y.toFixed(1)} <em>{e.note}</em></div>
      ))}
    </div>
  );
}
