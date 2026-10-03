// Frame translation: local robot frame (meters, origin = writer start)
// -> real-world GPS, around a configurable site anchor.
// Set VITE_ANCHOR_LON / VITE_ANCHOR_LAT to the real test site (default: Tunis).
import { fromLonLat, toLonLat } from 'ol/proj.js';

export const ANCHOR = [
  Number(import.meta.env?.VITE_ANCHOR_LON ?? 10.1815),
  Number(import.meta.env?.VITE_ANCHOR_LAT ?? 36.8065),
];
export const ANCHOR_MERC = fromLonLat(ANCHOR);

// Web Mercator stretches distances by 1/cos(lat): convert true ground meters
// to EPSG:3857 units so the robot positions land at the right GPS spot.
const MERC_PER_M = 1 / Math.cos((ANCHOR[1] * Math.PI) / 180);

/** Local (x, y) meters -> EPSG:3857 map coordinates. */
export function toMap(x, y) {
  return [ANCHOR_MERC[0] + x * MERC_PER_M, ANCHOR_MERC[1] + y * MERC_PER_M];
}

/** Local (x, y) meters -> { lat, lon } in degrees (WGS84). */
export function toGps(x, y) {
  const [lon, lat] = toLonLat(toMap(x, y));
  return { lat, lon };
}

export function fmtGps(pos) {
  if (!pos || typeof pos.x !== 'number') return '—';
  const { lat, lon } = toGps(pos.x, pos.y);
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
