// Actual nginx -> WebSocket -> MQTT -> ROS simulator workflows, including reconnect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

test('automatic dispatch, reset, zone editing and late-client sync', { timeout: 120000 }, async t => {
  const sockets = [];
  t.after(() => sockets.forEach(socket => socket.terminate()));
  async function connect() {
    const socket = new WebSocket(process.env.DASHBOARD_URL.replace(/^http/, 'ws') + '/ws');
    sockets.push(socket);
    const messages = [];
    socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return { socket, messages };
  }
  async function waitFor(client, predicate, seconds = 30) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const result = client.messages.find(predicate);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Expected simulation update not received');
  }
  const send = (client, id, payload) => client.socket.send(JSON.stringify({ kind: 'cmd', id, ts: new Date().toISOString(), source: 'dashboard', payload }));
  const a = await connect();
  const b = await connect();
  await waitFor(a, m => m.kind === 'ona.status' && m.payload.simulationCommands);
  send(a, 'sync-start', { action: 'sync' });
  const beacon = await waitFor(a, m => m.kind === 'beacon');
  const mission = await waitFor(a, m => m.kind === 'mission' && m.payload.target.beaconId === beacon.payload.id);
  await waitFor(a, m => m.kind === 'mission' && m.payload.id === mission.payload.id && m.payload.status === 'done', 65);
  a.messages.length = 0; b.messages.length = 0;
  send(a, 'reset', { action: 'reset-map' });
  await waitFor(a, m => m.kind === 'map.reset');
  await waitFor(b, m => m.kind === 'map.reset');
  const polygon = [[-4, -3], [4, -3], [4, 3], [-4, 3]];
  send(a, 'zone', { action: 'set-zone', polygon });
  await waitFor(a, m => m.kind === 'map.reset' && JSON.stringify(m.payload.polygon) === JSON.stringify(polygon));
  await waitFor(b, m => m.kind === 'map.reset' && JSON.stringify(m.payload.polygon) === JSON.stringify(polygon));
  const late = await connect();
  send(late, 'late-sync', { action: 'sync' });
  await waitFor(late, m => m.kind === 'cmd.ack' && m.payload.ackFor === 'late-sync');
  assert.deepEqual(late.messages.find(m => m.kind === 'map.reset').payload.polygon, polygon);
  const offset = a.messages.length;
  await waitFor(a, m => a.messages.indexOf(m) >= offset && m.kind === 'telemetry' && m.payload.id === 'writer');
  const writer = a.messages.slice(offset).filter(m => m.kind === 'telemetry' && m.payload.id === 'writer').at(-1).payload;
  assert.ok(Math.abs(writer.pos.x) <= 4 && Math.abs(writer.pos.y) <= 3, 'writer adopts the edited zone');
  console.log('Automatic mission completed; reset reached both clients; edited zone survived late-client sync');
});
