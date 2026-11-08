import assert from 'node:assert/strict';
import test from 'node:test';

import { registerRoomHandlers } from '../src/features/rooms/room-handlers.js';
import { Storage } from '../src/database/storage.js';
import type { AuthenticatedActor } from '../src/lib/types.js';

type AckResponse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string } };

class FakeSocket {
  data: { actor?: AuthenticatedActor } = {};
  readonly joins: string[] = [];
  private readonly listeners = new Map<string, (...args: unknown[]) => void>();

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, listener);
  }

  join(channel: string): void {
    this.joins.push(channel);
  }

  trigger(event: string, payload: unknown): AckResponse {
    let result: AckResponse | undefined;
    const listener = this.listeners.get(event);
    assert.ok(listener, `Expected ${event} listener to be registered.`);
    listener(payload, (response: AckResponse) => {
      result = response;
    });
    assert.ok(result, `Expected ${event} acknowledgement.`);
    return result;
  }
}

class FakeIo {
  readonly emissions: Array<{ channel: string; event: string; payload: unknown }> = [];

  to(channel: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emissions.push({ channel, event, payload });
      },
    };
  }
}

function setup() {
  const storage = new Storage(':memory:');
  const passwordHash = '$argon2id$test-fixture-not-a-real-password-hash';
  const alice = storage.createUser({ name: 'Alice', canonicalName: 'alice', passwordHash });
  const bob = storage.createUser({ name: 'Bob', canonicalName: 'bob', passwordHash });
  const charlie = storage.createUser({ name: 'Charlie', canonicalName: 'charlie', passwordHash });
  const io = new FakeIo();
  const dependencies = {
    isOnline: (userId: string) => userId === alice.userId || userId === bob.userId,
    toPublicUser: (user: { userId: string; name: string }) => ({ ...user, online: true }),
  };

  return { storage, io, dependencies, alice, bob, charlie };
}

test('room commands reject an unauthenticated socket', (t) => {
  const { storage, io, dependencies, bob } = setup();
  t.after(() => storage.close());
  const socket = new FakeSocket();
  registerRoomHandlers(socket, io, storage, dependencies);

  const result = socket.trigger('private.open', { peerId: bob.userId });
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'NOT_AUTHENTICATED', message: 'Sign in before using chat.' },
  });
});

test('authenticated user opens a private room and emits a committed message once', (t) => {
  const { storage, io, dependencies, alice, bob } = setup();
  t.after(() => storage.close());
  const socket = new FakeSocket();
  socket.data.actor = { userId: alice.userId, name: alice.name };
  registerRoomHandlers(socket, io, storage, dependencies);

  const opened = socket.trigger('private.open', { peerId: bob.userId });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const room = opened.data.room as { roomId: string; members: Array<{ userId: string }> };
  assert.deepEqual(
    room.members.map((member) => member.userId).sort(),
    [alice.userId, bob.userId].sort(),
  );
  assert.deepEqual(socket.joins, [`room:${room.roomId}`]);

  const sent = socket.trigger('room.send', {
    roomId: room.roomId,
    clientMessageId: 'client-message-1',
    text: 'Hello Bob',
  });
  assert.equal(sent.ok, true);
  assert.equal(io.emissions.length, 1);
  assert.equal(io.emissions[0]?.channel, `room:${room.roomId}`);
  assert.equal(io.emissions[0]?.event, 'message.created');

  const retried = socket.trigger('room.send', {
    roomId: room.roomId,
    clientMessageId: 'client-message-1',
    text: 'Hello Bob',
  });
  assert.equal(retried.ok, true);
  assert.equal(io.emissions.length, 1, 'manual retry must not broadcast a duplicate');
});

test('group join handler preserves the storage history boundary', (t) => {
  const { storage, io, dependencies, alice, bob } = setup();
  t.after(() => storage.close());

  const aliceSocket = new FakeSocket();
  aliceSocket.data.actor = { userId: alice.userId, name: alice.name };
  registerRoomHandlers(aliceSocket, io, storage, dependencies);
  const created = aliceSocket.trigger('group.create', { name: 'Study' });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const group = created.data.group as { roomId: string };

  aliceSocket.trigger('room.send', {
    roomId: group.roomId,
    clientMessageId: 'before-bob',
    text: 'Before Bob joins',
  });

  const bobSocket = new FakeSocket();
  bobSocket.data.actor = { userId: bob.userId, name: bob.name };
  registerRoomHandlers(bobSocket, io, storage, dependencies);
  const joined = bobSocket.trigger('group.join', { roomId: group.roomId });
  assert.equal(joined.ok, true);

  aliceSocket.trigger('room.send', {
    roomId: group.roomId,
    clientMessageId: 'after-bob',
    text: 'After Bob joins',
  });
  const history = bobSocket.trigger('room.history', { roomId: group.roomId });
  assert.equal(history.ok, true);
  if (!history.ok) return;
  const messages = history.data.messages as Array<{ text: string }>;
  assert.deepEqual(messages.map((message) => message.text), ['After Bob joins']);
});

test('private rooms cannot be joined as groups', (t) => {
  const { storage, io, dependencies, alice, bob } = setup();
  t.after(() => storage.close());
  const room = storage.findOrCreatePrivateRoom(alice.userId, bob.userId);
  const socket = new FakeSocket();
  socket.data.actor = { userId: alice.userId, name: alice.name };
  registerRoomHandlers(socket, io, storage, dependencies);

  const result = socket.trigger('group.join', { roomId: room.roomId });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'WRONG_ROOM_TYPE');
});

test('group and message limits count Unicode code points at both boundaries', (t) => {
  const { storage, io, dependencies, alice } = setup();
  t.after(() => storage.close());
  const socket = new FakeSocket();
  socket.data.actor = { userId: alice.userId, name: alice.name };
  registerRoomHandlers(socket, io, storage, dependencies);
  const group = socket.trigger('group.create', { name: '🍅'.repeat(64) });
  assert.equal(group.ok, true);
  if (!group.ok) return;
  const { roomId } = group.data.group as { roomId: string };
  assert.equal(socket.trigger('group.create', { name: '🍅'.repeat(65) }).ok, false);
  const send = (text: string, clientMessageId: string) => socket.trigger('room.send', { roomId, text, clientMessageId });
  assert.equal(send('🍅'.repeat(4000), 'valid-unicode').ok, true);
  assert.equal(send('🍅'.repeat(4001), 'too-long-unicode').ok, false);
  assert.equal(send(' '.repeat(10), 'blank').ok, false);
  const history = socket.trigger('room.history', { roomId });
  assert.equal(history.ok, true);
  if (history.ok) assert.equal((history.data.messages as unknown[]).length, 1);
});

test('every older history page enforces the permanent group join boundary', (t) => {
  const { storage, io, dependencies, alice, bob } = setup();
  t.after(() => storage.close());
  const group = storage.createGroup(alice.userId, 'History');
  storage.sendMessage({ senderId: alice.userId, roomId: group.roomId, clientMessageId: 'hidden', text: 'Before join' });
  storage.joinGroup(bob.userId, group.roomId);
  for (let index = 0; index < 65; index++) {
    storage.sendMessage({ senderId: alice.userId, roomId: group.roomId, clientMessageId: `visible-${index}`, text: `After join ${index}` });
  }
  const socket = new FakeSocket();
  socket.data.actor = { userId: bob.userId, name: bob.name };
  registerRoomHandlers(socket, io, storage, dependencies);
  let beforeSeq: number | undefined;
  const texts: string[] = [];
  do {
    const response = socket.trigger('room.history', { roomId: group.roomId, limit: 20, ...(beforeSeq ? { beforeSeq } : {}) });
    assert.equal(response.ok, true);
    if (!response.ok) return;
    texts.push(...(response.data.messages as { text: string }[]).map(message => message.text));
    beforeSeq = response.data.nextBeforeSeq as number | undefined;
  } while (beforeSeq);
  assert.equal(texts.length, 65);
  assert.equal(new Set(texts).size, 65);
  assert.ok(texts.every(text => text.startsWith('After join')));
});
