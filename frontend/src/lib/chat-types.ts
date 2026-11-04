export type ChatUser = {
  userId: string;
  name: string;
  online: boolean;
};

export type ChatMessage = {
  messageId: string;
  roomId: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: string;
};

export type PrivateRoom = {
  roomId: string;
  kind: 'private';
  members: ChatUser[];
};

export type GroupRoom = {
  roomId: string;
  kind: 'group';
  name: string;
  members: ChatUser[];
  joined: boolean;
};

export type WorkspaceSnapshot = {
  self: ChatUser;
  users: ChatUser[];
  privateRooms: PrivateRoom[];
  groups: GroupRoom[];
  messages: ChatMessage[];
};
