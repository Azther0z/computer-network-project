import assert from 'node:assert/strict';
import test from 'node:test';

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
