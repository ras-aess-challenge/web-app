"""
Logique pure du pont ROS 2 -> MQTT (aucune dependance ROS / MQTT => testable partout).

Contrat de sortie = celui du backend (docs/ona-contract.md) :
  targets/<id>  robots/<id>  events/<id>   (JSON, metres dans le repere local, ts ISO-8601 UTC)
"""
import json
import math
import os
import re
from datetime import datetime, timezone

R_EARTH = 6378137.0
# Meme ancre que le dashboard (dashboard/src/geo.js) -> lat/lon <-> metres coherents.
ANCHOR_LAT = float(os.environ.get('ANCHOR_LAT', 36.8065))
ANCHOR_LON = float(os.environ.get('ANCHOR_LON', 10.1815))

TARGET_SOURCES = ('writer', 'executor', 'ona')
LEVEL_NAMES = {0: 'OK', 1: 'WARN', 2: 'ERROR', 3: 'STALE'}


# ---------- coordonnees ----------
def latlon_to_local(lat, lon):
    """GPS (deg) -> metres locaux (x = est, y = nord) autour de l'ancre."""
    x = R_EARTH * math.radians(lon - ANCHOR_LON) * math.cos(math.radians(ANCHOR_LAT))
    y = R_EARTH * math.radians(lat - ANCHOR_LAT)
    return x, y


def local_to_latlon(x, y):
    lat = ANCHOR_LAT + math.degrees(y / R_EARTH)
    lon = ANCHOR_LON + math.degrees(x / (R_EARTH * math.cos(math.radians(ANCHOR_LAT))))
    return lat, lon


def quat_to_yaw(x, y, z, w):
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


# ---------- temps ----------
def iso_utc(epoch):
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def parse_ts(value, now_epoch):
    """timestamp epoch (s ou ms), ISO-8601, ou absent -> epoch secondes."""
    if value is None:
        return now_epoch
    if isinstance(value, (int, float)):
        v = float(value)
        return v / 1000.0 if v > 1e11 else v
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except ValueError:
            return None
    return None


def safe_id(raw):
    s = re.sub(r'[^A-Za-z0-9_-]', '_', str(raw))[:64]
    return s or None


# ---------- /ona/parsed_targets -> targets/<id> ----------
def _num(d, *keys, default=None):
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            return float(v)
    return default


def convert_target(raw, now_epoch):
    """
    Accepte le JSON provisoire du document de contexte ET la forme du contrat :
      target_id|id, timestamp|ts, latitude/longitude | x/y | pos{x,y},
      confidence, sigma_x|sigmaX, sigma_y|sigmaY, orientation|angleDeg, source, status
    Retourne (topic, payload) ou None si invalide (le pont ne plante jamais).
    Le 'ts' est celui de la SOURCE (pas l'heure de reception) : si l'ONA arrete de
    publier, la cible vieillit et le dashboard fait grossir son ellipse.
    """
    if not isinstance(raw, dict):
        return None
    tid = safe_id(raw.get('target_id', raw.get('id')))
    if not tid:
        return None
    pos = raw.get('pos') if isinstance(raw.get('pos'), dict) else raw
    x, y = _num(pos, 'x'), _num(pos, 'y')
    if x is None or y is None:
        lat, lon = _num(raw, 'latitude', 'lat'), _num(raw, 'longitude', 'lon', 'lng')
        if lat is None or lon is None:
            return None
        x, y = latlon_to_local(lat, lon)
    ts = parse_ts(raw.get('timestamp', raw.get('ts')), now_epoch)
    if ts is None:
        return None
    u = raw.get('uncertainty') if isinstance(raw.get('uncertainty'), dict) else {}
    src = raw.get('source')
    payload = {
        'id': tid,
        'pos': {'x': round(x, 3), 'y': round(y, 3)},
        'theta': 0.0,
        'ts': iso_utc(ts),
        'confidence': min(1.0, max(0.0, _num(raw, 'confidence', default=0.5))),
        'source': src if src in TARGET_SOURCES else 'ona',
        'status': 'lost' if raw.get('status') == 'lost' else 'tracked',
        'uncertainty': {
            'sigmaX': max(0.0, _num(u, 'sigmaX', default=_num(raw, 'sigma_x', 'sigmaX', default=1.0))),
            'sigmaY': max(0.0, _num(u, 'sigmaY', default=_num(raw, 'sigma_y', 'sigmaY', default=1.0))),
            'angleDeg': _num(u, 'angleDeg', default=_num(raw, 'orientation', 'angleDeg', default=0.0)),
        },
    }
    return f'targets/{tid}', payload


def parse_target_message(text, now_epoch):
    try:
        return convert_target(json.loads(text), now_epoch)
    except (ValueError, TypeError):
        return None


# ---------- sante du robot ----------
def level_int(level):
    """DiagnosticStatus.level est de type `byte` : rclpy le donne en bytes (b'\\x00'), pas en int."""
    if isinstance(level, (bytes, bytearray)):
        return level[0] if level else 0
    return int(level)


def short_name(name):
    """'writer/lidar' -> 'lidar'"""
    return str(name).split('/')[-1] or str(name)


def battery_pct(percentage):
    """BatteryState.percentage est une fraction 0..1 (ROS) ; tolere aussi 0..100."""
    if percentage is None or not math.isfinite(percentage) or percentage < 0:
        return None
    return round(min(100.0, percentage * 100.0 if percentage <= 1.0 else percentage), 1)


class HealthTracker:
    """
    Distingue PROBLEME ROBOT / CAPTEUR de PROBLEME DE CODE, avec 2 sources :
      - /diagnostics : niveau OK/WARN/ERROR declare par le robot -> panne capteur ou hardware
      - silence des topics : un topic muet = capteur ; TOUS muets = noeud mort (code)
    update_*() renvoient une liste d'evenements (dicts) UNIQUEMENT sur changement d'etat.
    """
    TOPICS = ('odom', 'scan', 'battery', 'diagnostics')

    def __init__(self, silence_s=3.0):
        self.silence_s = silence_s
        self.levels = {}          # nom diag -> niveau
        self.last_seen = {}       # topic -> epoch
        self.silent = set()       # topics actuellement muets
        self.node_down = False
        self.started = None

    # --- diagnostics ---
    def update_diag(self, name, level, message, now):
        prev = self.levels.get(name)
        self.levels[name] = level
        if prev is None and level == 0:
            return []
        if prev == level:
            return []
        sev = {0: 'info', 1: 'warn', 2: 'critical', 3: 'warn'}.get(level, 'warn')
        label = LEVEL_NAMES.get(level, str(level))
        note = f'{name}: {label}' + (f' - {message}' if message else '')
        if level == 0:
            note = f'{name}: back to OK'
        return [self._event(f'diag-{safe_id(name)}', 'system', sev, note, now)]

    # --- liveness ---
    def touch(self, topic, now):
        self.last_seen[topic] = now

    def check_silence(self, now):
        if self.started is None:
            self.started = now
        events = []
        grace = now - self.started < self.silence_s + 2
        silent_now = {
            t for t in self.TOPICS
            if t in self.last_seen and now - self.last_seen[t] > self.silence_s
        }
        if grace:
            return events
        all_silent = len(self.last_seen) == len(self.TOPICS) and silent_now == set(self.TOPICS)
        if all_silent and not self.node_down:
            self.node_down = True
            events.append(self._event('node-down', 'system', 'critical',
                                      'Writer node down: ALL topics silent -> software crash (not a sensor)', now))
        elif not all_silent and self.node_down:
            self.node_down = False
            self.silent = silent_now  # pas de rafale d'evenements 'recovered' au retour du noeud
            events.append(self._event('node-down', 'system', 'info', 'Writer node back: topics flowing again', now))
            return events
        if not self.node_down:
            for t in silent_now - self.silent:
                events.append(self._event(f'silent-{t}', 'system', 'warn',
                                          f'/{t} silent for >{self.silence_s:.0f}s while node alive -> sensor/hardware', now))
            for t in self.silent - silent_now:
                events.append(self._event(f'silent-{t}', 'system', 'info', f'/{t} recovered', now))
        self.silent = silent_now
        return events

    # --- etat resume pour le dashboard ---
    def robot_state(self):
        if self.node_down:
            return 'node-down'
        errs = sorted({short_name(n) for n, l in self.levels.items() if l >= 2})
        errs += [t for t in sorted(self.silent) if t not in errs]
        if errs:
            return 'fault(' + ','.join(errs) + ')'
        if any(l == 1 for l in self.levels.values()):
            return 'degraded'
        return 'exploring'

    @staticmethod
    def _event(key, etype, sev, note, now):
        return {'key': key, 'type': etype, 'severity': sev, 'note': note, 'now': now}


# ---------- /ona/beacons -> beacons/<id> (+ evenement a la 1re detection) ----------
EVENT_TYPES = ('hazard', 'victim', 'obstacle', 'system')
SEVERITIES = ('info', 'warn', 'critical')


def convert_beacon(raw, now_epoch):
    """
    JSON ONA : beacon_id|id, x/y | latitude/longitude, info, timestamp|ts, status,
               event_type (hazard|victim|obstacle), severity.
    Retourne (topic, payload, event|None) ou None si invalide.
    """
    if not isinstance(raw, dict):
        return None
    bid = safe_id(raw.get('beacon_id', raw.get('id')))
    if not bid:
        return None
    pos = raw.get('pos') if isinstance(raw.get('pos'), dict) else raw
    x, y = _num(pos, 'x'), _num(pos, 'y')
    if x is None or y is None:
        lat, lon = _num(raw, 'latitude', 'lat'), _num(raw, 'longitude', 'lon', 'lng')
        if lat is None or lon is None:
            return None
        x, y = latlon_to_local(lat, lon)
    ts = parse_ts(raw.get('timestamp', raw.get('ts')), now_epoch)
    if ts is None:
        return None
    info = raw.get('info') if isinstance(raw.get('info'), str) else ''
    payload = {
        'id': bid, 'pos': {'x': round(x, 3), 'y': round(y, 3)}, 'info': info[:280],
        'source': 'writer', 'ts': iso_utc(ts),
        'status': 'expired' if raw.get('status') == 'expired' else 'active',
    }
    event = None
    et = raw.get('event_type')
    if et in EVENT_TYPES:
        sev = raw.get('severity') if raw.get('severity') in SEVERITIES else 'warn'
        event = {'key': f'beacon-{bid}', 'type': et, 'severity': sev,
                 'note': f'{et} marked by beacon {bid}' + (f': {info}' if info else ''),
                 'now': ts, 'pos': (x, y)}
    return f'beacons/{bid}', payload, event


# ---------- commandes du dashboard (MQTT cmd/<action>) ----------
def parse_command(topic, text):
    """cmd/assign-mission + enveloppe WS {kind:'cmd', id, payload:{action, ...}} -> (action, payload) | None"""
    try:
        msg = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(msg, dict) or not isinstance(msg.get('payload'), dict):
        return None
    action = msg['payload'].get('action') or topic.split('/', 1)[-1]
    return action, msg['payload']


class MissionTracker:
    """Cycle de vie d'une mission : pending -> active -> done | cancelled | failed."""

    def __init__(self, start=1):
        self.n = start
        self.current = None

    def _payload(self, now):
        c = self.current
        return {'id': c['id'], 'targetRobot': 'executor', 'objective': c['objective'],
                'target': {'beaconId': c['beaconId'], 'pos': c['pos']},
                'status': c['status'], 'updatedAt': iso_utc(now), 'ts': iso_utc(now)}

    def assign(self, payload, beacons, now):
        """-> (mission_payload, ros_cmd) ou None si la balise est inconnue."""
        bid = payload.get('beaconId')
        pos = None
        if isinstance(bid, str) and bid in beacons:
            pos = beacons[bid]['pos']
        elif isinstance(payload.get('target'), dict) and isinstance(payload['target'].get('pos'), dict):
            pos = payload['target']['pos']
        if pos is None:
            return None
        mid = f'M-{self.n}'
        self.n += 1
        self.current = {'id': mid, 'beaconId': bid if isinstance(bid, str) else None, 'pos': dict(pos),
                        'objective': str(payload.get('objective') or f'Inspect {bid}')[:280], 'status': 'pending'}
        return self._payload(now), {'mission_id': mid, 'target': {'x': pos['x'], 'y': pos['y']}}

    def cancel(self, payload, now):
        c = self.current
        if not c or c['status'] in ('done', 'cancelled', 'failed'):
            return None
        want = payload.get('missionId')
        if want and want != c['id']:
            return None
        c['status'] = 'cancelled'
        return self._payload(now), {'cancel': True, 'mission_id': c['id']}

    def on_executor_status(self, st, now):
        """Statut renvoye par l'Executor -> payload mission mis a jour, ou None."""
        c = self.current
        if not c or st.get('mission_id') != c['id']:
            return None
        new = st.get('mission_status')
        if new in ('active', 'done') and new != c['status'] and c['status'] not in ('cancelled', 'failed'):
            c['status'] = new
            return self._payload(now)
        return None

    def snapshot(self, now):
        return self._payload(now) if self.current else None


def make_event_payload(ev, pos, source, now):
    if ev.get('pos'):
        pos = ev['pos']
    eid = f"{ev['key']}-{int(ev['now'] * 1000)}"
    return f'events/{eid}', {
        'id': eid,
        'type': ev['type'],
        'pos': {'x': round(pos[0], 3), 'y': round(pos[1], 3)},
        'severity': ev['severity'],
        'source': source,
        'ts': iso_utc(ev['now']),
        'note': ev['note'][:280],
    }


def make_telemetry(robot_id, pos, theta, batt_pct, state, ts_epoch):
    return f'robots/{robot_id}', {
        'id': robot_id,
        'pos': {'x': round(pos[0], 3), 'y': round(pos[1], 3)},
        'theta': round(theta, 4),
        'batteryPct': batt_pct,
        'state': state,
        'source': robot_id,
        'ts': iso_utc(ts_epoch),
    }
