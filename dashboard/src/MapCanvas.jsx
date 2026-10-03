import { useEffect, useRef, useState } from 'react';

// Props: targets, robots, trails {writer:[], executor:[]}, beacons, events, mission, layers, selectedBeacon
export default function MapCanvas({ targets, robots, trails, beacons, events, mission, layers, selectedBeacon }) {
  const ref = useRef(null);
  const [view, setView] = useState({ scale: 60, ox: null, oy: null });

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = (cv.width = cv.clientWidth * 2);
    const H = (cv.height = 960);
    const scale = view.scale;
    const ox = view.ox ?? W / 2, oy = view.oy ?? H / 2;
    const X = (x) => ox + x * scale, Y = (y) => oy - y * scale;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#1c2530'; ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += scale) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy < H; gy += scale) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    ctx.strokeStyle = '#33404f';
    ctx.beginPath(); ctx.moveTo(ox - 20, oy); ctx.lineTo(ox + 20, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 20); ctx.lineTo(ox, oy + 20); ctx.stroke();

    // trails — spatial memory
    if (layers.trails) {
      for (const [rid, pts] of Object.entries(trails)) {
        ctx.strokeStyle = rid === 'writer' ? '#22b8cf' : '#a9e34b'; ctx.lineWidth = 4;
        ctx.beginPath();
        pts.forEach((p, i) => { i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)); });
        ctx.stroke(); ctx.lineWidth = 1;
      }
    }
    // beacons
    if (layers.beacons) {
      for (const b of Object.values(beacons)) {
        ctx.fillStyle = b.id === selectedBeacon ? '#ffd43b' : '#4dabf7';
        const bx = X(b.pos.x), by = Y(b.pos.y);
        ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.PI / 4); ctx.fillRect(-10, -10, 20, 20); ctx.restore();
        ctx.fillStyle = '#e6edf5'; ctx.font = '600 22px system-ui';
        ctx.fillText(b.id, bx + 18, by + 6);
      }
    }
    // events
    if (layers.events) {
      for (const e of events.slice(0, 50)) {
        ctx.fillStyle = e.severity === 'critical' ? '#ff5252' : e.severity === 'warn' ? '#ffb020' : '#868e96';
        const ex = X(e.pos.x), ey = Y(e.pos.y);
        ctx.beginPath();
        ctx.moveTo(ex, ey - 8); ctx.lineTo(ex + 8, ey); ctx.lineTo(ex, ey + 8); ctx.lineTo(ex - 8, ey);
        ctx.closePath(); ctx.fill();
      }
    }
    // mission target + executor link (color by status)
    const mpos = mission?.target?.pos || (mission?.target?.beaconId && beacons[mission.target.beaconId]?.pos);
    if (mpos && robots.executor && mission?.status !== 'done' && mission?.status !== 'cancelled') {
      ctx.strokeStyle = mission?.status === 'failed' ? '#ff5252' : mission?.status === 'pending' ? '#ffd43b' : '#e599f7'; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(X(robots.executor.pos.x), Y(robots.executor.pos.y)); ctx.lineTo(X(mpos.x), Y(mpos.y)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = mission?.status === 'failed' ? '#ff5252' : mission?.status === 'pending' ? '#ffd43b' : '#e599f7';
      ctx.beginPath(); ctx.arc(X(mpos.x), Y(mpos.y), 16, 0, Math.PI * 2); ctx.stroke();
    }
    if (mpos && mission?.status === 'done') {
      ctx.strokeStyle = '#35d07f';
      ctx.beginPath(); ctx.arc(X(mpos.x), Y(mpos.y), 16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(mpos.x) - 7, Y(mpos.y)); ctx.lineTo(X(mpos.x) - 1, Y(mpos.y) + 6); ctx.lineTo(X(mpos.x) + 8, Y(mpos.y) - 6); ctx.stroke();
    }
    // robots as oriented triangles
    for (const [rid, r] of Object.entries(robots)) {
      if (!r) continue;
      const rx = X(r.pos.x), ry = Y(r.pos.y);
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(-(r.theta || 0));
      ctx.fillStyle = rid === 'writer' ? '#22b8cf' : '#a9e34b';
      ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(-16, -15); ctx.lineTo(-16, 15); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = '600 24px system-ui';
      ctx.fillText(`${rid} · ${r.state}`, rx + 20, ry - 20);
    }
    // targets + uncertainty ellipses
    if (layers.targets) {
      for (const t of Object.values(targets)) {
        const x = X(t.pos.x), y = Y(t.pos.y);
        ctx.save(); ctx.translate(x, y); ctx.rotate((-t.uncertainty.angleDeg * Math.PI) / 180);
        ctx.strokeStyle = t._stale === 'LOST' ? '#ff5252' : t._stale === 'STALE' ? '#ffb020' : '#35d07f';
        ctx.beginPath();
        ctx.ellipse(0, 0, t.uncertainty.sigmaX * scale * 2, t.uncertainty.sigmaY * scale * 2, 0, 0, Math.PI * 2);
        ctx.stroke(); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e6edf5'; ctx.font = '600 22px system-ui';
        ctx.fillText(`${t.id} ${((t.confidence ?? 0) * 100).toFixed(0)}%`, x + 14, y - 12);
      }
    }
    // scale bar: 2 m
    ctx.fillStyle = '#9fb2c8'; ctx.font = '18px system-ui';
    ctx.fillText('2 m', 20, H - 20);
    ctx.strokeStyle = '#9fb2c8'; ctx.beginPath(); ctx.moveTo(20, H - 40); ctx.lineTo(20 + 2 * scale, H - 40); ctx.stroke();
  });

  return (
    <div>
      <div className="map-tools">
        <div className="seg">
          <button onClick={() => setView((v) => ({ ...v, scale: Math.min(120, v.scale * 1.2) }))}>+</button>
          <button onClick={() => setView((v) => ({ ...v, scale: Math.max(10, v.scale / 1.2) }))}>−</button>
          <button onClick={() => setView({ scale: 60, ox: null, oy: null })}>Reset</button>
        </div>
        <span className="muted small">local robot frame (meters, origin = writer start) · drag to pan</span>
      </div>
      <canvas
        ref={ref}
        onMouseDown={(e) => { ref.current._drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; }}
        onMouseMove={(e) => {
          const d = ref.current._drag;
          if (!d) return;
          const rect = ref.current.getBoundingClientRect();
          const pxPerCss = (ref.current.width / rect.width);
          setView((v) => ({ ...v, ox: (d.ox ?? ref.current.width / 2) + (e.clientX - d.x) * pxPerCss, oy: (d.oy ?? 960 / 2) + (e.clientY - d.y) * pxPerCss }));
        }}
        onMouseUp={() => { ref.current._drag = null; }}
        onMouseLeave={() => { ref.current._drag = null; }}
      />
    </div>
  );
}
