// Adapter from the authenticated Python network to MQTT; ROS or HTTP executor mode.
import mqtt from 'mqtt';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const defaultZone = JSON.parse(readFileSync(new URL('../../shared/zone.json', import.meta.url)));
let clearedMissionId = null;
let resetSince = 0;
import { validateCommand } from '../../shared/contract.js';
import { readBeacons, convertBeacon } from './network-bridge-core.js';

const secret = process.env.SHARED_SECRET || '';
if (Buffer.byteLength(secret) < 32) throw new Error('SHARED_SECRET must contain at least 32 bytes');
const network = { host: process.env.NETWORK_HOST || 'strong-node', port: Number(process.env.NETWORK_PORT || 65432), secret };
const rosMode = process.env.EXECUTOR_MODE === 'ros';
let lastRosTelemetry = 0;
const executorUrl = process.env.EXECUTOR_URL || 'http://executor-control:8080';
const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://mosquitto:1883', { clientId: 'python-network-bridge' });
let connected = false;
let lastPoll = 0;
let busy = false;
let stopping = false;
let commandQueue = Promise.resolve();

const publish = (topic, payload) => client.publish(topic, JSON.stringify(payload), { qos: 1, retain: true });
async function executor(path, body) {
  const response = await fetch(executorUrl + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Executor returned HTTP ${response.status}`);
  return response.json();
}

async function poll() {
  if (busy || !connected || stopping) return;
  busy = true;
  try {
    for (const raw of await readBeacons(network)) {
      try {
        const converted = convertBeacon(raw);
        publish(`beacons/${converted.beacon.id}`, converted.beacon);
        publish(`targets/${converted.target.id}`, converted.target);
      } catch { console.warn('[network-bridge] Invalid stored beacon skipped'); }
    }
    if (rosMode) { lastPoll = Date.now(); return; }
    const state = await executor('/state');
    const ts = new Date().toISOString();
    publish('robots/executor', { id: 'executor', pos: state.pos, source: 'executor', ts,
      state: state.mission?.status === 'active' ? 'navigating' : (state.mission?.status || 'standby') });
    if (state.mission && state.mission.id !== clearedMissionId && Date.parse(state.mission.ts) >= resetSince) publish(`missions/${state.mission.id}`, state.mission);
    lastPoll = Date.now();
  } catch (error) { console.error('[network-bridge]', error.message); }
  finally { busy = false; }
}

async function command(topic, bytes) {
  let message;
  try { message = JSON.parse(bytes.toString()); } catch { return; }
  const validated = validateCommand(message);
  if (!validated || topic !== `cmd/${validated.action}`) return;
  try {
    if (validated.action === 'assign-mission') {
      const mission = await executor('/missions', { id: message.id, beaconId: message.payload.beaconId, objective: message.payload.objective });
      publish(`missions/${mission.id}`, mission);
    } else if (validated.action === 'reset-map') {
      const state = await executor('/state');
      if (state.mission && ['pending', 'active'].includes(state.mission.status)) await executor('/cancel', { missionId: state.mission.id });
      clearedMissionId = state.mission?.id || null;
      publish('system/map-reset', { id: 'simulation', ts: new Date().toISOString(), polygon: defaultZone.polygon, scope: 'network' });
    } else if (validated.action === 'cancel-mission') {
      const state = await executor('/state');
      if (state.mission) await executor('/cancel', { missionId: message.payload.missionId || state.mission.id });
    }
    await poll();
  } catch (error) {
    console.error('[network-bridge] Command failed:', error.message);
    const ts = new Date().toISOString();
    publish(`events/command-${message.id}`, { id: `command-${message.id}`, pos: { x: 0, y: 0 },
      type: 'system', severity: 'warn', source: 'ona', ts, note: `Command rejected: ${error.message}` });
  }
}

client.on('connect', () => { connected = true; client.subscribe(rosMode ? 'robots/executor' : ['cmd/#', 'system/map-reset'], { qos: 1 }, error => { if (!error) poll(); }); });
client.on('close', () => { connected = false; });
client.on('error', error => console.error('[network-bridge] MQTT:', error.message));
client.on('message', (topic, bytes, packet) => {
  if (topic === 'system/map-reset') {
    try { const state = JSON.parse(bytes); resetSince = Math.max(resetSince, Date.parse(state.ts) || 0); } catch {}
    return;
  }
  if (rosMode) {
    try { const robot = JSON.parse(bytes); if (!packet.retain && Date.now() - Date.parse(robot.ts) < 5000) lastRosTelemetry = Date.now(); } catch {}
    return;
  }
  // Never replay retained operator commands on bridge restart.
  if (packet.retain || bytes.length > 16384) return;
  commandQueue = commandQueue.then(() => command(topic, bytes)).catch(error => console.error(error.message));
});
const timer = setInterval(poll, 1000);
const health = createServer((req, res) => {
  const ready = connected && Date.now() - lastPoll < 15000 && (!rosMode || Date.now() - lastRosTelemetry < 10000);
  res.writeHead(req.url === '/health' ? (ready ? 200 : 503) : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ mqtt: connected, networkAndExecutor: ready }));
});
health.listen(8081, '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopping = true; clearInterval(timer); health.close(); client.end(false, () => process.exit(0));
});
