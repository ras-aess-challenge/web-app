import { describe, it, expect } from 'vitest';
import { classifyStaleness, targetAge } from './staleness.js';

describe('classifyStaleness', () => {
  const t = { LIVE_MS: 5000, STALE_MS: 15000 };
  it('LIVE within window', () => expect(classifyStaleness(1000, t)).toBe('LIVE'));
  it('STALE after LIVE_MS', () => expect(classifyStaleness(6000, t)).toBe('STALE'));
  it('LOST after STALE_MS', () => expect(classifyStaleness(20000, t)).toBe('LOST'));
  it('boundary is inclusive', () => {
    expect(classifyStaleness(5000, t)).toBe('LIVE');
    expect(classifyStaleness(15000, t)).toBe('STALE');
  });
});

describe('targetAge', () => {
  it('age = now - ts', () => {
    const ts = new Date('2026-01-01T00:00:00.000Z').toISOString();
    expect(targetAge({ ts }, Date.parse(ts) + 3000)).toBe(3000);
  });
  it('falls back to serverRxAt', () => {
    const rx = new Date('2026-01-01T00:00:10.000Z').toISOString();
    expect(targetAge({ serverRxAt: rx }, Date.parse(rx) + 1000)).toBe(1000);
  });
  it('unparseable -> Infinity (renders LOST)', () => {
    expect(targetAge({})).toBe(Infinity);
    expect(classifyStaleness(targetAge({}), { LIVE_MS: 5000, STALE_MS: 15000 })).toBe('LOST');
  });
});

import { decayFactor, currentPod, grownSigma } from './staleness.js';

describe('staleness engine (PoD decay + ellipse growth)', () => {
  const d = { LAMBDA: 0.05, GROWTH: 4, RESCOUT_POD: 0.25 };
  it('fresh data: no decay, ellipse = sigma0', () => {
    expect(decayFactor(0)).toBeCloseTo(1);
    expect(grownSigma(1.2, 0, d)).toBeCloseTo(1.2);
  });
  it('PoD follows exp(-lambda*dt)', () => {
    expect(currentPod(0.8, 20000, 0.05)).toBeCloseTo(0.8 * Math.exp(-1), 6);
  });
  it('ellipse grows monotonically with age', () => {
    const s = [0, 5000, 15000, 30000, 120000].map((a) => grownSigma(1, a, d));
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(s[s.length - 1]).toBeLessThanOrEqual(5.0001);
  });
  it('infinite / unparseable age -> PoD 0', () => {
    expect(currentPod(0.9, Infinity)).toBe(0);
  });
});
