import type { WorkspaceSnapshot } from './chat-types';

export const demoWorkspace: WorkspaceSnapshot = {
  self: { userId: 'u-alice', name: 'Alice', online: true },
  users: [
    { userId: 'u-alice', name: 'Alice', online: true },
    { userId: 'u-alex', name: 'Alex', online: true },
    { userId: 'u-maya', name: 'Maya', online: false },
  ],
  privateRooms: [
    {
      roomId: 'p-alice-alex',
      kind: 'private',
      members: [
        { userId: 'u-alice', name: 'Alice', online: true },
        { userId: 'u-alex', name: 'Alex', online: true },
      ],
    },
  ],
  groups: [
    {
      roomId: 'g-weekend',
      kind: 'group',
      name: 'Weekend plans',
      members: [
        { userId: 'u-maya', name: 'Maya', online: false },
        { userId: 'u-alex', name: 'Alex', online: true },
      ],
      joined: false,
    },
    {
      roomId: 'g-study',
      kind: 'group',
      name: 'Study group',
      members: [
        { userId: 'u-alice', name: 'Alice', online: true },
        { userId: 'u-alex', name: 'Alex', online: true },
      ],
      joined: true,
    },
  ],
  messages: [
    {
      messageId: 'm-1',
      roomId: 'p-alice-alex',
      senderId: 'u-alex',
      senderName: 'Alex',
      text: 'Hi Alice — are we ready to build Talkmato?',
      sentAt: '09:00',
    },
    {
      messageId: 'm-2',
      roomId: 'p-alice-alex',
      senderId: 'u-alice',
      senderName: 'Alice',
      text: 'Almost. The room and message foundation is ready.',
      sentAt: '09:01',
    },
    {
      messageId: 'm-3',
      roomId: 'g-study',
      senderId: 'u-alex',
      senderName: 'Alex',
      text: 'Let’s review the networking requirements tomorrow.',
      sentAt: '09:10',
    },
  ],
};
