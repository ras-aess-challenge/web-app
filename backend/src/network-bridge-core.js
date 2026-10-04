import net from 'node:net';
import { createHmac } from 'node:crypto';

export function readBeacons({ host, port, secret, timeout = 5000 }) {
  const type = Buffer.from([2]);
  const message = Buffer.concat([type, createHmac('sha256', secret).update(type).digest()]);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks = [];
    let size = 0;
    socket.setTimeout(timeout, () => socket.destroy(new Error('Network timeout')));
    socket.on('connect', () => socket.write(message));
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) socket.destroy(new Error('Mission snapshot too large'));
      else chunks.push(chunk);
    });
    socket.on('error', reject);
    socket.on('end', () => {
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString());
        if (!Array.isArray(result)) throw new Error('Expected beacon list');
        resolve(result);
      } catch { reject(new Error('Invalid or rejected network mission response')); }
    });
  });
}

export function convertBeacon(beacon) {
  if (!beacon || typeof beacon.node_id !== 'string' || !/^[\w-]+$/.test(beacon.node_id) ||
      !Number.isFinite(beacon.x) || !Number.isFinite(beacon.y) || !Number.isFinite(beacon.timestamp) ||
      !Number.isFinite(beacon.pod) || beacon.pod < 0 || beacon.pod > 1) throw new Error('Invalid beacon record');
  const ts = new Date(beacon.timestamp * 1000).toISOString();
  const pos = { x: beacon.x, y: beacon.y };
  return {
    beacon: { id: beacon.node_id, pos, info: `${beacon.event}; PoD ${beacon.pod.toFixed(2)}`, source: 'writer', ts, status: 'active' },
    target: { id: beacon.node_id, pos, ts, source: 'writer', confidence: beacon.pod, status: 'tracked', uncertainty: { sigmaX: 1, sigmaY: 1, angleDeg: 0 } },
  };
}
