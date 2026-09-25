import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWSClient } from './wsClient.js';

// Controllable fake WebSocket: instances exposed via MockWS.instances.
class MockWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    MockWS.instances.push(this);
  }
  send(s) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  recvRaw(s) { this.onmessage?.({ data: s }); }
}

beforeEach(() => {
  MockWS.instances = [];
  vi.stubGlobal('WebSocket', MockWS);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('wsClient', () => {
  it('sends sync on open', () => {
    createWSClient({ url: 'ws://x', onEnvelope: () => {}, onStatus: () => {} });
    MockWS.instances[0].open();
    const sent = MockWS.instances[0].sent.map(JSON.parse);
    expect(sent.some((m) => m.kind === 'cmd' && m.payload.action === 'sync')).toBe(true);
  });

  it('dedupes by id, drops malformed/unknown', () => {
    const got = [];
    createWSClient({ url: 'ws://x', onEnvelope: (m) => got.push(m), onStatus: () => {} });
    const ws = MockWS.instances[0];
    ws.open();
    ws.recv({ kind: 'target', id: 'a', ts: '', source: 's', payload: {} });
    ws.recv({ kind: 'target', id: 'a', ts: '', source: 's', payload: {} }); // dupe
    ws.recvRaw('not-json');
    ws.recv({ nope: true });
    expect(got.length).toBe(1);
  });

  it('reconnects after close with backoff', () => {
    const status = [];
    const c = createWSClient({ url: 'ws://x', onEnvelope: () => {}, onStatus: (s) => status.push(s.ws) });
    MockWS.instances[0].open();
    MockWS.instances[0].close();
    expect(status).toContain('closed');
    expect(MockWS.instances.length).toBe(1);
    vi.advanceTimersByTime(2000); // first backoff ~1500ms
    expect(MockWS.instances.length).toBe(2);
    c.close();
  });
});
