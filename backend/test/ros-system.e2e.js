import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

function connect(url, protocol) {
  const socket = new WebSocket(url, protocol);
  const messages = [];
  socket.on('message', (bytes, binary) => {
    if (binary) messages.push({ binary: bytes });
    else messages.push(JSON.parse(bytes.toString()));
  });
  const opened = new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, messages, opened };
}
async function waitFor(messages, predicate, seconds = 50) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const value = messages.find(predicate);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Expected live ROS/Foxglove message not received');
}

test('Foxglove advertises live robot/sensor/network channels and streams ROS lidar data', { timeout: 60000 }, async t => {
  const fox = connect(process.env.FOXGLOVE_URL, ['foxglove.sdk.v1', 'foxglove.websocket.v1']);
  t.after(() => fox.socket.terminate());
  await fox.opened;
  assert.ok(['foxglove.sdk.v1','foxglove.websocket.v1'].includes(fox.socket.protocol));
  const channels = new Map();
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    for (const message of fox.messages) if (message.op === 'advertise') for (const channel of message.channels) channels.set(channel.topic, channel);
    if (['/scan', '/odom', '/battery_state', '/diagnostics', '/executor/status', '/network/beacons'].every(topic => channels.has(topic))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const topic of ['/scan','/odom','/battery_state','/diagnostics','/executor/status','/network/beacons']) assert.ok(channels.has(topic), topic);
  fox.socket.send(JSON.stringify({ op: 'subscribe', subscriptions: [{ id: 1, channelId: channels.get('/scan').id }] }));
  const packet = await waitFor(fox.messages, message => message.binary && message.binary[0] === 1 && message.binary.readUInt32LE(1) === 1, 25);
  assert.ok(packet.binary.length > 100, 'actual serialized LaserScan data');
  console.log(`Foxglove: ${channels.size} ROS channels; live LaserScan ${packet.binary.length} bytes`);
});

test('ROS writer beacon travels through authenticated network; dashboard assigns and cancels the ROS executor', { timeout: 120000 }, async t => {
  const dashboard = connect(process.env.DASHBOARD_URL.replace(/^http/,'ws') + '/ws');
  t.after(() => dashboard.socket.terminate());
  await dashboard.opened;
  function send(id, payload) { dashboard.socket.send(JSON.stringify({ kind:'cmd', id, ts:new Date().toISOString(), source:'dashboard', payload })); }
  send('ros-sync', {action:'sync'});
  const beacon = await waitFor(dashboard.messages, m => m.kind==='beacon' && Date.now()-Date.parse(m.payload.ts)<90000);
  await waitFor(dashboard.messages, m => m.kind==='telemetry' && m.payload.id==='writer');
  await waitFor(dashboard.messages, m => m.kind==='telemetry' && m.payload.id==='executor');
  send('ros-assign', {action:'assign-mission',beaconId:beacon.payload.id,objective:'Verify full ROS integration'});
  const pending = await waitFor(dashboard.messages, m => m.kind==='mission' && m.payload.target.beaconId===beacon.payload.id && m.payload.status==='pending');
  const missionId = pending.payload.id;
  await waitFor(dashboard.messages, m => m.kind==='mission' && m.payload.id===missionId && m.payload.status==='active');
  await waitFor(dashboard.messages, m => m.kind==='mission' && m.payload.id===missionId && m.payload.status==='done', 60);
  assert.ok(dashboard.messages.some(m => m.kind==='telemetry' && m.payload.id==='executor' && m.payload.state==='inspecting'), 'ROS executor inspected target');
  console.log(`ROS mission ${missionId}: pending -> active -> done at beacon ${beacon.payload.id}`);
  const previous = new Set(dashboard.messages.filter(m=>m.kind==='mission').map(m=>m.payload.id));
  send('ros-assign-cancel', {action:'assign-mission',beaconId:beacon.payload.id});
  const next = await waitFor(dashboard.messages, m=>m.kind==='mission'&&!previous.has(m.payload.id)&&m.payload.status==='active');
  send('ros-cancel', {action:'cancel-mission',missionId:next.payload.id});
  await waitFor(dashboard.messages,m=>m.kind==='mission'&&m.payload.id===next.payload.id&&m.payload.status==='cancelled');
  console.log(`ROS mission ${next.payload.id}: cancellation confirmed`);
});
