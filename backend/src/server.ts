import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { Server } from 'socket.io';

import { Storage } from './storage.js';

const port = Number(process.env.PORT ?? 8080);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
const databasePath = resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/talkmato.dev.sqlite');

const storage = new Storage(databasePath);
const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404);
  response.end();
});

const io = new Server(httpServer, {
  path: '/socket.io',
  transports: ['websocket'],
  cors: { origin: frontendOrigin, methods: ['GET', 'POST'] },
  allowRequest: (request, accept) => accept(null, request.headers.origin === frontendOrigin),
});

io.on('connection', (socket) => {
  // Guitar adds auth.register/auth.login and binds socket.data.actor here.
  // Poom's future room handlers must require that authenticated actor.
  socket.on('disconnect', () => {
    // Guitar owns presence cleanup. Poom owns durable room/message state only.
  });
});

httpServer.listen(port, () => {
  console.log(`Talkmato backend listening on :${port}`);
});

function close(): void {
  io.close();
  httpServer.close();
  storage.close();
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
