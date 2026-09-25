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
