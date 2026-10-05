import { describe, it, expect } from 'vitest';
import { visibleMapData } from './mapVisibility.js';

describe('operator map history', () => {
  const now = Date.parse('2026-10-05T20:00:00Z');
  const old = new Date(now - 300000).toISOString();
  const input = {
    targets: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`T${i}`, { id: `T${i}`, _stale: 'LOST', ts: old }])),
    beacons: { old: { ts: old }, fresh: { ts: new Date(now).toISOString() } },
    events: [{ ts: old }], now, layers: { history: false },
  };
  it('keeps a hundred historical labels out of the live map', () => {
    const data = visibleMapData(input);
    expect(Object.keys(data.targets)).toHaveLength(0);
    expect(Object.keys(data.beacons)).toEqual(['fresh']);
    expect(data.events).toHaveLength(0);
    expect(Object.keys(input.targets)).toHaveLength(100);
  });
  it('history explicitly restores old markers', () => {
    expect(Object.keys(visibleMapData({ ...input, layers: { history: true } }).targets)).toHaveLength(100);
  });
  it('always keeps the selected beacon and mission target visible', () => {
    const data = visibleMapData({ ...input, selectedBeacon: 'old', mission: { target: { beaconId: 'T2' } } });
    expect(Object.keys(data.targets)).toEqual(['T2']);
    expect(Object.keys(data.beacons)).toEqual(['old', 'fresh']);
  });
});
