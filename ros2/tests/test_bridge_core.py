import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import bridge_core as core  # noqa: E402

NOW = 1790337200.0


def test_latlon_roundtrip_matches_dashboard_anchor():
    assert core.latlon_to_local(core.ANCHOR_LAT, core.ANCHOR_LON) == (0.0, 0.0)
    lat, lon = core.local_to_latlon(3.0, -2.0)
    x, y = core.latlon_to_local(lat, lon)
    assert abs(x - 3.0) < 1e-6 and abs(y + 2.0) < 1e-6


def test_context_doc_example_converts():
    raw = {'target_id': 'target_01', 'timestamp': 1790337175.5, 'latitude': 36.8065, 'longitude': 10.1815,
           'confidence': 0.87, 'sigma_x': 4.2, 'sigma_y': 2.8, 'orientation': 35.0, 'source': 'ona'}
    topic, p = core.convert_target(raw, NOW)
    assert topic == 'targets/target_01'
    assert p['pos'] == {'x': 0.0, 'y': 0.0}
    assert p['ts'] == '2026-09-25T09:19:35.500Z' or p['ts'].endswith('Z')
    assert p['uncertainty'] == {'sigmaX': 4.2, 'sigmaY': 2.8, 'angleDeg': 35.0}
    assert p['source'] == 'ona' and p['status'] == 'tracked'


def test_source_timestamp_is_preserved_not_rx_time():
    raw = {'id': 'T', 'x': 1, 'y': 2, 'timestamp': NOW - 40, 'confidence': 0.9}
    _, p = core.convert_target(raw, NOW)
    assert p['ts'] == core.iso_utc(NOW - 40)


def test_ms_and_iso_timestamps():
    assert core.parse_ts(NOW * 1000, 0) == NOW
    assert core.parse_ts('2026-01-01T00:00:00Z', 0) == 1767225600.0
    assert core.parse_ts(None, 5) == 5
    assert core.parse_ts('garbage', 5) is None


def test_invalid_targets_dropped_not_raised():
    for bad in (None, 3, {}, {'target_id': 'a'}, {'target_id': 'a', 'x': 1}, {'id': 'a', 'x': 1, 'y': 2, 'ts': 'zzz'}):
        assert core.convert_target(bad, NOW) is None
    assert core.parse_target_message('not json', NOW) is None


def test_topic_injection_is_sanitised():
    topic, _ = core.convert_target({'id': 'a/b#+c', 'x': 0, 'y': 0}, NOW)
    assert topic == 'targets/a_b__c'


def test_confidence_and_sigma_clamped():
    _, p = core.convert_target({'id': 'a', 'x': 0, 'y': 0, 'confidence': 7, 'sigma_x': -3}, NOW)
    assert p['confidence'] == 1.0 and p['uncertainty']['sigmaX'] == 0.0


def test_yaw_and_battery():
    assert abs(core.quat_to_yaw(0, 0, math.sin(0.4), math.cos(0.4)) - 0.8) < 1e-9
    assert core.battery_pct(0.55) == 55.0 and core.battery_pct(1.0) == 100.0 and core.battery_pct(42) == 42
    assert core.battery_pct(float('nan')) is None


def test_diag_events_only_on_change():
    h = core.HealthTracker()
    assert h.update_diag('writer/lidar', 0, 'ok', NOW) == []          # 1re valeur OK : silence
    ev = h.update_diag('writer/lidar', 2, 'no scan', NOW + 1)
    assert len(ev) == 1 and ev[0]['severity'] == 'critical'
    assert h.update_diag('writer/lidar', 2, 'no scan', NOW + 2) == []   # pas de repetition
    assert h.robot_state() == 'fault(lidar)'
    ev = h.update_diag('writer/lidar', 0, 'ok', NOW + 11)
    assert ev[0]['severity'] == 'info' and h.robot_state() == 'exploring'


def _feed(h, t, topics):
    for tp in topics:
        h.touch(tp, t)


def test_one_topic_silent_is_sensor_all_silent_is_code():
    h = core.HealthTracker(silence_s=3.0)
    allt = core.HealthTracker.TOPICS
    t = NOW
    h.check_silence(t)
    for i in range(10):                      # tout vivant, fin de la periode de grace
        t += 1
        _feed(h, t, allt)
        assert h.check_silence(t) == []
    # le lidar se tait seul : probleme CAPTEUR
    evs = []
    for i in range(6):
        t += 1
        _feed(h, t, [x for x in allt if x != 'scan'])
        evs += h.check_silence(t)
    assert [e['key'] for e in evs] == ['silent-scan'] and 'sensor' in evs[0]['note']
    assert h.robot_state() == 'fault(scan)' and not h.node_down
    # le noeud meurt : TOUS muets -> probleme de CODE
    evs = []
    for i in range(6):
        t += 1
        evs += h.check_silence(t)
    assert any(e['key'] == 'node-down' and e['severity'] == 'critical' for e in evs)
    assert h.robot_state() == 'node-down'
    # retour : 1 seul evenement (pas de rafale)
    t += 1
    _feed(h, t, allt)
    evs = h.check_silence(t)
    assert [e['key'] for e in evs] == ['node-down'] and h.robot_state() == 'exploring'


def test_event_and_telemetry_payloads_match_contract():
    h = core.HealthTracker()
    ev = h.update_diag('writer/battery', 1, 'low', NOW)[0]
    topic, p = core.make_event_payload(ev, (1.0, 2.0), 'writer', NOW)
    assert topic.startswith('events/diag-writer_battery-') and p['id'] == topic.split('/')[1]
    assert p['type'] == 'system' and p['severity'] == 'warn' and p['pos'] == {'x': 1.0, 'y': 2.0}
    topic, t = core.make_telemetry('writer', (0.5, 0.5), 1.0, 55.0, 'exploring', NOW)
    assert topic == 'robots/writer' and t['batteryPct'] == 55.0 and t['state'] == 'exploring'


def test_level_int_accepts_ros_byte_type():
    # rclpy renvoie DiagnosticStatus.level sous forme de bytes (b'\x00', b'\x02'), pas d'int
    assert core.level_int(b'\x00') == 0 and core.level_int(b'\x02') == 2 and core.level_int(1) == 1
    h = core.HealthTracker()
    assert h.update_diag('writer/lidar', core.level_int(b'\x00'), '', NOW) == []
    assert h.update_diag('writer/lidar', core.level_int(b'\x02'), 'x', NOW + 1)[0]['severity'] == 'critical'


# ---------- balises, missions, Executor ----------
import executor_logic as ex  # noqa: E402


def test_beacon_conversion_and_event():
    topic, p, ev = core.convert_beacon(
        {'beacon_id': 'B-1', 'timestamp': NOW, 'x': -3, 'y': 4, 'info': 'victim detected',
         'event_type': 'victim', 'severity': 'critical'}, NOW)
    assert topic == 'beacons/B-1' and p['pos'] == {'x': -3.0, 'y': 4.0} and p['status'] == 'active'
    assert ev['key'] == 'beacon-B-1' and ev['severity'] == 'critical' and ev['pos'] == (-3.0, 4.0)
    t2, p2, ev2 = core.convert_beacon({'id': 'B2', 'latitude': core.ANCHOR_LAT, 'longitude': core.ANCHOR_LON}, NOW)
    assert p2['pos'] == {'x': 0.0, 'y': 0.0} and ev2 is None
    assert core.convert_beacon({'beacon_id': 'x'}, NOW) is None


def test_command_parsing_matches_backend_envelope():
    text = '{"kind":"cmd","id":"d1","ts":"2026-10-03T18:00:00Z","source":"dashboard","payload":{"action":"assign-mission","beaconId":"B-1"}}'
    assert core.parse_command('cmd/assign-mission', text) == ('assign-mission', {'action': 'assign-mission', 'beaconId': 'B-1'})
    assert core.parse_command('cmd/x', 'nope') is None


def test_mission_lifecycle():
    mt = core.MissionTracker(start=7)
    beacons = {'B-1': {'pos': {'x': -3.0, 'y': 4.0}}}
    assert mt.assign({'beaconId': 'ghost'}, beacons, NOW) is None
    mission, cmd = mt.assign({'beaconId': 'B-1', 'objective': 'Inspect B-1'}, beacons, NOW)
    assert mission['id'] == 'M-7' and mission['status'] == 'pending'
    assert mission['target'] == {'beaconId': 'B-1', 'pos': {'x': -3.0, 'y': 4.0}}
    assert cmd == {'mission_id': 'M-7', 'target': {'x': -3.0, 'y': 4.0}}
    assert mt.on_executor_status({'mission_id': 'M-OLD', 'mission_status': 'active'}, NOW) is None
    assert mt.on_executor_status({'mission_id': 'M-7', 'mission_status': 'active'}, NOW)['status'] == 'active'
    assert mt.on_executor_status({'mission_id': 'M-7', 'mission_status': 'active'}, NOW) is None  # pas de doublon
    assert mt.on_executor_status({'mission_id': 'M-7', 'mission_status': 'done'}, NOW)['status'] == 'done'
    assert mt.cancel({}, NOW) is None  # deja terminee


def test_mission_cancel():
    mt = core.MissionTracker()
    mt.assign({'beaconId': 'B-1'}, {'B-1': {'pos': {'x': 0, 'y': 0}}}, NOW)
    m, cmd = mt.cancel({'missionId': mt.current['id']}, NOW)
    assert m['status'] == 'cancelled' and cmd['cancel'] is True
    assert mt.on_executor_status({'mission_id': m['id'], 'mission_status': 'active'}, NOW) is None


def test_executor_drives_to_target_inspects_and_returns():
    m = ex.ExecutorModel()
    assert m.state == 'standby' and m.mission_status is None
    m.assign('M-1', (-3.0, 4.0))
    assert m.state == 'en-route' and m.mission_status == 'active'
    seen = []
    for _ in range(2000):                       # 200 s max a 10 Hz
        m.tick(0.1)
        if not seen or seen[-1] != m.state:
            seen.append(m.state)
        if m.state == 'standby':
            break
    assert seen == ['en-route', 'inspecting', 'returning', 'standby']
    assert m.mission_status == 'done'
    assert abs(m.pos[0] - ex.HOME[0]) < 0.5 and abs(m.pos[1] - ex.HOME[1]) < 0.5


def test_executor_reaches_the_beacon():
    m = ex.ExecutorModel()
    m.assign('M-1', (5.0, -3.5))
    while m.state == 'en-route':
        m.tick(0.1)
    assert m.state == 'inspecting'
    assert abs(m.pos[0] - 5.0) < 0.5 and abs(m.pos[1] + 3.5) < 0.5


def test_executor_cancel_goes_home():
    m = ex.ExecutorModel()
    m.assign('M-1', (5.0, -3.5))
    for _ in range(50):
        m.tick(0.1)
    m.cancel('M-1')
    assert m.mission_status == 'cancelled' and m.state == 'returning'
    m.cancel('M-OTHER')   # mauvais id : ignore
    assert m.state == 'returning'
