// Presentation only: panels and persistent storage retain the full history.
export const MAP_HISTORY_MS = 180000;
export function visibleMapData({ targets = {}, beacons = {}, events = [], layers, selectedBeacon, mission, now = Date.now() }) {
  if (layers.history) return { targets, beacons, events };
  const relevant = id => id === selectedBeacon || id === mission?.target?.beaconId;
  const recent = item => now - Date.parse(item.ts) <= MAP_HISTORY_MS;
  return {
    targets: Object.fromEntries(Object.entries(targets).filter(([id, t]) => t._stale !== 'LOST' || relevant(id))),
    beacons: Object.fromEntries(Object.entries(beacons).filter(([id, b]) => recent(b) || relevant(id))),
    events: events.filter(recent),
  };
}
