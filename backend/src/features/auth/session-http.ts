import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'socket.io';
import type { Storage } from '../../database/storage.js';

const SESSION_COOKIE_NAME = 'talkmato_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

type SessionConfiguration = {
  frontendOrigin: string;
  secureCookies: boolean;
  findSocket: (socketId: string) => Pick<Socket, 'connected' | 'data'> | undefined;
};

export function readSessionId(cookieHeader: string | undefined): string | undefined {
  const cookie = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return cookie?.slice(SESSION_COOKIE_NAME.length + 1);
}

/** The HTTP response sets the opaque cookie. Socket.IO never returns its value to JavaScript. */
export class SessionHttp {
  constructor(
    private readonly storage: Storage,
    private readonly configuration: SessionConfiguration,
  ) {}

  /** Return true only when this module owns the requested route. */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.url !== '/session') {
      return false;
    }
    if (request.method === 'OPTIONS') {
      this.setCorsHeaders(response);
      this.finish(response, 204);
      return true;
    }
    if (request.headers.origin !== this.configuration.frontendOrigin) {
      this.finish(response, 403);
      return true;
    }

    this.setCorsHeaders(response);
    switch (request.method) {
      case 'POST':
        this.createSession(request, response);
        break;
      case 'DELETE':
        this.revokeSession(request, response);
        break;
      default:
        this.finish(response, 405);
    }
    return true;
  }

  private createSession(request: IncomingMessage, response: ServerResponse): void {
    const socketId = request.headers['x-talkmato-socket-id'];
    const socket =
      typeof socketId === 'string' ? this.configuration.findSocket(socketId) : undefined;
    const actor = socket?.data.actor;
    if (!socket?.connected || !actor) {
      this.finish(response, 401);
      return;
    }
    const session = this.storage.createLoginSession(actor.userId, SESSION_TTL_SECONDS);
    response.setHeader('set-cookie', this.cookie(session.sessionId, SESSION_TTL_SECONDS));
    this.finish(response, 204);
  }

  private revokeSession(request: IncomingMessage, response: ServerResponse): void {
    const sessionId = readSessionId(request.headers.cookie);
    if (sessionId) {
      this.storage.deleteLoginSession(sessionId);
    }
    response.setHeader('set-cookie', this.cookie('', 0));
    this.finish(response, 204);
  }

  private cookie(value: string, maxAge: number): string {
    const secure = this.configuration.secureCookies ? '; Secure' : '';
    return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  private setCorsHeaders(response: ServerResponse): void {
    response.setHeader('access-control-allow-origin', this.configuration.frontendOrigin);
    response.setHeader('access-control-allow-credentials', 'true');
    response.setHeader('access-control-allow-methods', 'POST, DELETE, OPTIONS');
    response.setHeader('access-control-allow-headers', 'x-talkmato-socket-id');
  }

  private finish(response: ServerResponse, status: number): void {
    response.writeHead(status);
    response.end();
  }
}
