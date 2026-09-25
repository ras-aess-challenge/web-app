import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { createGateway } from './gateway.js';

const gateway = createGateway({ snapshotCap: config.snapshotCap });
const bootAt = Date.now();
let mqttUp = false;
let droppedExtra = 0; // malformed WS frames counted here (gateway counts semantic drops)

const wss = new WebSocketServer({ port: config.wsPort });
console.log(`[backend] WS listening on ws://localhost:${config.wsPort}`);

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

function statusEnvelope(heartbeat = false) {
  return JSON.stringify({
    kind: 'ona.status', id: `gw-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, seq: 0,
    ts: new Date().toISOString(), source: 'ona',
    payload: {
      ona: mqttUp ? 'connected' : 'disconnected', ws: 'open',
      dropped: gateway.stats.dropped + droppedExtra,
      heartbeat, uptimeS: Math.floor((Date.now() - bootAt) / 1000),
      tracked: gateway.stats.tracked,
    },
  });
}

wss.on('connection', (ws) => {
  ws.send(statusEnvelope());
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch { droppedExtra++; return; }
    const { replies, forwardToMqtt } = gateway.handleMessage(msg);
    if (forwardToMqtt) onCommandCb?.(forwardToMqtt);
    for (const r of replies) ws.send(JSON.stringify(r));
  });
});

let onCommandCb = null;
export function onCommand(cb) { onCommandCb = cb; }

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
    const env = gateway.ingest(topic, buf);
    if (env) broadcast(env);
  });
  client.on('error', (e) => console.error('[backend] MQTT error', e.message));
  return { client, broadcast, gateway };
}

// Publish dashboard commands back to MQTT: cmd/<action>. Validated; invalid + sync dropped.
export function wireCommands(mqttClient) {
  onCommand((msg) => {
    const { forwardToMqtt } = gateway.handleMessage(msg);
    // handleMessage already validated; sync returns forwardToMqtt=null
    if (!forwardToMqtt) return;
    const action = msg.payload?.action || 'unknown';
    mqttClient?.publish(`${config.cmdTopicPrefix}${action}`, JSON.stringify(msg));
  });
}
