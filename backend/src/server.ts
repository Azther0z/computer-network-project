import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { Server } from 'socket.io';

import { registerRoomHandlers } from './room-handlers.js';
import { AuthPresence } from './auth-handlers.js';
import { Storage } from './storage.js';
import { TypingPresence } from './typing-handlers.js';
import { ClefSelector } from './emoji/clef.js';
import { EmojiEffects } from './emoji/handlers.js';
import { loadAiCredentials } from './ai-credentials.js';

const port = Number(process.env.PORT ?? 8080);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
const databasePath = resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/talkmato.dev.sqlite');
const sessionTtlSeconds = 8 * 60 * 60;
const sessionCookieName = 'talkmato_session';

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function sessionCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function sessionCors(response: import('node:http').ServerResponse): void {
  response.setHeader('access-control-allow-origin', frontendOrigin);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('access-control-allow-methods', 'POST, DELETE, OPTIONS');
  response.setHeader('access-control-allow-headers', 'x-talkmato-socket-id');
}

const storage = new Storage(databasePath);
const httpServer = createServer((request, response) => {
  if (request.url === '/session' && request.method === 'OPTIONS') {
    sessionCors(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === '/session') {
    if (request.headers.origin !== frontendOrigin) {
      response.writeHead(403);
      response.end();
      return;
    }
    sessionCors(response);
    if (request.method === 'POST') {
      const socketId = request.headers['x-talkmato-socket-id'];
      const socket = typeof socketId === 'string' ? io.sockets.sockets.get(socketId) : undefined;
      const actor = socket?.data.actor;
      if (!socket?.connected || !actor) {
        response.writeHead(401);
        response.end();
        return;
      }
      const session = storage.createLoginSession(actor.userId, sessionTtlSeconds);
      response.setHeader('set-cookie', sessionCookie(session.sessionId, sessionTtlSeconds));
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'DELETE') {
      const sessionId = cookieValue(request.headers.cookie, sessionCookieName);
      if (sessionId) storage.deleteLoginSession(sessionId);
      response.setHeader('set-cookie', sessionCookie('', 0));
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(405);
    response.end();
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
const emojiEffects = new EmojiEffects(storage, new ClefSelector(aiCredentials), { emitToUser: auth.emitToUser });
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
  const sessionId = cookieValue(socket.handshake.headers.cookie, sessionCookieName);
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
