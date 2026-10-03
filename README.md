# The Living Map — Command Post & ROS 2 Bridge

TSYP14 · IEEE RAS × AESS Tunisia · **Track 3: Dashboard & Documentation**

This repo contains everything on the *outside* of the rubble: the ROS 2 side of the
**Outside Network Area (ONA)**, the MQTT broker, the Node.js backend and the React
**Command Post** dashboard. One command starts the whole chain with simulated data.

```bash
docker compose up -d --build        # first build ≈ 15 min (ROS image), then seconds
```

| What | Where |
|------|-------|
| Command Post dashboard | http://localhost:5173 |
| Foxglove (debug) | `ws://localhost:8765` → import `foxglove/living_map_robot_health.json` |
| WebSocket backend | `ws://localhost:4311` |
| MQTT broker | `localhost:1883` |

---

## 1. Architecture

```
 ┌────────────────────────── ROS 2 container (ros/) ──────────────────────────┐
 │                                                                             │
 │  writer_sim_node ──► /odom /tf /scan /battery_state /diagnostics ──┐        │
 │  executor_sim_node ◄── /executor/mission                           │        │
 │                   ──► /executor/odom /executor/status ─────────────┤        │
 │  parsed_targets_sim (fake ONA) ► /ona/parsed_targets /ona/beacons ─┤        │
 │                                                                    ▼        │
 │                                           ros_mqtt_bridge ◄───────────────┐ │
 │                                                                  ▲         │ │
 │  foxglove_bridge (ws :8765) ◄── reads every topic above          │         │ │
 └──────────────────────────────────────────────────────────────────┼─────────┼─┘
                                                                    │ MQTT    │ cmd/#
                                                                    ▼         │
                                              Mosquitto :1883 ──► Node.js backend :4311
                                                                    │ WebSocket
                                                                    ▼
                                                      React dashboard :5173  (Command Post)
```

* **Foxglove is not the dashboard.** It is a *debug window into ROS 2*: "is the data correct
  and arriving?". The dashboard is the operator UI: "what do we show the Command Post?".
  If Foxglove sees the data but the dashboard does not, the problem is downstream
  (MQTT → backend → WebSocket → React). If Foxglove does not see it either, it is upstream.
* **The dashboard never talks to robots.** Commands go dashboard → WebSocket → backend →
  MQTT `cmd/<action>` → bridge → ROS 2 topic → robot.
* **The ONA is a role, not a machine.** Here "ONA" = the ROS 2 environment (+ bridge)
  that turns what the field sends into clean topics. The Ubuntu VM is just where we developed it.

### Services (docker-compose)

| Service | Image / folder | Port | Role |
|---------|----------------|------|------|
| `mosquitto` | `eclipse-mosquitto:2` | 1883 | MQTT broker (anonymous, dev only) |
| `backend` | `backend/` (Node 22) | 4311 | MQTT → validate/normalise → WebSocket fan-out; forwards commands to MQTT |
| `dashboard` | `dashboard/` (Vite + React) | 5173 | Command Post UI |
| `ros` | `ros2/` (`ros:humble-ros-base`) | 8765 | Foxglove bridge + simulators + ROS↔MQTT bridge |

`docker-compose.override.yml` adds the `ros` service and is merged automatically.

---

## 2. What the simulation does (≈ 90 s loop)

| Actor | Behaviour |
|-------|-----------|
| **Writer** (`writer_sim_node`) | Drives an ellipse (4 × 3 m), publishes lidar, odometry, battery, diagnostics. **Injected faults:** lidar dies for 10 s every minute; battery drains and goes WARN < 30 %, ERROR < 15 %, then is "swapped" |
| **Fake ONA** (`parsed_targets_sim`) | `target_01` moves (stays LIVE) · `target_02` published 25 s then silent (ages → LOST) · `target_03` appears then disappears · `target_04` is an old report. Beacon **B-1** (victim) appears after 10 s, **B-2** (hazard) after 30 s |
| **Executor** (`executor_sim_node`) | Waits at home. On a mission it drives to the beacon at 0.7 m/s, inspects 4 s (`inspecting`), returns (`returning` → `standby`) |

### Try it

1. Open the dashboard. Pills should read `Link open`, `ONA / MQTT connected`.
2. Wait ~10 s for **B-1**, select it in *Beacons*, click **Send Executor to B-1**.
3. Mission goes `pending → active → done`; the Executor crosses the map (use *Follow → Executor*).
4. At `:21` of each minute the lidar fails: Writer shows `fault(lidar)` and a *sensor/hardware* event.

---

## 3. Data contracts

### MQTT topics (backend subscribes to `targets/#, robots/#, events/#, beacons/#, missions/#`)

| Topic | Payload (JSON) |
|-------|----------------|
| `targets/<id>` | `{id, pos:{x,y}, theta, ts, confidence, source, status, uncertainty:{sigmaX,sigmaY,angleDeg}}` |
| `robots/<id>` | `{id, pos:{x,y}, theta, batteryPct, state, source, ts}` |
| `events/<id>` | `{id, type: hazard|victim|obstacle|system, pos, severity: info|warn|critical, source, ts, note}` |
| `beacons/<id>` | `{id, pos, info, source, ts, status}` |
| `missions/<id>` | `{id, targetRobot, objective, target:{beaconId,pos}, status, updatedAt, ts}` |
| `cmd/<action>` | the dashboard command envelope (`assign-mission`, `cancel-mission`, `request-status`) |

Units: **metres in a local frame** (origin = Writer start). Time: ISO-8601 UTC **from the source**.
Full details: [`docs/ona-contract.md`](docs/ona-contract.md) · single source of truth: `shared/contract.js`.

### ROS 2 topics

| Topic | Type | Publisher → subscriber |
|-------|------|------------------------|
| `/ona/parsed_targets` | `std_msgs/String` (JSON) | Team 1's ONA parser (or `parsed_targets_sim`) → bridge, Foxglove |
| `/ona/beacons` | `std_msgs/String` (JSON) | ONA → bridge |
| `/odom` `/tf` `/scan` `/battery_state` `/diagnostics` | standard | Writer → bridge, Foxglove |
| `/executor/mission` | `std_msgs/String` (JSON) | bridge → Executor |
| `/executor/odom` `/executor/status` | `Odometry` / `String` | Executor → bridge, Foxglove |

`/ona/parsed_targets` accepts either local `x/y` or GPS `latitude/longitude`
(converted around the dashboard anchor), plus `target_id|id`, `timestamp|ts`,
`confidence`, `sigma_x`, `sigma_y`, `orientation`, `source`. Invalid messages are dropped, never fatal.

---

## 4. Staleness engine & uncertainty ellipses

`age = now − source timestamp` (the bridge **keeps the source timestamp**; it never replaces it with the receive time).

* **Status:** `LIVE` ≤ 5 s · `STALE` ≤ 15 s · `LOST` beyond (`shared/thresholds.js`, `VITE_LIVE_MS`, `VITE_STALE_MS`).
* **PoD decay** (spec §3): `PoD = confidence · exp(−λ · age)`, λ = 0.05 s⁻¹ (`VITE_DECAY_LAMBDA`).
* **Ellipse growth:** σ grows from σ₀ to 5 × σ₀ as the data ages (`VITE_ELLIPSE_GROWTH`), so old data is *visibly* less certain.
* **Re-Scout:** PoD < 0.25 (`VITE_RESCOUT_POD`) → `RE-SCOUT` badge/label.
* The browser recomputes every second, so a lost link still degrades data to STALE/LOST and the UI shows
  `LINK LOST — data frozen at …`.
* The **Critical** pill counts *unresolved* alerts only: events sharing a key (id without the `-<ms>` suffix)
  are resolved by a later `info` event (e.g. `lidar ERROR` → `back to OK`).

> `VITE_*` variables are read **at build time** — set them before `docker compose build dashboard`.

---

## 5. Debugging: robot problem or code problem?

The bridge tells them apart from two signals — `/diagnostics` (what the robot declares) and topic silence:

| What you see | Meaning | Where |
|--------------|---------|-------|
| `/diagnostics` ERROR on one part (e.g. `writer/lidar`) | Sensor / hardware fault declared by the robot | Dashboard state `fault(lidar)`, Foxglove Diagnostics |
| One topic silent > 3 s while the others flow | Sensor / hardware (`… silent while node alive -> sensor/hardware`) | Dashboard event |
| **All** topics silent | Node crashed or frozen → **software** (`node-down`) | Dashboard: Writer `node-down` and ageing to LOST |
| Data fine but behaviour wrong | Logic bug (TF, planning…) | Foxglove 3D / Raw Messages |

Simulate a frozen node (does not kill the container) and resume it:

```bash
docker compose exec ros bash -c "for p in /proc/[0-9]*; do grep -qa 'writer_sim_nod[e]' \$p/cmdline && kill -STOP \${p#/proc/}; done"
docker compose exec ros bash -c "for p in /proc/[0-9]*; do grep -qa 'writer_sim_nod[e]' \$p/cmdline && kill -CONT \${p#/proc/}; done"
```

### Foxglove

1. Open Foxglove → *Open connection* → *Foxglove WebSocket* → `ws://localhost:8765`.
2. Layout menu (top bar) → *Import from file…* → `foxglove/living_map_robot_health.json`.
3. Panels: 3D (lidar + Writer/Executor arrows), Diagnostics, battery/Executor plot, Raw Messages for
   `/executor/status`, `/ona/parsed_targets`, `/ona/beacons`, and the `/rosout` log.

---

## 6. Plugging in the real ONA / robots

1. Have Team 1's parser publish `/ona/parsed_targets` (JSON string for now). Disable the fake ONA:
   set `SIM_ONA: "0"` in the `ros` service environment. If the message becomes a custom ROS type,
   only `convert_target()` in `ros2/bridge_core.py` has to change.
2. Real broker: `MQTT_HOST` / `MQTT_PORT` for the bridge, `MQTT_URL` for the backend.
3. Real site: set `ANCHOR_LAT` / `ANCHOR_LON` (bridge) **and** `VITE_ANCHOR_LAT` / `VITE_ANCHOR_LON` (dashboard) to the same point.
4. Real Writer/Executor: publish the topics in §3; replace `writer_sim_node` / `executor_sim_node`.

### Environment variables

| Component | Variables |
|-----------|-----------|
| Bridge (`ros`) | `MQTT_HOST` (default `192.168.190.1`; compose sets `mosquitto`), `MQTT_PORT`, `ROBOT_ID`, `ANCHOR_LAT`, `ANCHOR_LON`, `SIM_ONA` |
| Backend | `MQTT_URL`, `WS_PORT`, `MQTT_TOPICS`, `CMD_TOPIC_PREFIX`, `HEARTBEAT_MS`, `SNAPSHOT_CAP` |
| Dashboard (build time) | `VITE_WS_URL`, `VITE_LIVE_MS`, `VITE_STALE_MS`, `VITE_DECAY_LAMBDA`, `VITE_ELLIPSE_GROWTH`, `VITE_RESCOUT_POD`, `VITE_ANCHOR_LAT`, `VITE_ANCHOR_LON` |

---

## 7. Repository map

```
backend/          Node.js: MQTT → WebSocket gateway (+ sim-publisher.js, JS-only dev simulator)
dashboard/src/    React UI: App.jsx, panels.jsx, OlMap.jsx (OpenStreetMap), MapCanvas.jsx (offline), staleness.js, wsClient.js
shared/           contract.js + thresholds.js (shared by backend and dashboard)
mosquitto/        broker config
ros2/             bridge_core.py, ros_mqtt_bridge.py, writer_sim_node.py, executor_sim_node.py,
                  executor_logic.py, parsed_targets_sim.py, entrypoint.sh, Dockerfile, tools/, tests/
foxglove/         Foxglove layout (JSON)
docs/             ona-contract.md
```

`ros2/tools/` holds the early MQTT-only test publishers (`vm_publisher.py`, `mock_publisher.py`) — handy to test the
dashboard without ROS.

---

## 8. Tests

| Suite | Command | Covers |
|-------|---------|--------|
| ROS 2 bridge | `cd ros2 && pip install pytest && python -m pytest tests` | target/beacon conversion, health tracker (sensor vs node-down), mission lifecycle, Executor model — 19 tests, no ROS needed |
| Backend | `cd backend && npm test` | contract, gateway, WS lifecycle, MQTT loopback (skips without a broker) |
| Dashboard | `cd dashboard && npm test` | staleness, PoD decay, ellipse growth, WS client (15 tests) |

The bridge was also exercised end to end: dashboard command → MQTT → bridge → Executor → mission `done`.

---

## 9. Run without Docker (development)

```bash
mosquitto -c mosquitto/mosquitto.conf                       # 1. broker
cd backend && npm i && npm start                            # 2. backend
cd dashboard && npm i && npm run dev                        # 3. dashboard → :5173
# 4. ROS 2 Humble (Ubuntu 22.04):
sudo apt install ros-humble-foxglove-bridge && pip3 install paho-mqtt
source /opt/ros/humble/setup.bash && cd ros2
python3 writer_sim_node.py & python3 executor_sim_node.py & python3 parsed_targets_sim.py &
MQTT_HOST=localhost python3 ros_mqtt_bridge.py &
ros2 launch foxglove_bridge foxglove_bridge_launch.xml
```

No ROS? `cd backend && npm run sim` is a pure-JS simulator that publishes straight to MQTT. Run exactly **one** simulator at a
time — two instances publish the same robot ids and robots appear to teleport.

---

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Dashboard empty, `Link open` | `docker compose logs ros` — bridge must print `MQTT connecte` and `1re cible recue` |
| Two brokers on port 1883 (Windows) | stop the local Mosquitto service: `net stop mosquitto` |
| Docker "Virtualization support not detected" | enable Virtual Machine Platform + Hypervisor Platform, `wsl --update` |
| Bridge restarts in a loop | `docker compose logs ros`; any process exiting restarts the container |
| `Address already in use` on 8765 | another `foxglove_bridge` is running (e.g. on the VM) — stop it |
| Foxglove can't connect from Windows to a VM | use the VM IP from `hostname -I`; test with `Test-NetConnection <ip> -Port 8765` |
| Changes not showing | rebuild: `docker compose up -d --build ros dashboard` (+ hard-refresh `Ctrl+F5`) |

---

## 11. Known limits / open questions

* `/ona/parsed_targets` is a **JSON string** until Team 1 fixes the final message type and fields.
* Targets and the Executor are simulated; the Executor drives in a straight line (no Nav2, no obstacle avoidance).
* Anonymous MQTT and open WebSocket: dev only — add auth/TLS before any real deployment.
* Dashboard uses OpenStreetMap tiles (internet); the offline grid is the fallback.
* Still to decide with the team: where the ONA / broker / backend run in the final setup, exact LIVE/STALE thresholds
  and λ, how communication failures are represented, how local coordinates map to GPS on the real site.

See also: `PLAN.md` (original plan) and `docs/ona-contract.md`.
