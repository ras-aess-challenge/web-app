import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { toEnvelope } from './normalize.js';
import { validateCommand } from '../../shared/contract.js';

let seq = 0;
const nextSeq = () => ++seq;
const latestById = new Map(); // id -> envelope (for sync snapshot)
let dropped = 0;

const wss = new WebSocketServer({ port: config.wsPort });
console.log(`[backend] WS listening on ws://localhost:${config.wsPort}`);

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

wss.on('connection', (ws) => {
  ws.send(statusEnvelope());
  ws.on('message', (data) => {
    // Dashboard commands -> MQTT (and ack). MQTT publish wired in index via hook.
    try {
      const msg = JSON.parse(data.toString());
      const cmd = validateCommand(msg);
      if (cmd && cmd.action === 'sync') {
        for (const env of latestById.values()) ws.send(JSON.stringify(env));
        ws.send(JSON.stringify({
          kind: 'cmd.ack', id: `msg-${nextSeq()}`, seq: nextSeq(),
          ts: new Date().toISOString(), source: 'ona',
          payload: { ackFor: cmd.id, status: 'synced', count: latestById.size },
        }));
        return;
      }
      if (cmd) {
        onCommandCb?.(msg);
        ws.send(JSON.stringify({
          kind: 'cmd.ack', id: `msg-${nextSeq()}`, seq: nextSeq(),
          ts: new Date().toISOString(), source: 'ona',
          payload: { ackFor: msg.id || null, status: 'received', action: cmd.action },
        }));
        return;
      }
      dropped++;
    } catch { dropped++; }
  });
});

function statusEnvelope(heartbeat = false) {
  return JSON.stringify({
    kind: 'ona.status', id: `msg-${nextSeq()}`, seq: nextSeq(),
    ts: new Date().toISOString(), source: 'ona',
    payload: {
      ona: mqttUp ? 'connected' : 'disconnected', ws: 'open', dropped,
      heartbeat, uptimeS: Math.floor((Date.now() - bootAt) / 1000),
      tracked: latestById.size,
    },
  });
}

let onCommandCb = null;
export function onCommand(cb) { onCommandCb = cb; }

const bootAt = Date.now();
let mqttUp = false;
setInterval(() => { try { broadcast(JSON.parse(statusEnvelope(true))); } catch {} }, config.heartbeatMs);

export function start({ mqttUrl = config.mqttUrl } = {}) {
  const client = mqtt.connect(mqttUrl);
  client.on('connect', () => {
    mqttUp = true;
    console.log(`[backend] MQTT connected ${mqttUrl}`);
    client.subscribe(config.topics);
    broadcast(JSON.parse(statusEnvelope()));
  });
  client.on('close', () => { mqttUp = false; try { broadcast(JSON.parse(statusEnvelope())); } catch {} });
  client.on('offline', () => { mqttUp = false; });
  client.on('message', (topic, buf) => {
    const env = toEnvelope(topic, buf, nextSeq);
    if (!env) { dropped++; return; }
    const pid = env.payload?.id;
    if (pid) latestById.set(`${env.kind}:${pid}`, env);
    if (latestById.size > config.snapshotCap) latestById.delete(latestById.keys().next().value);
    broadcast(env);
  });
  client.on('error', (e) => console.error('[backend] MQTT error', e.message));
  return { client, broadcast, latestById };
}

// Publish dashboard commands back to MQTT: cmd/<action>. Validated; invalid dropped.
export function wireCommands(mqttClient) {
  onCommand((msg) => {
    const cmd = validateCommand(msg);
    if (!cmd) return;
    if (cmd.action === 'sync') return; // local-only, never republish
    mqttClient?.publish(`${config.cmdTopicPrefix}${cmd.action}`, JSON.stringify(msg));
  });
}
