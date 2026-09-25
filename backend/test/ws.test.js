// Automated WS lifecycle test on an ephemeral port (no MQTT, no fixed ports).
// Covers: connect->status, sync replay, cmd ack+forward, invalid dropped, disconnect->reconnect.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import { createGateway } from '../src/gateway.js';

const now = () => new Date().toISOString();
let wss;
let gateway;
let port;
const forwarded = [];
const clients = [];

function track(ws) { clients.push(ws); return ws; }

function nextMsg(ws, timeoutMs = 2000) {
  ws._q = ws._q || [];
  if (ws._q.length) return Promise.resolve(JSON.parse(ws._q.shift().toString()));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws timeout')), timeoutMs);
    ws.once('message', (d) => { clearTimeout(t); ws._q.shift(); resolve(JSON.parse(d.toString())); });
  });
}

function openClient() {
  return new Promise((resolve, reject) => {
    const ws = track(new WebSocket(`ws://127.0.0.1:${port}`));
    ws._q = [];
    ws.on('message', (d) => ws._q.push(d.toString()));
    const t = setTimeout(() => reject(new Error('connect timeout')), 3000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function closeClient(ws) {
  return new Promise((r) => {
    try {
      ws.on('close', () => r());
      ws.close();
      setTimeout(r, 500); // don't hang forever
    } catch { r(); }
  });
}

before(async () => {
  gateway = createGateway({ snapshotCap: 50 });
  gateway.ingest('targets/seed', JSON.stringify({ id: 'seed', pos: { x: 1, y: 1 }, ts: now() }));
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  port = wss.address().port;
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ kind: 'ona.status', id: 's0', ts: now(), source: 'ona', payload: { ona: 'connected' } }));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const { replies, forwardToMqtt } = gateway.handleMessage(msg);
      if (forwardToMqtt) forwarded.push(forwardToMqtt);
      for (const r of replies) ws.send(JSON.stringify(r));
    });
  });
});

after(async () => {
  for (const c of clients) { try { c.terminate(); } catch {} }
  for (const c of wss.clients) { try { c.terminate(); } catch {} }
  await new Promise((r) => wss.close(r));
});

test('connect receives ona.status, sync replays snapshot', async () => {
  const ws = await openClient();
  const status = await nextMsg(ws);
  assert.equal(status.kind, 'ona.status');
  ws.send(JSON.stringify({ kind: 'cmd', id: 'c-sync', ts: now(), source: 'dashboard', payload: { action: 'sync' } }));
  const snap = await nextMsg(ws);
  assert.equal(snap.kind, 'target');
  assert.equal(snap.payload.id, 'seed');
  const ack = await nextMsg(ws);
  assert.equal(ack.kind, 'cmd.ack');
  assert.equal(ack.payload.status, 'synced');
  await closeClient(ws);
});

test('cmd acked + forwarded, invalid gets no reply', async () => {
  const ws = await openClient();
  await nextMsg(ws); // status
  ws.send(JSON.stringify({ kind: 'cmd', id: 'c-cmd', ts: now(), source: 'dashboard', payload: { action: 'assign-mission', beaconId: 'B-1' } }));
  const ack = await nextMsg(ws);
  assert.equal(ack.payload.status, 'received');
  assert.ok(forwarded.some((m) => m.id === 'c-cmd'));
  ws.send(JSON.stringify({ kind: 'cmd', id: 'c-bad', ts: now(), source: 'dashboard', payload: { action: 'nuke' } }));
  let arrived = false;
  try {
    await nextMsg(ws, 400);
    arrived = true;
  } catch { arrived = false; }
  assert.equal(arrived, false);
  await closeClient(ws);
});

test('disconnect + reconnect replays same snapshot idempotently', async () => {
  gateway.ingest('beacons/B-9', JSON.stringify({ id: 'B-9', pos: { x: 2, y: 2 }, ts: now() }));
  const payloadIds = [];
  const ackIds = new Set();
  for (let i = 0; i < 2; i++) {
    const ws = await openClient();
    await nextMsg(ws); // status
    ws.send(JSON.stringify({ kind: 'cmd', id: `c-re${i}`, ts: now(), source: 'dashboard', payload: { action: 'sync' } }));
    const got = [];
    for (let k = 0; k < 3; k++) got.push(await nextMsg(ws)); // 2 snapshot + 1 ack
    await closeClient(ws);
    payloadIds.push(got.filter((m) => m.kind !== 'cmd.ack').map((m) => m.payload.id).sort());
    for (const m of got) if (m.kind === 'cmd.ack') ackIds.add(m.id);
  }
  for (const ids of payloadIds) {
    assert.ok(ids.includes('seed'));
    assert.ok(ids.includes('B-9'));
  }
  assert.equal(ackIds.size, 2);
});
