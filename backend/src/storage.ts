import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { DomainError, type MembershipRecord, type MessageEmoji, type MessageRecord, type RoomRecord, type UserRecord } from './types.js';

const schemaPath = new URL('./schema.sql', import.meta.url);
const schemaSql = readFileSync(schemaPath, 'utf8');

type UserRow = {
  user_id: string;
  name: string;
  canonical_name: string;
  password_hash: string;
  created_at: string;
  deleted_at: string | null;
};

type RoomRow = {
  room_id: string;
  kind: 'private' | 'group';
  name: string | null;
  private_pair_key: string | null;
  created_at: string;
};

type MembershipRow = {
  room_id: string;
  user_id: string;
  visible_from_seq: number;
  joined_at: string;
};

type MessageRow = {
  seq: number;
  message_id: string;
  room_id: string;
  sender_id: string;
  client_message_id: string;
  text: string;
  sent_at: string;
};

function now(): string {
  return new Date().toISOString();
}

function canonicalPrivatePairKey(firstUserId: string, secondUserId: string): string {
  return [firstUserId, secondUserId].sort().join(':');
}

function asUser(row: UserRow): UserRecord {
  return {
    userId: row.user_id,
    name: row.name,
    canonicalName: row.canonical_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function asRoom(row: RoomRow): RoomRecord {
  return {
    roomId: row.room_id,
    kind: row.kind,
    name: row.name,
    privatePairKey: row.private_pair_key,
    createdAt: row.created_at,
  };
}

function asMembership(row: MembershipRow): MembershipRecord {
  return {
    roomId: row.room_id,
    userId: row.user_id,
    visibleFromSeq: row.visible_from_seq,
    joinedAt: row.joined_at,
  };
}

function asMessage(row: MessageRow, emojis: MessageEmoji[]): MessageRecord {
  return {
    seq: row.seq,
    messageId: row.message_id,
    roomId: row.room_id,
    senderId: row.sender_id,
    clientMessageId: row.client_message_id,
    text: row.text,
    sentAt: row.sent_at,
    emojis,
  };
}

export class Storage {
  readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    this.database.exec(schemaSql);
    this.ensureUserDeletionColumn();
  }

  close(): void {
    this.database.close();
  }

  createUser(input: {
    userId?: string;
    name: string;
    canonicalName: string;
    passwordHash: string;
  }): UserRecord {
    const user: UserRecord = {
      userId: input.userId ?? randomUUID(),
      name: input.name,
      canonicalName: input.canonicalName,
      passwordHash: input.passwordHash,
      createdAt: now(),
      deletedAt: null,
    };

    this.database
      .prepare(
        `INSERT INTO users (user_id, name, canonical_name, password_hash, created_at, deleted_at)
         VALUES (:userId, :name, :canonicalName, :passwordHash, :createdAt, NULL)`,
      )
      .run({
        userId: user.userId,
        name: user.name,
        canonicalName: user.canonicalName,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt,
      });

    return user;
  }

  findOrCreatePrivateRoom(actorId: string, peerId: string): RoomRecord {
    this.requireUser(actorId);
    this.requireUser(peerId);

    const pairKey = canonicalPrivatePairKey(actorId, peerId);
    const existing = this.findPrivateRoom(actorId, peerId);

    if (existing) {
      return existing;
    }

    const room: RoomRecord = {
      roomId: randomUUID(),
      kind: 'private',
      name: null,
      privatePairKey: pairKey,
      createdAt: now(),
    };

    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO rooms (room_id, kind, name, private_pair_key, created_at)
           VALUES (:roomId, :kind, :name, :privatePairKey, :createdAt)`,
        )
        .run({
          roomId: room.roomId,
          kind: room.kind,
          name: room.name,
          privatePairKey: room.privatePairKey,
          createdAt: room.createdAt,
        });
      this.insertMembership(room.roomId, actorId, 0);
      this.insertMembership(room.roomId, peerId, 0);
    });

    return room;
  }

  findPrivateRoom(firstUserId: string, secondUserId: string): RoomRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM rooms WHERE private_pair_key = ?')
      .get(canonicalPrivatePairKey(firstUserId, secondUserId)) as RoomRow | undefined;
    return row ? asRoom(row) : undefined;
  }

  getUser(userId: string): UserRecord | undefined {
    const row = this.database.prepare('SELECT * FROM users WHERE user_id = ? AND deleted_at IS NULL').get(userId) as UserRow | undefined;
    return row ? asUser(row) : undefined;
  }

  findUserByCanonicalName(canonicalName: string): UserRecord | undefined {
    const row = this.database.prepare('SELECT * FROM users WHERE canonical_name = ? AND deleted_at IS NULL')
      .get(canonicalName) as UserRow | undefined;
    return row ? asUser(row) : undefined;
  }

  createLoginSession(userId: string, ttlSeconds: number): { sessionId: string; expiresAt: string } {
    this.requireUser(userId);
    const sessionId = randomUUID();
    const createdAt = now();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000).toISOString();
    this.database.prepare(
      `INSERT INTO login_sessions (session_id, user_id, expires_at, created_at)
       VALUES (:sessionId, :userId, :expiresAt, :createdAt)`,
    ).run({ sessionId, userId, expiresAt, createdAt });
    return { sessionId, expiresAt };
  }

  findSessionUser(sessionId: string): UserRecord | undefined {
    const row = this.database.prepare(
      `SELECT u.* FROM login_sessions AS s
       INNER JOIN users AS u ON u.user_id = s.user_id
       WHERE s.session_id = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    ).get(sessionId, now()) as UserRow | undefined;
    if (!row) this.database.prepare('DELETE FROM login_sessions WHERE session_id = ?').run(sessionId);
    return row ? asUser(row) : undefined;
  }

  deleteLoginSession(sessionId: string): void {
    this.database.prepare('DELETE FROM login_sessions WHERE session_id = ?').run(sessionId);
  }

  deleteAccount(userId: string): void {
    const user = this.requireUser(userId);
    this.inTransaction(() => {
      this.database.prepare('DELETE FROM login_sessions WHERE user_id = ?').run(userId);
      this.database.prepare(
        `UPDATE users
         SET name = '<Unknown>', canonical_name = :deletedCanonicalName,
             password_hash = '', deleted_at = :deletedAt
         WHERE user_id = :userId`,
      ).run({ userId, deletedCanonicalName: `deleted:${user.userId}`, deletedAt: now() });
    });
  }

  listGroups(): RoomRecord[] {
    return (this.database.prepare("SELECT * FROM rooms WHERE kind = 'group' ORDER BY created_at, room_id")
      .all() as RoomRow[]).map(asRoom);
  }

  listMemberRooms(userId: string): RoomRecord[] {
    return (this.database.prepare(`SELECT r.* FROM rooms r
      JOIN memberships m ON m.room_id = r.room_id
      WHERE m.user_id = ? ORDER BY r.created_at, r.room_id`).all(userId) as RoomRow[]).map(asRoom);
  }

  getRoom(roomId: string): RoomRecord | undefined {
    const row = this.database.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId) as RoomRow | undefined;
    return row ? asRoom(row) : undefined;
  }

  getRoomMembers(roomId: string): UserRecord[] {
    const rows = this.database
      .prepare(
        `SELECT u.* FROM users AS u
         INNER JOIN memberships AS m ON m.user_id = u.user_id
         WHERE m.room_id = ? AND u.deleted_at IS NULL ORDER BY m.joined_at ASC, u.user_id ASC`,
      )
      .all(roomId) as UserRow[];
    return rows.map(asUser);
  }

  /** Private-room DTOs retain a deleted peer as <Unknown>; groups omit deleted accounts. */
  getPrivateRoomMembers(roomId: string): UserRecord[] {
    const rows = this.database.prepare(
      `SELECT u.* FROM users AS u
       INNER JOIN memberships AS m ON m.user_id = u.user_id
       WHERE m.room_id = ? ORDER BY m.joined_at ASC, u.user_id ASC`,
    ).all(roomId) as UserRow[];
    return rows.map(asUser);
  }

  createGroup(creatorId: string, name: string): RoomRecord {
    this.requireUser(creatorId);

    const room: RoomRecord = {
      roomId: randomUUID(),
      kind: 'group',
      name,
      privatePairKey: null,
      createdAt: now(),
    };

    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO rooms (room_id, kind, name, private_pair_key, created_at)
           VALUES (:roomId, :kind, :name, :privatePairKey, :createdAt)`,
        )
        .run({
          roomId: room.roomId,
          kind: room.kind,
          name: room.name,
          privatePairKey: room.privatePairKey,
          createdAt: room.createdAt,
        });
      this.insertMembership(room.roomId, creatorId, 0);
    });

    return room;
  }

  joinGroup(userId: string, roomId: string): MembershipRecord {
    this.requireUser(userId);
    const room = this.requireRoom(roomId);

    if (room.kind !== 'group') {
      throw new DomainError('WRONG_ROOM_TYPE', 'Only groups can be joined.');
    }

    const existing = this.findMembership(roomId, userId);
    if (existing) {
      return existing;
    }

    let membership: MembershipRecord | undefined;
    this.inTransaction(() => {
      const current = this.findMembership(roomId, userId);
      if (current) {
        membership = current;
        return;
      }

      const maximum = this.database
        .prepare('SELECT COALESCE(MAX(seq), 0) AS maximum_seq FROM messages')
        .get() as { maximum_seq: number };
      membership = this.insertMembership(roomId, userId, maximum.maximum_seq + 1);
    });

    return membership!;
  }

  sendMessage(input: {
    senderId: string;
    roomId: string;
    clientMessageId: string;
    text: string;
  }): { message: MessageRecord; replayed: boolean } {
    this.requireMembership(input.roomId, input.senderId);

    const existing = this.database
      .prepare('SELECT * FROM messages WHERE sender_id = ? AND client_message_id = ?')
      .get(input.senderId, input.clientMessageId) as MessageRow | undefined;

    if (existing) {
      if (existing.room_id === input.roomId && existing.text === input.text) {
        return { message: this.messageFromRow(existing), replayed: true };
      }
      throw new DomainError(
        'CLIENT_MESSAGE_ID_CONFLICT',
        'This client message ID was already used for different content.',
      );
    }

    const message = this.inTransaction(() => {
      const record = {
        messageId: randomUUID(),
        roomId: input.roomId,
        senderId: input.senderId,
        clientMessageId: input.clientMessageId,
        text: input.text,
        sentAt: now(),
      };

      const result = this.database
        .prepare(
          `INSERT INTO messages (message_id, room_id, sender_id, client_message_id, text, sent_at)
           VALUES (:messageId, :roomId, :senderId, :clientMessageId, :text, :sentAt)`,
        )
        .run(record);
      const row = this.database
        .prepare('SELECT * FROM messages WHERE seq = ?')
        .get(Number(result.lastInsertRowid)) as MessageRow;
      return this.messageFromRow(row);
    });

    return { message, replayed: false };
  }

  loadHistory(input: { actorId: string; roomId: string; beforeSeq?: number; limit?: number }): {
    messages: MessageRecord[];
    nextBeforeSeq: number | null;
    highWatermarkSeq: number;
  } {
    const membership = this.requireMembership(input.roomId, input.actorId);
    const room = this.requireRoom(input.roomId);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const upperBound = input.beforeSeq ?? Number.MAX_SAFE_INTEGER;
    const minimum = room.kind === 'group' ? membership.visibleFromSeq : 0;

    const rows = this.database
      .prepare(
        `SELECT * FROM messages
         WHERE room_id = :roomId AND seq >= :minimum AND seq < :upperBound
         ORDER BY seq DESC LIMIT :limit`,
      )
      .all({ roomId: input.roomId, minimum, upperBound, limit }) as MessageRow[];
    const messages = rows.reverse().map(row => this.messageFromRow(row));
    const oldest = messages[0]?.seq;
    const hasOlder =
      oldest !== undefined &&
      (this.database
        .prepare(
          `SELECT 1 FROM messages
           WHERE room_id = :roomId AND seq >= :minimum AND seq < :oldest LIMIT 1`,
        )
        .get({ roomId: input.roomId, minimum, oldest }) as { 1: number } | undefined) !== undefined;
    const highWatermark = this.database
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) AS maximum_seq
         FROM messages WHERE room_id = :roomId AND seq >= :minimum`,
      )
      .get({ roomId: input.roomId, minimum }) as { maximum_seq: number };

    return {
      messages,
      nextBeforeSeq: hasOlder && oldest !== undefined ? oldest : null,
      highWatermarkSeq: highWatermark.maximum_seq,
    };
  }

  isMessageVisibleTo(userId: string, roomId: string, messageId: string): boolean {
    return this.getVisibleMessage(userId, roomId, messageId) !== undefined;
  }

  /** Return content only behind the same persisted boundary used by history and AI. */
  getVisibleMessage(userId: string, roomId: string, messageId: string): MessageRecord | undefined {
    const membership = this.findMembership(roomId, userId);
    const room = this.database.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId) as RoomRow | undefined;
    const message = this.database
      .prepare('SELECT * FROM messages WHERE room_id = ? AND message_id = ?')
      .get(roomId, messageId) as MessageRow | undefined;

    const visible = Boolean(
      membership &&
        room &&
        message &&
        (room.kind === 'private' || message.seq >= membership.visibleFromSeq),
    );
    return visible && message ? this.messageFromRow(message) : undefined;
  }

  /** Keep the first saved result, including when another request won the race. */
  attachMessageEmoji(actorId: string, roomId: string, messageId: string, emoji: string): {
    attachment: MessageEmoji; created: boolean;
  } {
    return this.inTransaction(() => {
      this.assertMember(actorId, roomId);
      const message = this.getVisibleMessage(actorId, roomId, messageId);
      if (!message) {
        throw new DomainError('MESSAGE_NOT_AVAILABLE', 'This message is not available for an AI effect.');
      }
      if (message.emojis.length > 0) return { attachment: message.emojis[0], created: false };
      const result = this.database.prepare(
        `INSERT INTO message_emojis (emoji_id, message_id, emoji, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT (message_id, emoji) DO NOTHING`,
      ).run(randomUUID(), messageId, emoji, now());
      const attachment = this.messageEmojis(messageId).find(entry => entry.emoji === emoji)!;
      return { attachment, created: Number(result.changes) === 1 };
    });
  }

  private messageEmojis(messageId: string): MessageEmoji[] {
    const rows = this.database.prepare(
      'SELECT emoji_id, emoji, created_at FROM message_emojis WHERE message_id = ? ORDER BY seq',
    ).all(messageId) as Array<{ emoji_id: string; emoji: string; created_at: string }>;
    return rows.map(row => ({ emojiId: row.emoji_id, emoji: row.emoji, createdAt: row.created_at }));
  }

  private messageFromRow(row: MessageRow): MessageRecord {
    return asMessage(row, this.messageEmojis(row.message_id));
  }

  /** Authorization check for transient room-scoped features such as typing. */
  assertMember(userId: string, roomId: string): void {
    this.requireMembership(roomId, userId);
  }

  private requireUser(userId: string): UserRecord {
    const user = this.getUser(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'User was not found.');
    }
    return user;
  }

  private ensureUserDeletionColumn(): void {
    const columns = this.database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'deleted_at')) {
      this.database.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
    }
  }

  private requireRoom(roomId: string): RoomRecord {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new DomainError('ROOM_NOT_FOUND', 'Room was not found.');
    }
    return room;
  }

  private findMembership(roomId: string, userId: string): MembershipRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM memberships WHERE room_id = ? AND user_id = ?')
      .get(roomId, userId) as MembershipRow | undefined;
    return row ? asMembership(row) : undefined;
  }

  private requireMembership(roomId: string, userId: string): MembershipRecord {
    this.requireRoom(roomId);
    const membership = this.findMembership(roomId, userId);
    if (!membership) {
      throw new DomainError('NOT_MEMBER', 'Join the group before accessing its messages.');
    }
    return membership;
  }

  private insertMembership(roomId: string, userId: string, visibleFromSeq: number): MembershipRecord {
    const membership: MembershipRecord = { roomId, userId, visibleFromSeq, joinedAt: now() };
    this.database
      .prepare(
        `INSERT INTO memberships (room_id, user_id, visible_from_seq, joined_at)
         VALUES (:roomId, :userId, :visibleFromSeq, :joinedAt)`,
      )
      .run({
        roomId: membership.roomId,
        userId: membership.userId,
        visibleFromSeq: membership.visibleFromSeq,
        joinedAt: membership.joinedAt,
      });
    return membership;
  }

  private inTransaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
