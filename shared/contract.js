// Shared contract — single source of truth (plain JS).
// Imported by backend/ and dashboard/ (copied, no workspace dependency).

export const WS_KINDS = Object.freeze([
  'target',
  'telemetry',
  'event',
  'beacon',
  'mission',
  'ona.status',
  'cmd',
  'cmd.ack',
]);

export const TARGET_SOURCES = Object.freeze(['writer', 'executor', 'ona']);
export const EVENT_TYPES = Object.freeze(['hazard', 'victim', 'obstacle', 'system']);
export const SEVERITIES = Object.freeze(['info', 'warn', 'critical']);

// Telemetry payload: { id/robotId, pos:{x,y}, theta?, batteryPct?, state?, ts }
// Event payload: { id/eventId, type, pos, severity, source, ts, note? }
// Beacon payload: { id/beaconId, pos, payload/info?, source, ts, status? }
// Mission payload: { id/missionId, targetRobot, objective, target:{beaconId?,pos?}?, status, updatedAt/ts }

export function normalizeTelemetry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || raw.robotId;
  const pos = raw.pos;
  const ts = raw.ts || raw.updatedAt;
  if (typeof id !== 'string' || !pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null;
  return {
    id,
    pos: { x: pos.x, y: pos.y },
    theta: typeof raw.theta === 'number' ? raw.theta : 0,
    batteryPct: typeof raw.batteryPct === 'number' ? Math.min(100, Math.max(0, raw.batteryPct)) : null,
    state: typeof raw.state === 'string' ? raw.state : 'unknown',
    source: typeof raw.source === 'string' ? raw.source : id,
    ts,
  };
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || raw.eventId;
  const ts = raw.ts;
  if (typeof id !== 'string') return null;
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null;
  if (!EVENT_TYPES.includes(raw.type)) return null;
  if (!raw.pos || typeof raw.pos.x !== 'number' || typeof raw.pos.y !== 'number') return null;
  return {
    id,
    type: raw.type,
    pos: { x: raw.pos.x, y: raw.pos.y },
    severity: SEVERITIES.includes(raw.severity) ? raw.severity : 'info',
    source: typeof raw.source === 'string' ? raw.source : 'writer',
    ts,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 280) : '',
  };
}

export function normalizeBeacon(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || raw.beaconId;
  const ts = raw.ts;
  if (typeof id !== 'string') return null;
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null;
  if (!raw.pos || typeof raw.pos.x !== 'number' || typeof raw.pos.y !== 'number') return null;
  return {
    id,
    pos: { x: raw.pos.x, y: raw.pos.y },
    info: typeof raw.info === 'string' ? raw.info : typeof raw.payload === 'string' ? raw.payload : '',
    source: typeof raw.source === 'string' ? raw.source : 'writer',
    ts,
    status: raw.status === 'expired' ? 'expired' : 'active',
  };
}

export const MISSION_STATUS = Object.freeze(['pending', 'active', 'done', 'cancelled', 'failed']);

export function normalizeMission(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || raw.missionId;
  const ts = raw.updatedAt || raw.ts;
  if (typeof id !== 'string') return null;
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null;
  const target = raw.target || {};
  return {
    id,
    targetRobot: target.targetRobot || raw.targetRobot || 'executor',
    objective: typeof raw.objective === 'string' ? raw.objective.slice(0, 280) : '',
    target: {
      beaconId: typeof target.beaconId === 'string' ? target.beaconId : null,
      pos: target.pos && typeof target.pos.x === 'number' ? { x: target.pos.x, y: target.pos.y } : null,
    },
    status: MISSION_STATUS.includes(raw.status) ? raw.status : 'pending',
    updatedAt: ts,
    ts,
  };
}

export function isEnvelope(m) {
  return (
    m !== null &&
    typeof m === 'object' &&
    WS_KINDS.includes(m.kind) &&
    typeof m.id === 'string' &&
    typeof m.ts === 'string' &&
    typeof m.source === 'string' &&
    'payload' in m
  );
}

export function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, pos, ts, confidence, source } = raw;
  if (typeof id !== 'string' || !pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null;
  const conf = typeof confidence === 'number' ? Math.min(1, Math.max(0, confidence)) : 0;
  const u = raw.uncertainty || {};
  return {
    id,
    pos: { x: pos.x, y: pos.y },
    theta: typeof raw.theta === 'number' ? raw.theta : 0,
    ts,
    confidence: conf,
    source: TARGET_SOURCES.includes(source) ? source : 'writer',
    status: raw.status === 'lost' ? 'lost' : 'tracked',
    uncertainty: {
      sigmaX: typeof u.sigmaX === 'number' && u.sigmaX >= 0 ? u.sigmaX : 1.0,
      sigmaY: typeof u.sigmaY === 'number' && u.sigmaY >= 0 ? u.sigmaY : 1.0,
      angleDeg: typeof u.angleDeg === 'number' ? u.angleDeg : 0,
    },
  };
}
