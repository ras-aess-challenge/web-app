import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../src/gateway.js';

const now = new Date().toISOString();

test('ingest valid envelopes + snapshot keyed kind:id', () => {
  const gw = createGateway({ snapshotCap: 10 });
  const a = gw.ingest('targets/X', JSON.stringify({ id: 'X', pos: { x: 0, y: 0 }, ts: now }));
  const b = gw.ingest('beacons/X', JSON.stringify({ id: 'X', pos: { x: 1, y: 1 }, ts: now }));
  assert.ok(a && b);
  assert.equal(gw.snapshot.length, 2);
  assert.equal(gw.stats.tracked, 2);
});

test('ingest malformed counted as dropped', () => {
  const gw = createGateway();
  assert.equal(gw.ingest('targets/x', 'not-json'), null);
  assert.equal(gw.ingest('events/x', JSON.stringify({ id: 'x', type: 'nope', pos: { x: 0, y: 0 }, ts: now })), null);
  assert.equal(gw.stats.dropped, 2);
});

test('snapshot cap evicts oldest', () => {
  const gw = createGateway({ snapshotCap: 3 });
  for (let i = 0; i < 5; i++) gw.ingest('targets/T', JSON.stringify({ id: `T${i}`, pos: { x: i, y: 0 }, ts: now }));
  assert.equal(gw.snapshot.length, 3);
  assert.ok(!gw.snapshot.some((e) => e.payload.id === 'T0'));
});

test('handleMessage sync replays snapshot, no mqtt forward', () => {
  const gw = createGateway();
  gw.ingest('targets/A', JSON.stringify({ id: 'A', pos: { x: 0, y: 0 }, ts: now }));
  const { replies, forwardToMqtt } = gw.handleMessage({ kind: 'cmd', id: 'c1', ts: now, source: 'dashboard', payload: { action: 'sync' } });
  assert.equal(forwardToMqtt, null);
  assert.equal(replies.length, 2); // 1 snapshot + 1 ack
  assert.equal(replies[replies.length - 1].payload.status, 'synced');
});

test('handleMessage cmd acks + forwards, invalid dropped', () => {
  const gw = createGateway();
  const ok = gw.handleMessage({ kind: 'cmd', id: 'c2', ts: now, source: 'dashboard', payload: { action: 'assign-mission', beaconId: 'B-1' } });
  assert.ok(ok.forwardToMqtt);
  assert.equal(ok.replies[0].payload.status, 'received');
  const bad = gw.handleMessage({ kind: 'cmd', id: 'c3', ts: now, source: 'dashboard', payload: { action: 'nuke' } });
  assert.equal(bad.forwardToMqtt, null);
  assert.equal(bad.replies.length, 0);
});

test('sim-publisher payload shapes stay valid', async () => {
  // Mirrors backend/src/sim-publisher.js message shapes
  const gw = createGateway();
  const t = Date.now() / 1000;
  assert.ok(gw.ingest('robots/writer', JSON.stringify({ id: 'writer', pos: { x: 1, y: 2 }, theta: 0.3, batteryPct: 90, state: 'exploring', source: 'writer', ts: now })));
  assert.ok(gw.ingest('targets/T-01', JSON.stringify({ id: 'T-01', pos: { x: 1, y: 2 }, ts: now, confidence: 0.75 + 0.2 * Math.sin(t), source: 'writer', status: 'tracked', uncertainty: { sigmaX: 1.2, sigmaY: 0.7, angleDeg: 30 } })));
  assert.ok(gw.ingest('missions/M-1', JSON.stringify({ id: 'M-1', targetRobot: 'executor', objective: 'Inspect B-1', target: { beaconId: 'B-1' }, status: 'active', updatedAt: now, ts: now })));
});
