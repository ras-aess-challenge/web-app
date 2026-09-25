import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { toEnvelope } from './normalize.js';

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
  ws.send(JSON.stringify({
    kind: 'ona.status', id: `msg-${nextSeq()}`, seq: nextSeq(),
    ts: new Date().toISOString(), source: 'ona',
    payload: { ona: 'connected', ws: 'open', dropped },
  }));
  ws.on('message', (data) => {
    // Dashboard commands -> MQTT (and ack). MQTT publish wired in index via hook.
    try {
      const msg = JSON.parse(data.toString());
      if (msg && msg.kind === 'cmd') {
        onCommandCb?.(msg);
        ws.send(JSON.stringify({
          kind: 'cmd.ack', id: `msg-${nextSeq()}`, seq: nextSeq(),
          ts: new Date().toISOString(), source: 'ona',
          payload: { ackFor: msg.id || null, status: 'received' },
        }));
      } else if (msg && msg.kind === 'cmd' && msg.payload?.action === 'sync') {
        for (const env of latestById.values()) ws.send(JSON.stringify(env));
      } else if (msg?.payload?.action === 'sync' || msg?.action === 'sync') {
        for (const env of latestById.values()) ws.send(JSON.stringify(env));
      }
    } catch { dropped++; }
  });
});

let onCommandCb = null;
export function onCommand(cb) { onCommandCb = cb; }

export function start({ mqttUrl = config.mqttUrl } = {}) {
  const client = mqtt.connect(mqttUrl);
  client.on('connect', () => {
    console.log(`[backend] MQTT connected ${mqttUrl}`);
    client.subscribe(config.topics);
    broadcast({
      kind: 'ona.status', id: `msg-${nextSeq()}`, seq: nextSeq(),
      ts: new Date().toISOString(), source: 'ona',
      payload: { ona: 'connected', ws: 'open', dropped },
    });
  });
  client.on('message', (topic, buf) => {
    const env = toEnvelope(topic, buf, nextSeq);
    if (!env) { dropped++; return; }
    const pid = env.payload?.id;
    if (pid) latestById.set(`${env.kind}:${pid}`, env);
    if (latestById.size > 500) latestById.delete(latestById.keys().next().value);
    broadcast(env);
  });
  client.on('error', (e) => console.error('[backend] MQTT error', e.message));
  return { client, broadcast, latestById };
}

// Publish dashboard commands back to MQTT: cmd/<action>
export function wireCommands(mqttClient) {
  onCommand((msg) => {
    const action = msg.payload?.action || 'unknown';
    mqttClient?.publish(`${config.cmdTopicPrefix}${action}`, JSON.stringify(msg));
  });
}
