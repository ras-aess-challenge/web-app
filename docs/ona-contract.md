# ONA Contract (dashboard integration)

Flow: `ROS2 bridge -> MQTT -> backend -> WS -> dashboard`. Dashboard never talks to robots directly.

## MQTT in (backend subscribes)

- `targets/<id>`: `{ id, pos:{x,y}, theta?, ts(ISO), confidence, source, status, uncertainty:{sigmaX,sigmaY,angleDeg} }`
- `robots/<id>`, `events/<id>`, `beacons/<id>`, `missions/<id>`: `{ id, ts, ... }`
- Units: meters, local frame (origin = writer start). Time: ISO-8601 UTC from source.

## WebSocket (backend `WS_PORT`, default 4311)

Envelope: `{ kind: target|telemetry|event|beacon|mission|ona.status|cmd|cmd.ack, id, seq, ts, source, payload }`.
Unknown kinds dropped + counted. Dedupe by `id`.

## Commands (dashboard -> WS -> MQTT `cmd/<action>`)

`{ kind:'cmd', id, ts, source:'dashboard', payload:{ action:'assign-mission|cancel-mission|request-status', ... } }`
Backend replies `cmd.ack`. `payload:{action:'sync'}` requests snapshot replay.

## Env

- Backend: `MQTT_URL`, `WS_PORT`, `MQTT_TOPICS`, `CMD_TOPIC_PREFIX`
- Dashboard: `VITE_WS_URL`

## Local dev

1. `mosquitto -c mosquitto/mosquitto.conf` (or docker)
2. `cd backend && npm i && npm start` (second terminal: `npm run sim`)
3. `cd dashboard && npm i && npm run dev` -> http://localhost:5173
