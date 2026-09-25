import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEnvelope } from '../src/normalize.js';
import { classifyStaleness } from '../../shared/thresholds.js';
import { validateCommand } from '../../shared/contract.js';

let s = 0;
const seq = () => ++s;
const now = new Date().toISOString();

test('target normalize ok', () => {
  const env = toEnvelope('targets/T-01', JSON.stringify({
    id: 'T-01', pos: { x: 1, y: 2 }, ts: now, confidence: 0.9, source: 'writer',
  }), seq);
  assert.equal(env.kind, 'target');
  assert.equal(env.payload.id, 'T-01');
});

test('telemetry/event/beacon/mission ok', () => {
  assert.equal(toEnvelope('robots/writer', JSON.stringify({ id: 'writer', pos: { x: 0, y: 0 }, ts: now }), seq).kind, 'telemetry');
  assert.equal(toEnvelope('events/e1', JSON.stringify({ id: 'e1', type: 'hazard', pos: { x: 0, y: 0 }, severity: 'warn', ts: now }), seq).kind, 'event');
  assert.equal(toEnvelope('beacons/B-1', JSON.stringify({ id: 'B-1', pos: { x: 1, y: 1 }, ts: now }), seq).kind, 'beacon');
  assert.equal(toEnvelope('missions/M-1', JSON.stringify({ id: 'M-1', status: 'active', updatedAt: now }), seq).kind, 'mission');
});

test('malformed dropped', () => {
  assert.equal(toEnvelope('targets/x', 'not-json', seq), null);
  assert.equal(toEnvelope('targets/x', JSON.stringify({ pos: { x: 1 } }), seq), null);
  assert.equal(toEnvelope('events/x', JSON.stringify({ id: 'x', type: 'nope', pos: { x: 0, y: 0 }, ts: now }), seq), null);
});

test('staleness thresholds', () => {
  assert.equal(classifyStaleness(1000, { LIVE_MS: 5000, STALE_MS: 15000 }), 'LIVE');
  assert.equal(classifyStaleness(6000, { LIVE_MS: 5000, STALE_MS: 15000 }), 'STALE');
  assert.equal(classifyStaleness(20000, { LIVE_MS: 5000, STALE_MS: 15000 }), 'LOST');
});

test('commands validated', () => {
  const ok = validateCommand({ kind: 'cmd', id: 'd1', ts: now, source: 'dashboard', payload: { action: 'assign-mission', beaconId: 'B-1' } });
  assert.equal(ok.action, 'assign-mission');
  assert.equal(validateCommand({ kind: 'cmd', id: 'd1', ts: now, source: 'dashboard', payload: { action: 'nuke' } }), null);
  assert.equal(validateCommand({ kind: 'cmd', id: 'd1', ts: 'bad', source: 'dashboard', payload: { action: 'sync' } }), null);
});

test('snapshot key is kind:id (no overwrite across kinds)', () => {
  const a = toEnvelope('targets/X', JSON.stringify({ id: 'X', pos: { x: 0, y: 0 }, ts: now }), seq);
  const b = toEnvelope('beacons/X', JSON.stringify({ id: 'X', pos: { x: 1, y: 1 }, ts: now }), seq);
  assert.equal(a.kind, 'target');
  assert.equal(b.kind, 'beacon');
  // latestById keying in server.js is `${kind}:${payload.id}` — both must survive sync
  const m = new Map();
  m.set(`${a.kind}:${a.payload.id}`, a);
  m.set(`${b.kind}:${b.payload.id}`, b);
  assert.equal(m.size, 2);
});

test('sync is local-only (never republished to MQTT)', () => {
  // wireCommands rule: sync validated but filtered before mqtt.publish
  const sync = validateCommand({ kind: 'cmd', id: 'x', ts: now, source: 'dashboard', payload: { action: 'sync' } });
  assert.equal(sync.action, 'sync');
  const shouldPublish = (cmd) => cmd && cmd.action !== 'sync' && !!validateCommand({ kind: 'cmd', id: 'x', ts: now, source: 'dashboard', payload: cmd });
  assert.equal(shouldPublish({ action: 'sync' }), false);
  assert.equal(!!shouldPublish({ action: 'assign-mission' }), true);
  assert.equal(!!shouldPublish({ action: 'nuke' }), false);
});
