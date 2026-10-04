import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertBeacon } from '../src/network-bridge-core.js';
import { createGateway } from '../src/gateway.js';

test('Python beacon preserves source time and coordinates through dashboard contract', () => {
  const { beacon, target } = convertBeacon({ node_id: 'WN-123', x: 10.5, y: -2, timestamp: 123, pod: 0.9, event: 'VICTIM' });
  const gateway = createGateway();
  const b = gateway.ingest('beacons/WN-123', JSON.stringify(beacon));
  const t = gateway.ingest('targets/WN-123', JSON.stringify(target));
  assert.equal(b.payload.id, 'WN-123');
  assert.equal(b.payload.ts, new Date(123000).toISOString());
  assert.deepEqual(b.payload.pos, { x: 10.5, y: -2 });
  assert.equal(t.payload.confidence, 0.9);
});
test('invalid persisted beacon is rejected before MQTT publish', () => {
  for (const value of [null, {}, { node_id: 'bad/topic', x: 1, y: 2, timestamp: 123, pod: 0.9 },
    { node_id: 'valid', x: NaN, y: 2, timestamp: 123, pod: 0.9 }]) assert.throws(() => convertBeacon(value));
});
