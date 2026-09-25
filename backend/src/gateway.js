// Testable gateway core: no sockets, no timers, no MQTT import.
// WS/MQTT wiring lives in server.js; logic lives here so tests don't bind ports.
import { toEnvelope, } from './normalize.js';
import { validateCommand } from '../../shared/contract.js';

export function createGateway({ snapshotCap = 500 } = {}) {
  let seq = 0;
  const nextSeq = () => ++seq;
  const latestById = new Map();
  let dropped = 0;

  function ingest(topic, raw) {
    const env = toEnvelope(topic, raw, nextSeq);
    if (!env) { dropped++; return null; }
    const pid = env.payload?.id;
    if (pid) latestById.set(`${env.kind}:${pid}`, env);
    while (latestById.size > snapshotCap) latestById.delete(latestById.keys().next().value);
    return env;
  }

  // Handle one parsed WS message. Returns { replies: [envelope...], forwardToMqtt: msg|null }.
  // replies are ready-to-send envelope objects (not strings).
  function handleMessage(msg) {
    const cmd = validateCommand(msg);
    if (cmd && cmd.action === 'sync') {
      const snap = [...latestById.values()];
      return {
        replies: [...snap, ack(cmd.id, 'synced', { count: latestById.size })],
        forwardToMqtt: null,
      };
    }
    if (cmd) {
      return { replies: [ack(msg.id, 'received', { action: cmd.action })], forwardToMqtt: msg };
    }
    dropped++;
    return { replies: [], forwardToMqtt: null };
  }

  function ack(ackFor, status, extra = {}) {
    return {
      kind: 'cmd.ack', id: `msg-${nextSeq()}`, seq: nextSeq(),
      ts: new Date().toISOString(), source: 'ona',
      payload: { ackFor: ackFor || null, status, ...extra },
    };
  }

  function statusPayload({ mqttUp, heartbeat = false, bootAt }) {
    return {
      ona: mqttUp ? 'connected' : 'disconnected', ws: 'open', dropped,
      heartbeat, uptimeS: Math.floor((Date.now() - bootAt) / 1000),
      tracked: latestById.size,
    };
  }

  return {
    ingest, handleMessage,
    get snapshot() { return [...latestById.values()]; },
    get stats() { return { dropped, tracked: latestById.size, seq }; },
  };
}
