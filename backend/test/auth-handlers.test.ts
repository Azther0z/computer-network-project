import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { verify } from 'argon2';
import { AuthPresence } from '../src/auth-handlers.js';
import { registerRoomHandlers } from '../src/room-handlers.js';
import { Storage } from '../src/storage.js';
import { TypingPresence } from '../src/typing-handlers.js';

async function setup(t: TestContext) {
  const storage = new Storage(':memory:');
  const http = createServer();
  const io = new Server(http, { transports: ['websocket'] });
  const auth = new AuthPresence(io, storage);
  const typing = new TypingPresence(io, storage);
  io.on('connection', socket => {
    auth.register(socket);
    registerRoomHandlers(socket, io, storage, { ...auth, clearTyping: typing.clearTyping });
    typing.register(socket);
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  const clients: Socket[] = [];
  t.after(async () => {
    clients.forEach(client => client.disconnect());
    await new Promise<void>(resolve => io.close(() => resolve()));
    storage.close();
  });
  async function client() {
    const socket = connect(`http://127.0.0.1:${port}`, {
      transports: ['websocket'], reconnection: false, forceNew: true,
    });
    clients.push(socket);
    await new Promise<void>(resolve => socket.once('connect', resolve));
    return socket;
  }
  return { storage, io, auth, client };
}

async function command(socket: Socket, event: string, payload: unknown = {}) {
  return socket.timeout(5000).emitWithAck(event, payload);
}

function socketEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise(resolve => socket.once(event, resolve));
}
const credentials = { name: 'Alice', password: 'test-password' };

test('register commits an Argon2id account, binds actor and returns public self/online snapshot', async t => {
  const { storage, io, client } = await setup(t);
  const alice = await client();
  const result = await command(alice, 'auth.register', { ...credentials, name: '  Alice  ' });
  assert.equal(result.ok, true);
  const self = result.data.snapshot.self;
  assert.deepEqual(self, { userId: self.userId, name: 'Alice', online: true });
  assert.deepEqual(io.sockets.sockets.get(alice.id!)?.data.actor, { userId: self.userId, name: 'Alice' });
  assert.deepEqual(result.data.snapshot.users, [self]);
  const saved = storage.getUser(self.userId)!;
  assert.match(saved.passwordHash, /^\$argon2id\$/);
  assert.equal(await verify(saved.passwordHash, credentials.password), true);
  assert.equal(JSON.stringify(result).includes('password'), false);
});

test('canonical duplicate names including NFC equivalents are rejected even while offline', async t => {
  const { client } = await setup(t);
  const alice = await client();
  assert.equal((await command(alice, 'auth.register', { ...credentials, name: ' Éclair ' })).ok, true);
  await command(alice, 'auth.logout');
  const duplicate = await command(alice, 'auth.register', { ...credentials, name: 'e\u0301CLAIR' });
  assert.equal(duplicate.error.code, 'NAME_TAKEN');
});

test('unknown account and incorrect password have identical generic errors', async t => {
  const { client } = await setup(t);
  const alice = await client();
  await command(alice, 'auth.register', credentials);
  await command(alice, 'auth.logout');
  const wrong = await command(alice, 'auth.login', { ...credentials, password: 'wrong-password' });
  const unknown = await command(alice, 'auth.login', { ...credentials, name: 'Unknown' });
  assert.deepEqual(wrong, unknown);
  assert.equal(wrong.error.code, 'INVALID_CREDENTIALS');
});

test('second active login is rejected; logout permits sign-in and removes room delivery access', async t => {
  const { client, io, storage } = await setup(t);
  const alice = await client();
  const other = await client();
  const registered = await command(alice, 'auth.register', credentials);
  const id = registered.data.snapshot.self.userId;
  const created = await command(alice, 'group.create', { name: 'Saved group' });
  const roomId = created.data.group.roomId;
  assert.equal((await command(other, 'auth.login', credentials)).error.code, 'SESSION_IN_USE');
  assert.equal((await command(alice, 'auth.login', credentials)).error.code, 'ALREADY_AUTHENTICATED');
  await command(alice, 'auth.logout');
  assert.equal(io.sockets.sockets.get(alice.id!)?.data.actor, undefined);
  assert.equal(io.sockets.sockets.get(alice.id!)?.rooms.has(`room:${roomId}`), false);
  assert.ok(storage.getUser(id));
  for (const event of ['private.open', 'group.create', 'group.join', 'room.send', 'room.history']) {
    assert.equal((await command(alice, event, { roomId })).error.code, 'NOT_AUTHENTICATED');
  }
  const loggedIn = await command(other, 'auth.login', { ...credentials, name: ' ALICE ' });
  assert.equal(loggedIn.ok, true);
  assert.deepEqual(io.sockets.sockets.get(other.id!)?.data.actor, { userId: id, name: 'Alice' });
  assert.ok(io.sockets.sockets.get(other.id!)?.rooms.has(`room:${roomId}`));
});

test('disconnect updates authenticated directories only and preserves rooms, messages and memberships', async t => {
  const { client, io, storage, auth } = await setup(t);
  const alice = await client();
  const observer = await client();
  const guest = await client();
  let guestEvents = 0;
  guest.on('users.snapshot', () => guestEvents++);
  const a = await command(alice, 'auth.register', credentials);
  const b = await command(observer, 'auth.register', { ...credentials, name: 'Bob' });
  const aliceId = a.data.snapshot.self.userId;
  const bobId = b.data.snapshot.self.userId;
  const room = storage.findOrCreatePrivateRoom(aliceId, bobId);
  const group = storage.createGroup(aliceId, 'Public group');
  storage.sendMessage({ senderId: aliceId, roomId: room.roomId, text: 'Saved', clientMessageId: 'saved' });
  const disconnected = once(io.sockets.sockets.get(alice.id!)!, 'disconnect');
  const presence = new Promise<{ users: { name: string }[] }>(resolve => observer.once('users.snapshot', resolve));
  alice.disconnect();
  await disconnected;
  const snapshot = await presence;
  assert.deepEqual(snapshot.users.map((u: { name: string }) => u.name), ['Bob']);
  assert.equal(auth.isOnline(aliceId), false);
  assert.equal(guestEvents, 0);
  assert.equal(storage.loadHistory({ actorId: aliceId, roomId: room.roomId }).messages.length, 1);
  const returned = await client();
  const login = await command(returned, 'auth.login', credentials);
  assert.equal(login.ok, true);
  assert.equal(login.data.snapshot.privateRooms[0].roomId, room.roomId);
  assert.equal(login.data.snapshot.groups[0].roomId, group.roomId);
  assert.equal(login.data.snapshot.groups[0].members[0].userId, aliceId);
});

test('snapshots show public offline members but exclude unrelated private rooms', async t => {
  const { client, storage } = await setup(t);
  const alice = await client();
  const a = await command(alice, 'auth.register', credentials);
  const id = a.data.snapshot.self.userId;
  const bob = storage.createUser({ name: 'Bob', canonicalName: 'bob', passwordHash: 'fixture' });
  const charlie = storage.createUser({ name: 'Charlie', canonicalName: 'charlie', passwordHash: 'fixture' });
  storage.findOrCreatePrivateRoom(bob.userId, charlie.userId);
  const shared = storage.findOrCreatePrivateRoom(id, bob.userId);
  const group = storage.createGroup(bob.userId, 'Everyone can see metadata');
  await command(alice, 'auth.logout');
  const login = await command(alice, 'auth.login', credentials);
  assert.deepEqual(login.data.snapshot.privateRooms.map((r: {roomId: string}) => r.roomId), [shared.roomId]);
  assert.deepEqual(login.data.snapshot.groups, [{ roomId: group.roomId, kind: 'group', name: group.name,
    members: [{ userId: bob.userId, name: 'Bob', online: false }] }]);
  assert.equal(JSON.stringify(login).includes('passwordHash'), false);
});

test('invalid payloads and Unicode controls are rejected; names count code points', async t => {
  const { client } = await setup(t);
  const socket = await client();
  for (const payload of [null, [], {}, { ...credentials, name: '\u0000Alice' },
    { ...credentials, name: 'a'.repeat(33) }, { ...credentials, password: 'short' },
    { ...credentials, password: 'a'.repeat(129) }]) {
    assert.equal((await command(socket, 'auth.register', payload)).error.code, 'INVALID_PAYLOAD');
  }
  assert.equal((await command(socket, 'auth.register', { ...credentials, name: '🍅'.repeat(32) })).ok, true);
});

test('simultaneous canonical registrations produce exactly one account and one success', async t => {
  const { client } = await setup(t);
  const a = await client();
  const b = await client();
  const results = await Promise.all([command(a, 'auth.register', credentials), command(b, 'auth.register', credentials)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok).error.code, 'NAME_TAKEN');
});

test('concurrent valid logins cannot both claim an offline account', async t => {
  const { client } = await setup(t);
  const owner = await client();
  await command(owner, 'auth.register', credentials);
  await command(owner, 'auth.logout');
  const peer = await client();
  const results = await Promise.all([command(owner, 'auth.login', credentials), command(peer, 'auth.login', credentials)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok).error.code, 'SESSION_IN_USE');
});

test('disconnect during password hashing cannot bind a ghost user or commit registration', async t => {
  const { client, io, auth, storage } = await setup(t);
  const socket = await client();
  const server = io.sockets.sockets.get(socket.id!)!;
  const received = new Promise<void>(resolve => server.once('auth.register', () => {
    server.disconnect(true);
    resolve();
  }));
  socket.emit('auth.register', credentials, () => {});
  await received;
  // Wait for all work on the native hash worker pool to finish, without a timing-based sleep.
  const { hash, argon2id } = await import('argon2');
  await Promise.all(Array.from({ length: 8 }, () => hash('worker-barrier', { type: argon2id })));
  assert.equal(server.data.actor, undefined);
  assert.equal(auth.activeSocketByUserId.size, 0);
  assert.equal(storage.findUserByCanonicalName('alice'), undefined);
});

test('opening a new private room joins both live participants and delivers to both', async t => {
  const { client } = await setup(t);
  const alice = await client();
  const bob = await client();
  const aliceLogin = await command(alice, 'auth.register', credentials);
  const bobLogin = await command(bob, 'auth.register', { ...credentials, name: 'Bob' });
  assert.equal(aliceLogin.ok, true);
  assert.equal(bobLogin.ok, true);
  if (!aliceLogin.ok || !bobLogin.ok) return;

  const privateOpenedForBob = socketEvent<{ room: { roomId: string } }>(bob, 'private.opened');
  const opened = await command(alice, 'private.open', { peerId: bobLogin.data.snapshot.self.userId });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const roomId = opened.data.room.roomId as string;
  const privateEvent = await privateOpenedForBob;
  assert.equal(privateEvent.room.roomId, roomId);

  const deliveredToAlice = socketEvent<{ messageId: string; roomId: string }>(alice, 'message.created');
  const deliveredToBob = socketEvent<{ messageId: string; roomId: string }>(bob, 'message.created');
  const sent = await command(alice, 'room.send', {
    roomId, clientMessageId: 'private-live-delivery', text: 'Hello Bob',
  });
  assert.equal(sent.ok, true);
  const [aliceMessage, bobMessage] = await Promise.all([deliveredToAlice, deliveredToBob]);
  assert.equal(aliceMessage.roomId, roomId);
  assert.equal(bobMessage.messageId, aliceMessage.messageId);
});

test('creating and joining groups refreshes the authenticated group directory', async t => {
  const { client } = await setup(t);
  const alice = await client();
  const bob = await client();
  await command(alice, 'auth.register', credentials);
  await command(bob, 'auth.register', { ...credentials, name: 'Bob' });

  const visibleToBob = socketEvent<{ groups: Array<{ roomId: string; members: unknown[] }> }>(bob, 'groups.snapshot');
  const created = await command(alice, 'group.create', { name: 'Study group' });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const roomId = created.data.group.roomId as string;
  const directoryAfterCreate = await visibleToBob;
  assert.equal(directoryAfterCreate.groups.find(group => group.roomId === roomId)?.members.length, 1);

  const visibleToAlice = socketEvent<{ groups: Array<{ roomId: string; members: unknown[] }> }>(alice, 'groups.snapshot');
  const joined = await command(bob, 'group.join', { roomId });
  assert.equal(joined.ok, true);
  const directoryAfterJoin = await visibleToAlice;
  assert.equal(directoryAfterJoin.groups.find(group => group.roomId === roomId)?.members.length, 2);
});

test('typing is room-scoped, member-only and clears explicitly', async t => {
  const { client } = await setup(t);
  const alice = await client();
  const bob = await client();
  const charlie = await client();
  const aliceLogin = await command(alice, 'auth.register', credentials);
  const bobLogin = await command(bob, 'auth.register', { ...credentials, name: 'Bob' });
  await command(charlie, 'auth.register', { ...credentials, name: 'Charlie' });
  assert.equal(aliceLogin.ok, true);
  assert.equal(bobLogin.ok, true);
  if (!aliceLogin.ok || !bobLogin.ok) return;
  const opened = await command(alice, 'private.open', { peerId: bobLogin.data.snapshot.self.userId });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const roomId = opened.data.room.roomId as string;

  const shownToBob = socketEvent<{ roomId: string; isTyping: boolean }>(bob, 'typing.updated');
  assert.equal((await command(alice, 'typing.set', { roomId, isTyping: true })).ok, true);
  assert.deepEqual(await shownToBob, { roomId, userId: aliceLogin.data.snapshot.self.userId, isTyping: true, expiresInMs: 3_000 });
  assert.equal((await command(charlie, 'typing.set', { roomId, isTyping: true })).error.code, 'NOT_MEMBER');

  const clearedForBob = socketEvent<{ roomId: string; isTyping: boolean }>(bob, 'typing.updated');
  assert.equal((await command(alice, 'typing.set', { roomId, isTyping: false })).ok, true);
  assert.equal((await clearedForBob).isTyping, false);
});

test('an unexpired server session restores a new socket without browser-held credentials', async t => {
  const { client, io, auth, storage } = await setup(t);
  const alice = await client();
  const registered = await command(alice, 'auth.register', credentials);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  const room = storage.createGroup(registered.data.snapshot.self.userId, 'Saved group');
  const session = storage.createLoginSession(registered.data.snapshot.self.userId, 8 * 60 * 60);
  const disconnected = once(io.sockets.sockets.get(alice.id!)!, 'disconnect');
  alice.disconnect();
  await disconnected;

  const returned = await client();
  const serverSocket = io.sockets.sockets.get(returned.id!)!;
  const restored = auth.restoreSession(serverSocket, session.sessionId);
  assert.equal(restored?.self.userId, registered.data.snapshot.self.userId);
  assert.ok(serverSocket.rooms.has(`room:${room.roomId}`));
  assert.equal(auth.isOnline(registered.data.snapshot.self.userId), true);
});

test('account deletion revokes access, anonymizes prior messages and frees the name', async t => {
  const { client, storage } = await setup(t);
  const alice = await client();
  const bob = await client();
  const aliceLogin = await command(alice, 'auth.register', credentials);
  const bobLogin = await command(bob, 'auth.register', { ...credentials, name: 'Bob' });
  assert.equal(aliceLogin.ok, true);
  assert.equal(bobLogin.ok, true);
  if (!aliceLogin.ok || !bobLogin.ok) return;
  const room = await command(alice, 'private.open', { peerId: bobLogin.data.snapshot.self.userId });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const roomId = room.data.room.roomId as string;
  await command(alice, 'room.send', { roomId, clientMessageId: 'before-deletion', text: 'Keep this message' });
  const session = storage.createLoginSession(aliceLogin.data.snapshot.self.userId, 60 * 60);

  const deleted = await command(alice, 'auth.deleteAccount', { password: credentials.password });
  assert.equal(deleted.ok, true);
  assert.equal(storage.getUser(aliceLogin.data.snapshot.self.userId), undefined);
  assert.equal(storage.findSessionUser(session.sessionId), undefined);
  const history = await command(bob, 'room.history', { roomId });
  assert.equal(history.ok, true);
  if (!history.ok) return;
  assert.equal((history.data.messages as Array<{ senderName: string }>)[0]?.senderName, '<Unknown>');

  const replacement = await client();
  assert.equal((await command(replacement, 'auth.register', credentials)).ok, true);
});
