// Tunable staleness thresholds (ms). Team-owned.
export const STALENESS = Object.freeze({
  LIVE_MS: 5000,
  STALE_MS: 15000,
});

export function classifyStaleness(ageMs, thresholds = STALENESS) {
  if (ageMs < 0) return 'LIVE';
  if (ageMs <= thresholds.LIVE_MS) return 'LIVE';
  if (ageMs <= thresholds.STALE_MS) return 'STALE';
  return 'LOST';
}
