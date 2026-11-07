import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { AuthPresence } from '../src/features/auth/auth-handlers.js';
import { EmojiEffects } from '../src/features/emoji/handlers.js';
import { registerRoomHandlers } from '../src/features/rooms/room-handlers.js';
import { Storage } from '../src/database/storage.js';
import type { MessageEmoji, MessageRecord } from '../src/lib/types.js';

type Added = { roomId: string; messageId: string; attachment: MessageEmoji };

async function setup(t: TestContext) {
  const storage = new Storage(':memory:');
  const http = createServer();
  const io = new Server(http, { transports: ['websocket'] });
  const auth = new AuthPresence(io, storage);
  let selected = '😊';
  let providerCalls = 0;
  const effects = new EmojiEffects(storage, { suggest: async () => { providerCalls++; return selected; } }, {
    cooldownMs: 0, emitToUser: auth.emitToUser,
  });
  io.on('connection', socket => {
    auth.register(socket);
    registerRoomHandlers(socket, io, storage, auth);
    effects.register(socket);
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  const clients: Socket[] = [];
  t.after(async () => {
    clients.forEach(socket => socket.disconnect());
    await new Promise<void>(resolve => io.close(() => resolve()));
    storage.close();
  });
  async function client(name?: string) {
    const socket = connect(`http://127.0.0.1:${port}`, {
      transports: ['websocket'], reconnection: false, forceNew: true,
    });
    clients.push(socket);
    await socketEvent<void>(socket, 'connect');
    const events: Added[] = [];
    socket.on('message.emojiAdded', (event: Added) => events.push(event));
    const account = name ? await command(socket, 'auth.register', { name, password: 'synthetic-password' }) : undefined;
    return { socket, events, userId: account?.data.snapshot.self.userId as string | undefined };
  }
  return { storage, io, client, calls: () => providerCalls, select: (emoji: string) => { selected = emoji; } };
}

function command(socket: Socket, event: string, payload: object = {}) {
  return socket.timeout(5000).emitWithAck(event, payload);
}

function socketEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise(resolve => socket.once(event, resolve));
}

async function history(socket: Socket, roomId: string): Promise<MessageRecord[]> {
  const response = await command(socket, 'room.history', { roomId });
  assert.equal(response.ok, true);
  return response.data.messages;
}

test('saved emojis reach only eligible group readers, deduplicate, and load for a returning offline member', async t => {
  const { storage, io, client, calls, select } = await setup(t);
  const alice = await client('Alice');
  const bob = await client('Bob');
  const late = await client('Late');
  const outsider = await client('Outsider');
  const guest = await client();
  const roomId = (await command(alice.socket, 'group.create', { name: 'Study' })).data.group.roomId as string;
  await command(bob.socket, 'group.join', { roomId });
  const sent = await command(alice.socket, 'room.send', { roomId, clientMessageId: 'first', text: 'Synthetic happy text' });
  const messageId = sent.data.message.messageId as string;
  await command(late.socket, 'group.join', { roomId });
  // Even deliberately stale/wrong delivery-channel membership grants no access.
  for (const peer of [late, outsider, guest]) io.sockets.sockets.get(peer.socket.id!)!.join(`room:${roomId}`);
  const update = socketEvent<Added>(bob.socket, 'message.emojiAdded');
  const first = await command(alice.socket, 'message.emojiSuggest', { roomId, messageId });
  const event = await update;
  assert.equal(first.ok, true);
  assert.deepEqual(event, { roomId, messageId, attachment: first.data.attachment });
  assert.equal(alice.events.length, 1);
  assert.equal(bob.events.length, 1);
  assert.deepEqual((await history(bob.socket, roomId))[0].emojis, [first.data.attachment]);
  assert.deepEqual(await history(late.socket, roomId), []);
  assert.equal((await command(outsider.socket, 'room.history', { roomId })).error.code, 'NOT_MEMBER');
  assert.equal((await command(guest.socket, 'room.history', { roomId })).error.code, 'NOT_AUTHENTICATED');
  assert.equal(late.events.length + outsider.events.length + guest.events.length, 0);
  assert.equal((await command(late.socket, 'message.emojiSuggest', { roomId, messageId })).error.code, 'MESSAGE_NOT_AVAILABLE');
  const duplicate = await command(bob.socket, 'message.emojiSuggest', { roomId, messageId });
  assert.deepEqual(duplicate.data.attachment, first.data.attachment);
  assert.equal((await history(bob.socket, roomId))[0].emojis.length, 1);
  assert.equal(alice.events.length, 1);
  assert.equal(bob.events.length, 1);
  select('🎉');
  const repeated = await command(alice.socket, 'message.emojiSuggest', { roomId, messageId });
  assert.deepEqual(repeated.data.attachment, first.data.attachment);
  assert.deepEqual((await history(bob.socket, roomId))[0].emojis.map(entry => entry.emoji), ['😊']);
  assert.equal(calls(), 1, 'saved messages never invoke the provider again');
  assert.equal(bob.events.length, 1);
  const serverBob = io.sockets.sockets.get(bob.socket.id!)!;
  const disconnected = once(serverBob, 'disconnect');
  bob.socket.disconnect();
  await disconnected;
  select('❤️');
  const offlineMessageId = (await command(alice.socket, 'room.send', { roomId, clientMessageId: 'offline', text: 'While Bob is offline' })).data.message.messageId as string;
  await command(alice.socket, 'message.emojiSuggest', { roomId, messageId: offlineMessageId });
  assert.equal(storage.loadHistory({ actorId: bob.userId!, roomId }).messages[1].emojis.length, 1);
  const returned = await client();
  assert.equal((await command(returned.socket, 'auth.login', { name: 'Bob', password: 'synthetic-password' })).ok, true);
  assert.deepEqual((await history(returned.socket, roomId)).map(message => message.emojis.map(entry => entry.emoji)), [['😊'], ['❤️']]);
  assert.equal(returned.events.length, 0, 'restoring history does not rebroadcast attachments');
});

test('private attachments are committed before events and acknowledgements, with no delivery to unrelated or signed-out sockets', async t => {
  const { storage, io, client, select } = await setup(t);
  const alice = await client('Alice');
  const bob = await client('Bob');
  const charlie = await client('Charlie');
  const roomId = (await command(alice.socket, 'private.open', { peerId: bob.userId })).data.room.roomId as string;
  const messageId = (await command(alice.socket, 'room.send', { roomId, clientMessageId: 'private', text: 'Private synthetic text' })).data.message.messageId as string;
  io.sockets.sockets.get(charlie.socket.id!)!.join(`room:${roomId}`);
  const delivered = new Promise<void>(resolve => bob.socket.once('message.emojiAdded', (event: Added) => {
    assert.deepEqual(storage.getVisibleMessage(bob.userId!, roomId, messageId)?.emojis, [event.attachment]);
    resolve();
  }));
  const first = await command(alice.socket, 'message.emojiSuggest', { roomId, messageId });
  await delivered;
  assert.deepEqual((await history(alice.socket, roomId))[0].emojis, [first.data.attachment]);
  await command(bob.socket, 'auth.logout');
  io.sockets.sockets.get(bob.socket.id!)!.join(`room:${roomId}`);
  select('🎉');
  const secondMessageId = (await command(alice.socket, 'room.send', { roomId, clientMessageId: 'signed-out', text: 'While Bob is signed out' })).data.message.messageId as string;
  await command(alice.socket, 'message.emojiSuggest', { roomId, messageId: secondMessageId });
  await command(bob.socket, 'room.history', { roomId });
  await command(charlie.socket, 'room.history', { roomId });
  assert.equal(bob.events.length, 1, 'signed-out sockets receive no further attachments');
  assert.equal(charlie.events.length, 0);
});
