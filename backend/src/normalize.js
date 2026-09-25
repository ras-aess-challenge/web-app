import { isEnvelope, normalizeTarget, normalizeTelemetry, normalizeEvent, normalizeBeacon, normalizeMission } from '../../shared/contract.js';

// Validate + normalize an MQTT message into a WS envelope payload.
// Returns envelope object or null (drop + count).
export function toEnvelope(topic, raw, seqFn) {
  let parsed = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return null;
    }
  }
  const [domain] = topic.split('/');
  let kind = 'target';
  if (domain === 'robots') kind = 'telemetry';
  else if (domain === 'events') kind = 'event';
  else if (domain === 'beacons') kind = 'beacon';
  else if (domain === 'missions') kind = 'mission';
  else if (domain === 'targets') kind = 'target';

  if (kind === 'target') {
    const t = normalizeTarget(parsed);
    if (!t) return null;
    return {
      kind, id: `msg-${seqFn()}`, seq: seqFn(), ts: new Date().toISOString(),
      source: t.source, payload: { ...t, serverRxAt: new Date().toISOString() },
    };
  }
  // Passthrough for other kinds: require id + ts
  let payload = null;
  if (kind === 'telemetry') payload = normalizeTelemetry(parsed);
  else if (kind === 'event') payload = normalizeEvent(parsed);
  else if (kind === 'beacon') payload = normalizeBeacon(parsed);
  else if (kind === 'mission') payload = normalizeMission(parsed);
  if (!payload) return null;
  const env = {
    kind, id: `msg-${seqFn()}`, seq: seqFn(), ts: new Date().toISOString(),
    source: typeof payload.source === 'string' ? payload.source : domain,
    payload: { ...payload, serverRxAt: new Date().toISOString() },
  };
  return isEnvelope(env) ? env : null;
}
