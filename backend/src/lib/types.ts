export type RoomKind = 'private' | 'group';

export interface AuthenticatedActor {
  userId: string;
  name: string;
}

export interface UserRecord {
  userId: string;
  name: string;
  canonicalName: string;
  passwordHash: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface RoomRecord {
  roomId: string;
  kind: RoomKind;
  name: string | null;
  privatePairKey: string | null;
  createdAt: string;
}

export interface MembershipRecord {
  roomId: string;
  userId: string;
  visibleFromSeq: number;
  joinedAt: string;
}

export interface MessageEmoji {
  emojiId: string;
  emoji: string;
  createdAt: string;
}

export interface MessageRecord {
  seq: number;
  messageId: string;
  roomId: string;
  senderId: string;
  clientMessageId: string;
  text: string;
  sentAt: string;
  emojis: MessageEmoji[];
}

export class DomainError extends Error {
  constructor(
    public readonly code:
      | 'ROOM_NOT_FOUND'
      | 'WRONG_ROOM_TYPE'
      | 'NOT_MEMBER'
      | 'USER_NOT_FOUND'
      | 'MESSAGE_NOT_AVAILABLE'
      | 'CLIENT_MESSAGE_ID_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
