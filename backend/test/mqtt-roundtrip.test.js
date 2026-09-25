// Live MQTT round-trip (loopback through a real broker).
// Skips cleanly when no broker at MQTT_URL (dev machines without mosquitto).
// Proves: sim-shaped payloads survive MQTT publish -> subscribe -> gateway ingest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import { createGateway } from '../src/gateway.js';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';

function tryConnect(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const c = mqtt.connect(url, { connectTimeout: timeoutMs, reconnectPeriod: 0 });
    const t = setTimeout(() => { try { c.end(true); } catch {} resolve(null); }, timeoutMs);
    c.on('connect', () => { clearTimeout(t); resolve(c); });
    c.on('error', () => { clearTimeout(t); try { c.end(true); } catch {} resolve(null); });
  });
}

test('mqtt loopback -> gateway ingest', async (t) => {
  const c = await tryConnect(MQTT_URL);
  if (!c) { t.skip(`no broker at ${MQTT_URL}`); return; }
  const gw = createGateway();
  const topic = `targets/E2E-${Date.now()}`;
  const payload = { id: 'T-E2E', pos: { x: 3.5, y: -1.2 }, ts: new Date().toISOString(), confidence: 0.81, source: 'writer', status: 'tracked', uncertainty: { sigmaX: 1, sigmaY: 0.5, angleDeg: 10 } };
  await new Promise((res, rej) => c.subscribe(topic, (e) => (e ? rej(e) : res())));
  const received = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('mqtt recv timeout')), 4000);
    c.on('message', (tp, buf) => { if (tp === topic) { clearTimeout(timer); res(buf.toString()); } });
  });
  c.publish(topic, JSON.stringify(payload));
  const raw = await received;
  const env = gw.ingest(topic, raw);
  assert.ok(env);
  assert.equal(env.kind, 'target');
  assert.equal(env.payload.id, 'T-E2E');
  assert.equal(env.payload.confidence, 0.81);
  await new Promise((r) => c.end(false, r));
});
