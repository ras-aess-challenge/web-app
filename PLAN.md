# The Living Map — Command Post Plan (JS-only)

Greenfield repo. Stack: Vite + React (plain JS) + Node.js backend + Mosquitto MQTT.

## Architecture

```
ROS2 -> [ROS2->MQTT bridge: NOT us] -> Mosquitto
  -> backend/ (Node.js: subscribe, normalize, staleness assist, WS broadcast)
  -> dashboard/ (Vite + React: ws-client, store, staleness engine, Canvas map)
```

No Astro, no TypeScript, no Next.js. JS-only (.js + JSDoc).

## Ownership

- Dashboard: render, WS client, local staleness classification, Canvas map, command emission.
- Backend (ONA app layer): MQTT subscribe, normalize/validate, add serverRxAt, WS fan-out, cmd MQTT publish, snapshot on sync.
- ROS2 team: SLAM/nav/CV, beacon hardware, mission execution, ROS2->MQTT bridge.

## Data contract

See shared/contract.js (single source of truth) and docs/ona-contract.md.
Envelope: { kind, id, seq, ts, source, payload }.
Target: { id, pos:{x,y}, theta, ts, confidence, source, status, uncertainty:{sigmaX,sigmaY,angleDeg} }.
Thresholds in shared/thresholds.js: LIVE_MS, STALE_MS (team-tunable).

## Staleness

age = Date.now() - last_update. Backend stamps serverRxAt + computedState; frontend recomputes on 1s ticker so disconnect still degrades to STALE/LOST.

## Map

Local XY meters, Canvas 2D. Target dot + id + ellipse(ctx.ellipse, k=2). Layers toggles. No GPS libs.

## Phases

1. Vertical slice: sim MQTT -> backend -> WS -> React dot + LIVE label. (this build)
2. Full panels + event/beacon/mission + MapCanvas polish.
3. Commands dashboard->MQTT.
4. Resilience + docs + tests.
