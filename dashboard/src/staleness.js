export const STALENESS = {
  LIVE_MS: Number(import.meta.env?.VITE_LIVE_MS || 5000),
  STALE_MS: Number(import.meta.env?.VITE_STALE_MS || 15000),
};

export function classifyStaleness(ageMs, t = STALENESS) {
  if (ageMs <= t.LIVE_MS) return 'LIVE';
  if (ageMs <= t.STALE_MS) return 'STALE';
  return 'LOST';
}

// age = now - last_update (uses payload.ts, falls back to serverRxAt)
export function targetAge(target, now = Date.now()) {
  const t = Date.parse(target.ts ?? target.serverRxAt ?? '');
  if (Number.isNaN(t)) return Infinity;
  return now - t;
}
