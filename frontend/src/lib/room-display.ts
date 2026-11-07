import type { GroupRoom, PrivateRoom } from './chat-types';

export function roomTitle(room: PrivateRoom | GroupRoom, selfId: string): string {
  if (room.kind === 'group') {
    return room.name;
  }
  return room.members.find((member) => member.userId !== selfId)?.name ?? 'Private chat';
}

export function selfFirst<T extends { userId: string }>(users: T[], selfId: string): T[] {
  return [...users].sort(
    (left, right) => Number(right.userId === selfId) - Number(left.userId === selfId),
  );
}
