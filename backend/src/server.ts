import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { Server } from 'socket.io';

import { registerRoomHandlers } from './features/rooms/room-handlers.js';
import { AuthPresence } from './features/auth/auth-handlers.js';
import { readSessionId, SessionHttp } from './features/auth/session-http.js';
import { Storage } from './database/storage.js';
import { TypingPresence } from './features/typing/typing-handlers.js';
import { ClefSelector } from './features/emoji/clef.js';
import { EmojiEffects } from './features/emoji/handlers.js';
import { loadAiCredentials } from './ai-credentials.js';

const port = Number(process.env.PORT ?? 8080);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
const databasePath = resolve(
  process.cwd(),
  process.env.DATABASE_PATH ?? './data/talkmato.dev.sqlite',
);
// Only this process owns SQLite and authenticated socket state.
const storage = new Storage(databasePath);
const sessions = new SessionHttp(storage, {
  frontendOrigin,
  secureCookies: process.env.NODE_ENV === 'production',
  findSocket: (socketId) => io.sockets.sockets.get(socketId),
});
const httpServer = createServer((request, response) => {
  if (sessions.handle(request, response)) {
    return;
  }

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

const auth = new AuthPresence(io, storage);
const typing = new TypingPresence(io, storage);
const aiCredentials = await loadAiCredentials();
if (process.env.CLOUDFLARE_TOKEN_SECRET_VERSION && !aiCredentials.token) {
  console.warn('AI credentials are unavailable; core chat remains available.');
}
const emojiEffects = new EmojiEffects(storage, new ClefSelector(aiCredentials), {
  emitToUser: auth.emitToUser,
});
io.on('connection', (socket) => {
  auth.register(socket);
  registerRoomHandlers(socket, io, storage, {
    isOnline: auth.isOnline,
    toPublicUser: auth.toPublicUser,
    joinUserToRoom: auth.joinUserToRoom,
    emitToUser: auth.emitToUser,
    broadcastDirectories: auth.broadcastDirectories,
    clearTyping: typing.clearTyping,
  });
  typing.register(socket);
  emojiEffects.register(socket);
  const sessionId = readSessionId(socket.handshake.headers.cookie);
  const snapshot = sessionId === undefined ? undefined : auth.restoreSession(socket, sessionId);
  if (snapshot) {
    auth.broadcastDirectories();
  }
  // Always complete the browser's restore check so it never flashes a login form.
  socket.emit('auth.session', snapshot === undefined ? {} : { snapshot });
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
