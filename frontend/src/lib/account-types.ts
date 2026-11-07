import type { ChatUser, PrivateRoom, GroupSummary } from './chat-types';

export type AccountSnapshot = {
  self: ChatUser;
  users: ChatUser[];
  groups: GroupSummary[];
  privateRooms: PrivateRoom[];
};
export type AuthMode = 'register' | 'login';
export type Ack<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
