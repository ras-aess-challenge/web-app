// Dev-only stand-in for the ROS2->MQTT bridge. Full Writer/Executor scenario.
// Run: npm run sim  (requires mosquitto; backend forwards to WS)
import mqtt from 'mqtt';

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
const c = mqtt.connect(url);
const t0 = Date.now();
let step = 0;
let missionPhase = 0;

c.on('connect', () => {
  console.log(`[sim] connected ${url}`);
  setInterval(() => {
    step++;
    const t = (Date.now() - t0) / 1000;
    const now = new Date().toISOString();
    // Writer lawnmower path
    const wx = -6 + (step % 40) * 0.35;
    const wy = 2 * Math.sin(t * 0.4) + Math.floor(step / 40) % 4;
    c.publish('robots/writer', JSON.stringify({
      id: 'writer', pos: { x: +wx.toFixed(2), y: +wy.toFixed(2) }, theta: 0.3,
      batteryPct: Math.max(20, 95 - step * 0.2), state: 'exploring', source: 'writer', ts: now,
    }));
    c.publish('targets/T-01', JSON.stringify({
      id: 'T-01', pos: { x: +wx.toFixed(2), y: +(wy + 1).toFixed(2) }, theta: 0,
      ts: now, confidence: 0.75, source: 'writer', status: 'tracked',
      uncertainty: { sigmaX: 1.2, sigmaY: 0.7, angleDeg: 30 },
    }));
    // Executor idle until mission active, then drives to beacon B-1
    missionPhase = step > 25 ? 1 : 0;
    const ex = missionPhase ? Math.min(2.5, -4 + step * 0.08) : -4;
    c.publish('robots/executor', JSON.stringify({
      id: 'executor', pos: { x: +ex.toFixed(2), y: -2 }, theta: missionPhase ? 0 : 1.57,
      batteryPct: 88, state: missionPhase ? 'en-route' : 'standby', source: 'executor', ts: now,
    }));
    if (step === 15) {
      c.publish('events/evt-15', JSON.stringify({
        id: 'evt-15', type: 'hazard', pos: { x: +wx.toFixed(2), y: +wy.toFixed(2) },
        severity: 'warn', source: 'writer', ts: now, note: 'sim: debris',
      }));
      c.publish('beacons/B-1', JSON.stringify({
        id: 'B-1', pos: { x: +wx.toFixed(2), y: +wy.toFixed(2) },
        info: 'hazard debris — inherited spatial memory', source: 'writer', ts: now, status: 'active',
      }));
    }
    if (step === 25) {
      c.publish('missions/M-1', JSON.stringify({
        id: 'M-1', targetRobot: 'executor', objective: 'Inspect beacon B-1',
        target: { beaconId: 'B-1', pos: { x: 2.5, y: -1 } },
        status: 'active', updatedAt: now, ts: now,
      }));
    }
    if (step === 60) {
      c.publish('missions/M-1', JSON.stringify({
        id: 'M-1', targetRobot: 'executor', objective: 'Inspect beacon B-1',
        target: { beaconId: 'B-1' }, status: 'done', updatedAt: now, ts: now,
      }));
    }
  }, 1000);
});
