// Public checks do not register accounts, write messages, or call the AI provider.
import { createConnection } from 'node:net';
import { io } from '../backend/node_modules/socket.io-client/build/esm/index.js';

const origin = 'https://talkmato.azther0z.online';
const ip = process.env.TALKMATO_PUBLIC_IP;
if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error('Expected the current VM public IPv4.');
const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000) });
if (!health.ok || (await health.json()).ok !== true) throw new Error('Public backend health failed.');
const page = await fetch(origin, { signal: AbortSignal.timeout(10000) });
if (!page.ok || !(await page.text()).includes('Talkmato')) throw new Error('Public frontend health failed.');

await new Promise((resolve, reject) => {
  const socket = io(origin, { autoConnect: false, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin } });
  const timer = setTimeout(() => finish(new Error('Public WebSocket handshake timed out.')), 10000);
  function finish(error) {
    clearTimeout(timer);
    socket.disconnect();
    if (error) reject(error); else resolve();
  }
  socket.on('auth.session', data => finish(data.snapshot ? new Error('Unexpected authenticated snapshot.') : undefined));
  socket.on('connect_error', () => finish(new Error('Public WebSocket handshake failed.')));
  socket.connect();
});

for (const port of [3000, 8080]) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: ip, port });
    socket.setTimeout(2500);
    socket.on('connect', () => { socket.destroy(); reject(new Error(`Internal port ${port} is publicly reachable.`)); });
    socket.on('timeout', () => { socket.destroy(); resolve(); });
    socket.on('error', () => resolve());
  });
}
console.log('Public HTTPS, frontend, unauthenticated WebSocket, and internal-port checks passed.');
