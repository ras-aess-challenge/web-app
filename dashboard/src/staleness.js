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

// ---- Staleness engine: PoD decay + growing uncertainty ellipse -------------
// Spec (system spec §3): PoD_current = PoD_initial * exp(-lambda * (t_read - t_write))
// The ellipse grows as PoD decays, so aging data is *visibly* less certain.
export const DECAY = {
  LAMBDA: Number(import.meta.env?.VITE_DECAY_LAMBDA || 0.05), // 1/s  (half-life ~14 s)
  GROWTH: Number(import.meta.env?.VITE_ELLIPSE_GROWTH || 4), // sigma tends to (1+GROWTH) x sigma0
  RESCOUT_POD: Number(import.meta.env?.VITE_RESCOUT_POD || 0.25), // below this -> "Re-Scout"
};

/** exp(-lambda * age): 1 when fresh, -> 0 as the data ages. */
export function decayFactor(ageMs, lambda = DECAY.LAMBDA) {
  if (!Number.isFinite(ageMs)) return 0;
  return Math.exp(-lambda * Math.max(0, ageMs) / 1000);
}

/** Current probability of detection after decay. */
export function currentPod(confidence, ageMs, lambda = DECAY.LAMBDA) {
  return (confidence ?? 0) * decayFactor(ageMs, lambda);
}

/** Ellipse sigma at a given age: grows smoothly from sigma0 to (1+GROWTH)*sigma0. */
export function grownSigma(sigma0, ageMs, d = DECAY) {
  const grow = 1 - decayFactor(ageMs, d.LAMBDA); // 0 -> 1
  return sigma0 * (1 + d.GROWTH * grow);
}
