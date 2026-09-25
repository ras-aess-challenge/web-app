# The Living Map — Command Post (JS-only)

Vite+React dashboard + Node.js MQTT->WS backend. See PLAN.md and docs/ona-contract.md.

## Quickstart (local)

1. `mosquitto -c mosquitto/mosquitto.conf`
2. `cd backend && npm i && npm start` (+ `npm run sim` in a second terminal for fake ROS bridge)
3. `cd dashboard && npm i && npm run dev` -> http://localhost:5173

## Tests

- Backend `cd backend && npm test` — 17 tests: contract, gateway, WS lifecycle
  (connect/status, sync replay, cmd ack/forward, disconnect/reconnect idempotency),
  live MQTT loopback (skips cleanly when no broker at `MQTT_URL`).
- Dashboard `cd dashboard && npm test` — 10 vitest tests: staleness
  classification/boundaries/`targetAge` fallback, WS client sync-on-open,
  dedupe/malformed drop, reconnect backoff.

## Docker

`docker compose up --build` (mosquitto :1883, backend :4311, dashboard :5173). Copy `.env.example` to `.env` to tune.

## Production

Stop `npm run sim`. Set `MQTT_URL` to the real broker and `VITE_WS_URL` to the backend. Tune `VITE_LIVE_MS`/`VITE_STALE_MS`, `HEARTBEAT_MS`, `SNAPSHOT_CAP` without code changes.

Simulator `backend/src/sim-publisher.js` is dev-only stand-in for the ROS2->MQTT bridge.
