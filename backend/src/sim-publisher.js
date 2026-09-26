// Dev-only stand-in for the ROS2->MQTT bridge. Looping scenario, self-healing:
// continuous motion every second, beacon/mission roster republished on change
// + 10 s heartbeat so backend restarts and late joiners converge.
// Run exactly ONE instance: npm run sim  (requires mosquitto; backend forwards to WS)
import mqtt from 'mqtt';
import { scenarioTick, signature } from './sim-scenario.js';

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
const HEARTBEAT_S = 10;
const id = `sim-${process.pid}`;
const c = mqtt.connect(url);
const t0 = Date.now();
const last = new Map(); // topic -> { sig, at }

c.on('connect', () => {
  console.log(`[${id}] connected ${url} — ensure no other sim instance is running`);
  setInterval(() => {
    const elapsed = (Date.now() - t0) / 1000;
    const { cycle, t, msgs } = scenarioTick(elapsed);
    if (Math.floor(elapsed) % 30 === 0) console.log(`[${id}] cycle ${cycle} t=${t}s`);
    for (const { topic, payload } of msgs) {
      const sig = signature(payload);
      const prev = last.get(topic);
      const nowS = Date.now() / 1000;
      if (!prev || prev.sig !== sig || nowS - prev.at >= HEARTBEAT_S) {
        c.publish(topic, JSON.stringify(payload));
        last.set(topic, { sig, at: nowS });
      }
    }
  }, 1000);
});

c.on('error', (e) => console.error(`[${id}] MQTT error: ${e.message} — is mosquitto running?`));
