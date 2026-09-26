// Pure scenario logic for the dev simulator (no MQTT, no timers).
// Looping 90 s cycle so late joiners and backend restarts always converge:
// writer/executor move every tick; beacon roster + mission state republish.
export const CYCLE_S = 90;
export const BEACON_POS = { x: -0.75, y: 1.0 };

const r2 = (n) => Math.round(n * 100) / 100;

function writerPos(elapsed) {
  return { x: r2(-6 + (elapsed % 25) * 0.56), y: r2(2 * Math.sin(elapsed * 0.4) + (Math.floor(elapsed / 25) % 4)) };
}

function executorX(t) {
  if (t < 25) return -4;
  if (t < 40) return r2(-4 + (t - 25) * (6.5 / 15));
  if (t < 60) return 2.5;
  return r2(2.5 - (t - 60) * (6.5 / 30)); // return leg, wraps smoothly to -4
}

// Returns { cycle, msgs: [{ topic, payload }] } for elapsed seconds since sim start.
export function scenarioTick(elapsed, now = new Date().toISOString()) {
  const cycle = Math.floor(elapsed / CYCLE_S);
  const t = elapsed % CYCLE_S;
  const msgs = [];
  const w = writerPos(elapsed);
  msgs.push({
    topic: 'robots/writer',
    payload: { id: 'writer', pos: w, theta: 0.3, batteryPct: Math.max(20, r2(95 - elapsed * 0.05)), state: 'exploring', source: 'writer', ts: now },
  });
  msgs.push({
    topic: 'targets/T-01',
    payload: { id: 'T-01', pos: { x: w.x, y: r2(w.y + 1) }, theta: 0, ts: now, confidence: 0.75, source: 'writer', status: 'tracked', uncertainty: { sigmaX: 1.2, sigmaY: 0.7, angleDeg: 30 } },
  });
  const active = t >= 25 && t < 60;
  const ex = executorX(t);
  const estate = t < 25 ? 'standby' : t < 40 ? 'en-route' : t < 60 ? 'inspecting' : 'returning';
  msgs.push({
    topic: 'robots/executor',
    payload: { id: 'executor', pos: { x: ex, y: -2 }, theta: active ? 0 : 1.57, batteryPct: 88, state: estate, source: 'executor', ts: now },
  });
  // Detection once per cycle + beacon roster from t>=15
  if (Math.floor(t) === 15) {
    msgs.push({
      topic: `events/evt-c${cycle}`,
      payload: { id: `evt-c${cycle}`, type: 'hazard', pos: { ...BEACON_POS }, severity: 'warn', source: 'writer', ts: now, note: `sim: debris (cycle ${cycle})` },
    });
  }
  if (t >= 15) {
    msgs.push({
      topic: 'beacons/B-1',
      payload: { id: 'B-1', pos: { ...BEACON_POS }, info: 'hazard debris — inherited spatial memory', source: 'writer', ts: now, status: 'active' },
    });
  }
  msgs.push({
    topic: 'missions/M-1',
    payload: {
      id: 'M-1', targetRobot: 'executor', objective: 'Inspect beacon B-1',
      target: { beaconId: 'B-1', pos: { x: 2.5, y: -1 } },
      status: t < 25 ? 'pending' : t < 60 ? 'active' : 'done', updatedAt: now, ts: now,
    },
  });
  return { cycle, t: r2(t), msgs };
}

// Signature ignoring volatile timestamps so the publisher heartbeats only on real change.
export function signature(payload) {
  const { ts, serverRxAt, updatedAt, ...rest } = payload;
  return JSON.stringify(rest);
}
