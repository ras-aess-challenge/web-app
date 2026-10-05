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

test('integrated gateways forward reset and reject zone editing', () => {
  const gw = createGateway();
  gw.ingest('beacons/B1', { id: 'B1', pos: { x: 0, y: 0 }, ts: now });
  const command = { kind: 'cmd', id: 'reset', ts: now, payload: { action: 'reset-map' } };
  assert.ok(gw.handleMessage(command).forwardToMqtt);
  const polygon = [[0, 0], [5, 0], [5, 5]];
  assert.equal(gw.handleMessage({ ...command, payload: { action: 'set-zone', polygon } }).replies[0].payload.status, 'rejected');
  assert.equal(gw.snapshot[0].payload.id, 'B1', 'command receipt alone does not clear state');
  assert.ok(gw.ingest('system/map-reset', { id: 'simulation', ts: now, polygon }));
  assert.equal(gw.snapshot[0].kind, 'map.reset');
});

test('simulation reset clears snapshots only after ROS confirmation and sync carries the new zone', () => {
  const gw = createGateway({ simulationCommands: true });
  gw.ingest('beacons/B1', { id: 'B1', pos: { x: 0, y: 0 }, ts: now });
  const command = { kind: 'cmd', id: 'reset', ts: now, payload: { action: 'reset-map' } };
  assert.ok(gw.handleMessage(command).forwardToMqtt);
  assert.equal(gw.snapshot.length, 1, 'sending a command alone never clears data');
  assert.ok(gw.ingest('system/map-reset', { id: 'simulation', ts: now, polygon: [[0, 0], [5, 0], [5, 5]] }));
  const sync = gw.handleMessage({ ...command, payload: { action: 'sync' } });
  assert.equal(sync.replies[0].kind, 'map.reset');
  assert.equal(sync.replies.length, 2);
});

test('set-zone rejects malformed, oversized, nonfinite and zero-area polygons', () => {
  const gw = createGateway({ simulationCommands: true });
  for (const polygon of [null, [], [[0, 0], [1, 0], [2, 0]], [[0, 0], [Infinity, 0], [0, 9]], [[0, 0], [6000, 0], [0, 9]]]) {
    const result = gw.handleMessage({ kind: 'cmd', id: 'zone', ts: now, payload: { action: 'set-zone', polygon } });
    assert.equal(result.forwardToMqtt, null);
  }
});

test('edited simulation zone survives snapshot eviction', () => {
  const gw = createGateway({ simulationCommands: true, snapshotCap: 1 });
  gw.ingest('system/map-reset', { id: 'simulation', ts: now, polygon: [[0, 0], [5, 0], [5, 5]] });
  for (const id of ['A', 'B']) gw.ingest(`targets/${id}`, { id, pos: { x: 0, y: 0 }, ts: now });
  assert.deepEqual(gw.snapshot.map(m => m.kind), ['map.reset', 'target']);
  assert.equal(gw.snapshot[1].payload.id, 'B');
});

test('reset cutoff blocks historical retained records and permits fresh detections', () => {
  const gw = createGateway();
  const cutoff = '2026-10-05T20:00:00.000Z';
  gw.ingest('system/map-reset', { id: 'simulation', ts: cutoff, polygon: [[0, 0], [5, 0], [5, 5]] });
  for (const domain of ['beacons', 'targets']) {
    assert.equal(gw.ingest(`${domain}/old`, { id: 'old', pos: { x: 0, y: 0 }, ts: '2026-10-05T19:59:59.000Z' }), null);
    assert.ok(gw.ingest(`${domain}/fresh`, { id: 'fresh', pos: { x: 1, y: 1 }, ts: '2026-10-05T20:00:01.000Z' }));
  }
  assert.equal(gw.ingest('system/map-reset', { id: 'simulation', ts: '2026-10-05T19:00:00.000Z', polygon: [[0, 0], [5, 0], [5, 5]] }), null);
  assert.ok(!gw.snapshot.some(m => m.payload.id === 'old'));
  assert.equal(gw.snapshot[0].payload.ts, cutoff);
});
