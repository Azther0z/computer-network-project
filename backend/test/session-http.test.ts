import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import { Storage } from '../src/database/storage.js';
import { readSessionId, SessionHttp } from '../src/features/auth/session-http.js';

async function setup(t: TestContext) {
  const storage = new Storage(':memory:');
  const user = storage.createUser({
    name: 'Alice',
    canonicalName: 'alice',
    passwordHash: 'synthetic-hash',
  });
  const origin = 'http://frontend.test';
  const sessions = new SessionHttp(storage, {
    frontendOrigin: origin,
    secureCookies: true,
    findSocket: (id) =>
      id === 'authenticated-socket'
        ? { connected: true, data: { actor: { userId: user.userId, name: user.name } } }
        : undefined,
  });
  const server = createServer((request, response) => {
    if (!sessions.handle(request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    storage.close();
  });
  return { storage, user, origin, url: `http://127.0.0.1:${address.port}` };
}

test('session HTTP requires the configured origin and a live authenticated socket', async (t) => {
  const { url, origin } = await setup(t);
  const forbidden = await fetch(`${url}/session`, {
    method: 'POST',
    headers: { origin: 'http://other.test' },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.has('set-cookie'), false);
  const guest = await fetch(`${url}/session`, { method: 'POST', headers: { origin } });
  assert.equal(guest.status, 401);
  assert.equal(guest.headers.has('set-cookie'), false);
  const unsupported = await fetch(`${url}/session`, { headers: { origin } });
  assert.equal(unsupported.status, 405);
  assert.equal((await fetch(`${url}/other`)).status, 404);
});

test('session HTTP sets an eight-hour private cookie and revokes its stored session on DELETE', async (t) => {
  const { storage, user, origin, url } = await setup(t);
  const created = await fetch(`${url}/session`, {
    method: 'POST',
    headers: { origin, 'x-talkmato-socket-id': 'authenticated-socket' },
  });
  assert.equal(created.status, 204);
  assert.equal(await created.text(), '');
  const cookie = created.headers.get('set-cookie');
  assert.ok(cookie);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=28800']) {
    assert.ok(cookie.includes(attribute));
  }
  const sessionId = readSessionId(cookie);
  assert.ok(sessionId);
  assert.equal(storage.findSessionUser(sessionId)?.userId, user.userId);
  const revoked = await fetch(`${url}/session`, { method: 'DELETE', headers: { origin, cookie } });
  assert.equal(revoked.status, 204);
  assert.ok(revoked.headers.get('set-cookie')?.includes('Max-Age=0'));
  assert.equal(storage.findSessionUser(sessionId), undefined);
});

test('session preflight returns credentialed CORS headers without creating a cookie', async (t) => {
  const { url, origin } = await setup(t);
  const response = await fetch(`${url}/session`, { method: 'OPTIONS' });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(response.headers.has('set-cookie'), false);
});
