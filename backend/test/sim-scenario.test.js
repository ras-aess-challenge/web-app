import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarioTick, signature, CYCLE_S, BEACON_POS } from '../src/sim-scenario.js';
import { createGateway } from '../src/gateway.js';

const now = new Date().toISOString();
const byTopic = (msgs) => Object.fromEntries(msgs.map((m) => [m.topic, m.payload]));

test('mission cycles pending -> active -> done', () => {
  assert.equal(byTopic(scenarioTick(5, now).msgs)['missions/M-1'].status, 'pending');
  assert.equal(byTopic(scenarioTick(30, now).msgs)['missions/M-1'].status, 'active');
  assert.equal(byTopic(scenarioTick(70, now).msgs)['missions/M-1'].status, 'done');
});

test('beacon roster appears from t>=15 at fixed pos, detection event once per cycle', () => {
  assert.ok(!byTopic(scenarioTick(5, now).msgs)['beacons/B-1']);
  assert.deepEqual(byTopic(scenarioTick(20, now).msgs)['beacons/B-1'].pos, BEACON_POS);
  const e = byTopic(scenarioTick(15.2, now).msgs);
  assert.ok(Object.keys(e).some((t) => t.startsWith('events/evt-c0')));
  assert.ok(!Object.keys(byTopic(scenarioTick(16.2, now).msgs)).some((t) => t.startsWith('events/')));
});

test('executor standby -> en-route -> returning, wraps without teleport', () => {
  const m = (t) => byTopic(scenarioTick(t, now).msgs)['robots/executor'];
  assert.equal(m(5).pos.x, -4);
  assert.equal(m(5).state, 'standby');
  assert.equal(m(30).state, 'en-route');
  assert.ok(m(30).pos.x > -4 && m(30).pos.x < 2.5);
  assert.equal(m(70).state, 'returning');
  const end = m(CYCLE_S - 0.5).pos.x;
  const start = m(0.5).pos.x;
  assert.ok(Math.abs(end - start) < 1.5, `wrap jump ${end} -> ${start}`);
});

test('writer moves continuously across cycle wrap', () => {
  const w = (t) => byTopic(scenarioTick(t, now).msgs)['robots/writer'].pos;
  const a = w(CYCLE_S - 0.5), b = w(CYCLE_S + 0.5);
  assert.ok(Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 2, `jump ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
});

test('every msg validates through the real gateway ingest', () => {
  const gw = createGateway();
  for (const t of [0, 5, 15.2, 30, 55, 70, 89]) {
    for (const { topic, payload } of scenarioTick(t, now).msgs) {
      assert.ok(gw.ingest(topic, JSON.stringify(payload)), `rejected ${topic} at t=${t}`);
    }
  }
});

test('signature ignores ts (heartbeat only on real change)', () => {
  const a = byTopic(scenarioTick(30, now).msgs)['missions/M-1'];
  const b = byTopic(scenarioTick(31, '2026-09-27T00:00:00.000Z').msgs)['missions/M-1'];
  assert.equal(signature(a), signature(b));
});
