// Actual dashboard proxy -> backend -> MQTT -> bridge -> Python executor round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import net from 'node:net';
import { createHmac } from 'node:crypto';

function sendBeacon(timestamp, x) {
  const payload = Buffer.alloc(16);
  payload.writeUInt32BE(timestamp, 0);
  payload.writeIntBE(Math.round(x * 100), 4, 3);
  payload.writeIntBE(0, 7, 3);
  payload.writeUInt16BE(1, 10);
  payload.writeFloatBE(0.9, 12);
  const body = Buffer.concat([Buffer.from([1]), payload]);
  const message = Buffer.concat([body, createHmac('sha256', process.env.SHARED_SECRET).update(body).digest()]);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: 'strong-node', port: 65432 });
    const chunks = [];
    socket.setTimeout(5000, () => socket.destroy(new Error('Beacon timeout')));
    socket.on('connect', () => socket.write(message));
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
    socket.on('error', reject);
  });
}

async function uniqueBeacon(x) {
  // Wait until a fresh second, avoiding the timestamp-only Python replay key.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal(await sendBeacon(timestamp, x), `RECEIVED WN-${timestamp}`);
  return `WN-${timestamp}`;
}

test('dashboard serves assets and runs/cancels Python missions through its WebSocket proxy', { timeout: 45000 }, async t => {
  if (!process.env.DASHBOARD_URL) { t.skip('Use docker/test.sh for the integrated live stack'); return; }
  const response = await fetch(process.env.DASHBOARD_URL);
  assert.equal(response.status, 200);
  const html = await response.text();
  const asset = html.match(/src="([^"]+\.js)"/);
  assert.ok(asset, 'built dashboard module script');
  assert.equal((await fetch(new URL(asset[1], process.env.DASHBOARD_URL))).status, 200);
  const ws = new WebSocket(process.env.DASHBOARD_URL.replace(/^http/, 'ws') + '/ws');
  const messages = [];
  ws.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  async function waitFor(predicate) {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const match = messages.find(predicate);
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Expected WebSocket message not received');
  }
  const send = (id, payload) => ws.send(JSON.stringify({ kind: 'cmd', id, ts: new Date().toISOString(), source: 'dashboard', payload }));
  await waitFor(m => m.kind === 'ona.status' && m.payload.ona === 'connected');
  send('e2e-sync', { action: 'sync' });
  const beaconId = await uniqueBeacon(10.5);
  const beacon = await waitFor(m => m.kind === 'beacon' && m.payload.id === beaconId);
  assert.equal(beacon.payload.pos.x, 10.5);
  const id = `UI-${Date.now()}`;
  send(id, { action: 'assign-mission', beaconId, objective: 'Integration verification', targetRobot: 'executor' });
  await waitFor(m => m.kind === 'cmd.ack' && m.payload.ackFor === id);
  const done = await waitFor(m => m.kind === 'mission' && m.payload.id === id && m.payload.status === 'done');
  assert.equal(done.payload.target.beaconId, beaconId);
  const state = await (await fetch(process.env.EXECUTOR_URL + '/state')).json();
  assert.equal(state.pos.x, 10.5);
  assert.ok(state.mission.readings.some(reading => reading.node_id === beaconId));

  const farBeacon = await uniqueBeacon(100);
  await waitFor(m => m.kind === 'beacon' && m.payload.id === farBeacon);
  const cancelId = `UI-cancel-${Date.now()}`;
  send(cancelId, { action: 'assign-mission', beaconId: farBeacon });
  await waitFor(m => m.kind === 'mission' && m.payload.id === cancelId && m.payload.status === 'active');
  send(cancelId + '-stop', { action: 'cancel-mission', missionId: cancelId });
  await waitFor(m => m.kind === 'mission' && m.payload.id === cancelId && m.payload.status === 'cancelled');
  const cancelled = await (await fetch(process.env.EXECUTOR_URL + '/state')).json();
  assert.ok(cancelled.pos.x < 100, 'cancellation stops actual Python navigation');
});
