// SQLite column names use snake_case. Internal TypeScript records use camelCase.
import type {
  MembershipRecord,
  MessageEmoji,
  MessageRecord,
  RoomRecord,
  UserRecord,
} from '../lib/types.js';

export type UserRow = {
  user_id: string;
  name: string;
  canonical_name: string;
  password_hash: string;
  created_at: string;
  deleted_at: string | null;
};

export type RoomRow = {
  room_id: string;
  kind: 'private' | 'group';
  name: string | null;
  private_pair_key: string | null;
  created_at: string;
};

export type MembershipRow = {
  room_id: string;
  user_id: string;
  visible_from_seq: number;
  joined_at: string;
};

export type MessageRow = {
  seq: number;
  message_id: string;
  room_id: string;
  sender_id: string;
  client_message_id: string;
  text: string;
  sent_at: string;
};

export function userFromRow(row: UserRow): UserRecord {
  return {
    userId: row.user_id,
    name: row.name,
    canonicalName: row.canonical_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export function roomFromRow(row: RoomRow): RoomRecord {
  return {
    roomId: row.room_id,
    kind: row.kind,
    name: row.name,
    privatePairKey: row.private_pair_key,
    createdAt: row.created_at,
  };
}

export function membershipFromRow(row: MembershipRow): MembershipRecord {
  return {
    roomId: row.room_id,
    userId: row.user_id,
    visibleFromSeq: row.visible_from_seq,
    joinedAt: row.joined_at,
  };
}

export function messageRecordFromRow(row: MessageRow, emojis: MessageEmoji[]): MessageRecord {
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
