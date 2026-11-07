import type { Storage } from '../database/storage.js';
import type { AuthenticatedActor, RoomRecord, UserRecord } from './types.js';

export type PublicUser = AuthenticatedActor & { online: boolean };

export type PublicRoom = {
  roomId: string;
  kind: 'private' | 'group';
  name?: string;
  members: PublicUser[];
};

/** Private rooms retain deleted peers; groups list only existing accounts, including offline members. */
export function toPublicRoom(
  storage: Storage,
  room: RoomRecord,
  toPublicUser: (user: UserRecord) => PublicUser,
): PublicRoom {
  const members =
    room.kind === 'private'
      ? storage.getPrivateRoomMembers(room.roomId)
      : storage.getRoomMembers(room.roomId);

  return {
    roomId: room.roomId,
    kind: room.kind,
    ...(room.name === null ? {} : { name: room.name }),
    members: members.map(toPublicUser),
  };
}
