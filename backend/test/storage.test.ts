import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DomainError } from '../src/types.js';
import { Storage } from '../src/storage.js';

function createStorageWithUsers(): { storage: Storage; aliceId: string; bobId: string; charlieId: string } {
  const storage = new Storage(':memory:');
  const passwordHash = '$argon2id$test-fixture-not-a-real-password-hash';
  const alice = storage.createUser({ name: 'Alice', canonicalName: 'alice', passwordHash });
  const bob = storage.createUser({ name: 'Bob', canonicalName: 'bob', passwordHash });
  const charlie = storage.createUser({ name: 'Charlie', canonicalName: 'charlie', passwordHash });

  return { storage, aliceId: alice.userId, bobId: bob.userId, charlieId: charlie.userId };
}

test('private room creation is stable and excludes nonmembers', (t) => {
  const { storage, aliceId, bobId, charlieId } = createStorageWithUsers();
  t.after(() => storage.close());

  const first = storage.findOrCreatePrivateRoom(aliceId, bobId);
  const second = storage.findOrCreatePrivateRoom(bobId, aliceId);
  assert.equal(first.roomId, second.roomId);

  const sent = storage.sendMessage({
    senderId: aliceId,
    roomId: first.roomId,
    clientMessageId: 'private-message-1',
    text: 'Hello Bob',
  });
  assert.equal(sent.replayed, false);
  assert.equal(storage.loadHistory({ actorId: bobId, roomId: first.roomId }).messages.length, 1);
  assert.throws(
    () => storage.loadHistory({ actorId: charlieId, roomId: first.roomId }),
    (error: unknown) => error instanceof DomainError && error.code === 'NOT_MEMBER',
  );
});

test('first group join hides earlier messages and preserves its boundary', (t) => {
  const { storage, aliceId, bobId } = createStorageWithUsers();
  t.after(() => storage.close());

  const group = storage.createGroup(aliceId, 'Study');
  const beforeJoin = storage.sendMessage({
    senderId: aliceId,
    roomId: group.roomId,
    clientMessageId: 'group-before-join',
    text: 'Before Bob joins',
  });
  const membership = storage.joinGroup(bobId, group.roomId);
  assert.equal(membership.visibleFromSeq, beforeJoin.message.seq + 1);

  const afterJoin = storage.sendMessage({
    senderId: aliceId,
    roomId: group.roomId,
    clientMessageId: 'group-after-join',
    text: 'After Bob joins',
  });
  const bobHistory = storage.loadHistory({ actorId: bobId, roomId: group.roomId });
  assert.deepEqual(
    bobHistory.messages.map((message) => message.messageId),
    [afterJoin.message.messageId],
  );

  const repeatedJoin = storage.joinGroup(bobId, group.roomId);
  assert.equal(repeatedJoin.visibleFromSeq, membership.visibleFromSeq);
  assert.equal(storage.isMessageVisibleTo(bobId, group.roomId, beforeJoin.message.messageId), false);
  assert.equal(storage.isMessageVisibleTo(bobId, group.roomId, afterJoin.message.messageId), true);
});

test('manual retry returns the existing message without inserting another row', (t) => {
  const { storage, aliceId, bobId } = createStorageWithUsers();
  t.after(() => storage.close());
  const room = storage.findOrCreatePrivateRoom(aliceId, bobId);

  const first = storage.sendMessage({
    senderId: aliceId,
    roomId: room.roomId,
    clientMessageId: 'retry-key',
    text: 'One logical message',
  });
  const retry = storage.sendMessage({
    senderId: aliceId,
    roomId: room.roomId,
    clientMessageId: 'retry-key',
    text: 'One logical message',
  });

  assert.equal(retry.replayed, true);
  assert.equal(retry.message.messageId, first.message.messageId);
  assert.equal(storage.loadHistory({ actorId: aliceId, roomId: room.roomId }).messages.length, 1);
  assert.throws(
    () =>
      storage.sendMessage({
        senderId: aliceId,
        roomId: room.roomId,
        clientMessageId: 'retry-key',
        text: 'Changed message',
      }),
    (error: unknown) => error instanceof DomainError && error.code === 'CLIENT_MESSAGE_ID_CONFLICT',
  );
});

test('login sessions resolve only before expiry and can be revoked', (t) => {
  const { storage, aliceId } = createStorageWithUsers();
  t.after(() => storage.close());

  const valid = storage.createLoginSession(aliceId, 60 * 60);
  assert.equal(storage.findSessionUser(valid.sessionId)?.userId, aliceId);
  storage.deleteLoginSession(valid.sessionId);
  assert.equal(storage.findSessionUser(valid.sessionId), undefined);

  const expired = storage.createLoginSession(aliceId, -1);
  assert.equal(storage.findSessionUser(expired.sessionId), undefined);
});

test('emoji storage upgrades existing databases, keeps the first result and preserves legacy attachments across restarts', t => {
  const work = fileURLToPath(new URL('../../work/', import.meta.url));
  mkdirSync(work, { recursive: true });
  const directory = mkdtempSync(join(work, 'emoji-storage-test-'));
  const databasePath = join(directory, 'synthetic.sqlite');
  let current: Storage | undefined = new Storage(databasePath);
  t.after(() => { current?.close(); rmSync(directory, { recursive: true, force: true }); });
  const alice = current.createUser({ name: 'Alice', canonicalName: 'alice', passwordHash: 'synthetic-hash' });
  const room = current.createGroup(alice.userId, 'Saved');
  const message = current.sendMessage({ senderId: alice.userId, roomId: room.roomId, clientMessageId: 'saved', text: 'Synthetic saved message' }).message;
  // Model an existing installation that predates the additive table.
  current.database.exec('DROP TABLE message_emojis');
  current.close(); current = undefined;
  current = new Storage(databasePath);
  assert.equal(current.loadHistory({ actorId: alice.userId, roomId: room.roomId }).messages[0].text, message.text);
  const first = current.attachMessageEmoji(alice.userId, room.roomId, message.messageId, '😊');
  const second = current.attachMessageEmoji(alice.userId, room.roomId, message.messageId, '🎉');
  const duplicate = current.attachMessageEmoji(alice.userId, room.roomId, message.messageId, '😊');
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(second.attachment, first.attachment);
  assert.equal(duplicate.created, false);
  assert.deepEqual(duplicate.attachment, first.attachment);
  // Existing multi-emoji messages remain readable; the once-per-message rule never deletes old data.
  const legacy = { emojiId: 'legacy-party', emoji: '🎉', createdAt: '2026-11-07T00:00:00.000Z' };
  current.database.prepare('INSERT INTO message_emojis (emoji_id, message_id, emoji, created_at) VALUES (?, ?, ?, ?)')
    .run(legacy.emojiId, message.messageId, legacy.emoji, legacy.createdAt);
  current.close(); current = undefined;
  current = new Storage(databasePath);
  assert.deepEqual(current.loadHistory({ actorId: alice.userId, roomId: room.roomId }).messages[0].emojis,
    [first.attachment, legacy]);
  const later = current.attachMessageEmoji(alice.userId, room.roomId, message.messageId, '🔥');
  assert.equal(later.created, false);
  assert.deepEqual(later.attachment, first.attachment);
  const replay = current.sendMessage({ senderId: alice.userId, roomId: room.roomId, clientMessageId: 'saved', text: message.text });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.message.emojis, [first.attachment, legacy]);
});

test('saved emoji writes enforce the same membership and pre-join history visibility as reads', t => {
  const { storage, aliceId, bobId, charlieId } = createStorageWithUsers();
  t.after(() => storage.close());
  const room = storage.createGroup(aliceId, 'Study');
  const old = storage.sendMessage({ senderId: aliceId, roomId: room.roomId, clientMessageId: 'old', text: 'Before join' }).message;
  storage.attachMessageEmoji(aliceId, room.roomId, old.messageId, '😊');
  storage.joinGroup(bobId, room.roomId);
  assert.throws(() => storage.attachMessageEmoji(bobId, room.roomId, old.messageId, '🎉'),
    (error: unknown) => error instanceof DomainError && error.code === 'MESSAGE_NOT_AVAILABLE');
  assert.throws(() => storage.attachMessageEmoji(charlieId, room.roomId, old.messageId, '🎉'),
    (error: unknown) => error instanceof DomainError && error.code === 'NOT_MEMBER');
  assert.equal(storage.getVisibleMessage(bobId, room.roomId, old.messageId), undefined);
  assert.deepEqual(storage.loadHistory({ actorId: bobId, roomId: room.roomId }).messages, []);
});
