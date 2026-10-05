// Robots' allowed area, shared with the simulators (shared/zone.json is the default; the "Draw zone"
// tool replaces it live). A zone is a polygon of local (x, y) meters.
import Z from '../../shared/zone.json';

export function defaultPolygon() {
  if (Array.isArray(Z.polygon) && Z.polygon.length >= 3) return Z.polygon.map(([x, y]) => [x, y]);
  const r = ((Z.rotDeg || 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ux, uy]) => {
    const lx = ux * (Z.x ?? 9), ly = uy * (Z.y ?? 7);
    return [(Z.cx || 0) + lx * c - ly * s, (Z.cy || 0) + lx * s + ly * c];
  });
}

/** Closed ring for drawing. */
export function ring(poly) {
  return poly.length ? [...poly, poly[0]] : [];
}

/** The text to paste into shared/zone.json to make a drawn zone permanent. */
export function zoneJson(poly) {
  return JSON.stringify({ polygon: poly.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) });
}
