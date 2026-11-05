import type { ChatUser, PrivateRoom, GroupRoom } from './chat-types';

export type AccountSnapshot = {
  self: ChatUser;
  users: ChatUser[];
  groups: Omit<GroupRoom, 'joined'>[];
  privateRooms: PrivateRoom[];
};
export type AuthMode = 'register' | 'login';
export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
