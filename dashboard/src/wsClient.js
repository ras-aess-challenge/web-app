// Minimal WS client with reconnect + dedupe. No deps.
export function createWSClient({ url, onEnvelope, onStatus }) {
  let ws = null;
  let attempt = 0;
  let closed = false;
  let lastMsgAt = null;
  const seen = new Set();
  const timers = [];

  function connect() {
    if (closed) return;
    onStatus?.({ ws: 'connecting', attempt, lastMsgAt });
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      onStatus?.({ ws: 'open', attempt, lastMsgAt });
      ws.send(JSON.stringify({ kind: 'cmd', id: `dash-${Date.now()}`, ts: new Date().toISOString(), source: 'dashboard', payload: { action: 'sync' } }));
    };
    ws.onmessage = (ev) => {
      lastMsgAt = new Date().toISOString();
      try {
        const m = JSON.parse(ev.data);
        if (!m || typeof m.kind !== 'string') return;
        if (m.id && seen.has(m.id)) return;
        if (m.id) { seen.add(m.id); if (seen.size > 1000) seen.clear(); }
        onEnvelope?.(m);
        onStatus?.({ ws: 'open', attempt, lastMsgAt });
      } catch { /* drop malformed */ }
    };
    ws.onclose = () => {
      onStatus?.({ ws: 'closed', attempt, lastMsgAt });
      attempt++;
      const delay = Math.min(15000, 1000 * Math.pow(1.5, attempt));
      timers.push(setTimeout(connect, delay));
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  connect();
  return {
    send(cmd) { try { ws?.readyState === 1 && ws.send(JSON.stringify(cmd)); } catch {} },
    close() { closed = true; timers.forEach(clearTimeout); try { ws?.close(); } catch {} },
  };
}
