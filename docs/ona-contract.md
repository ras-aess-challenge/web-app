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

`{ kind:'cmd', id, ts, source:'dashboard', payload:{ action:'sync|assign-mission|cancel-mission|request-status', ... } }`
Allowed actions validated in `shared/contract.js`; invalid dropped + counted, never published to MQTT.
Backend replies `cmd.ack: { ackFor, status: received|synced, action?, count? }`.
`sync` replays snapshot (latest per id, cap 500) then ack; never republished to MQTT.
Dashboard shows PENDING until ack, NO ACK after 10s timeout. `ona.status` broadcast on connect.

## Env

- Backend: `MQTT_URL`, `WS_PORT`, `MQTT_TOPICS`, `CMD_TOPIC_PREFIX`, `HEARTBEAT_MS` (default 15000), `SNAPSHOT_CAP` (default 500)
- Dashboard: `VITE_WS_URL`, `VITE_LIVE_MS` (default 5000), `VITE_STALE_MS` (default 15000)

## Resilience

- Backend broadcasts `ona.status` on connect + every `HEARTBEAT_MS` (`{ ona: connected|disconnected, dropped, heartbeat, uptimeS, tracked }`). MQTT `close` flips `ona` to `disconnected`.
- Dashboard freezes UI on WS close with `LINK LOST — data frozen at <lastMsgAt>`, backoff reconnect, `sync` replay with dedupe by `id`.
- Invalid/unknown messages dropped + counted, never crash UI.

## Production (real ONA)

1. Stop sim: don't run `npm run sim`.
2. Point backend at real broker: `MQTT_URL=mqtt://<ona-broker>:1883 npm start`.
3. Point dashboard at backend: `VITE_WS_URL=ws://<backend-host>:4311 npm run dev` (or build + serve `dist/`).
4. Tune staleness without code change: `VITE_LIVE_MS`, `VITE_STALE_MS`.

## Local dev

1. `mosquitto -c mosquitto/mosquitto.conf` (or docker)
2. `cd backend && npm i && npm start` (second terminal: `npm run sim`)
3. `cd dashboard && npm i && npm run dev` -> http://localhost:5173
