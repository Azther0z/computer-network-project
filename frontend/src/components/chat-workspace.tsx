'use client';

import { FormEvent, useMemo, useState } from 'react';

import type { ChatMessage, GroupRoom, PrivateRoom, WorkspaceSnapshot } from '@/lib/chat-types';

import styles from './chat-workspace.module.css';

type ChatWorkspaceProps = {
  initialSnapshot: WorkspaceSnapshot;
  preview?: boolean;
};

function roomTitle(room: PrivateRoom | GroupRoom, selfId: string): string {
  if (room.kind === 'group') return room.name;
  return room.members.find((member) => member.userId !== selfId)?.name ?? 'Private chat';
}

export function ChatWorkspace({ initialSnapshot, preview = false }: ChatWorkspaceProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  const rooms = useMemo(
    () => [...snapshot.privateRooms, ...snapshot.groups],
    [snapshot.groups, snapshot.privateRooms],
  );
  const activeRoom = rooms.find((room) => room.roomId === activeRoomId) ?? null;
  const isGroupPreview = activeRoom?.kind === 'group' && !activeRoom.joined;
  const activeMessages = snapshot.messages.filter((message) => message.roomId === activeRoomId);

  function joinGroup(group: GroupRoom): void {
    if (!preview) return;
    setSnapshot((current) => ({
      ...current,
      groups: current.groups.map((candidate) =>
        candidate.roomId === group.roomId
          ? {
              ...candidate,
              joined: true,
              members: [...candidate.members, current.self],
            }
          : candidate,
      ),
    }));
  }

  function sendMessage(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (!preview || !activeRoom || isGroupPreview || !text) return;

    const message: ChatMessage = {
      messageId: `preview-${crypto.randomUUID()}`,
      roomId: activeRoom.roomId,
      senderId: snapshot.self.userId,
      senderName: snapshot.self.name,
      text,
      sentAt: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(),
      ),
    };
    setSnapshot((current) => ({ ...current, messages: [...current.messages, message] }));
    setDraft('');
  }

  function createGroup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const name = groupName.trim();
    if (!preview || !name) return;

    const group: GroupRoom = {
      roomId: `preview-group-${crypto.randomUUID()}`,
      kind: 'group',
      name,
      members: [snapshot.self],
      joined: true,
    };
    setSnapshot((current) => ({ ...current, groups: [...current.groups, group] }));
    setActiveRoomId(group.roomId);
    setGroupName('');
    setShowCreateGroup(false);
  }

  return (
    <section className={styles.workspace} aria-label="Chat workspace">
      {preview && <p className={styles.previewNotice}>Preview data only — no messages are sent to the server.</p>}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span aria-hidden="true">●</span>
          <strong>Talkmato</strong>
        </div>

        <section>
          <h2>Online now</h2>
          <ul className={styles.userList}>
            {snapshot.users.map((user) => (
              <li key={user.userId}>
                <button
                  type="button"
                  className={styles.personButton}
                  onClick={() => {
                    const room = snapshot.privateRooms.find((candidate) =>
                      candidate.members.some((member) => member.userId === user.userId),
                    );
                    if (room) setActiveRoomId(room.roomId);
                  }}
                  disabled={user.userId === snapshot.self.userId}
                >
                  <span className={user.online ? styles.onlineDot : styles.offlineDot} aria-hidden="true" />
                  {user.name}
                  {user.userId === snapshot.self.userId && <small>You</small>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className={styles.sectionHeading}>
            <h2>Groups</h2>
            <button type="button" onClick={() => setShowCreateGroup(true)} aria-label="Create group">
              +
            </button>
          </div>
          <ul className={styles.roomList}>
            {snapshot.groups.map((group) => (
              <li key={group.roomId}>
                <button
                  type="button"
                  className={activeRoomId === group.roomId ? styles.activeRoom : undefined}
                  onClick={() => setActiveRoomId(group.roomId)}
                >
                  <span aria-hidden="true">#</span>
                  {group.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main className={styles.conversation}>
        {!activeRoom && (
          <div className={styles.emptyState}>
            <p className={styles.tomato} aria-hidden="true">●</p>
            <h1>Choose a conversation</h1>
            <p>Select a person or group to open a room.</p>
          </div>
        )}

        {activeRoom && (
          <>
            <header className={styles.roomHeader}>
              <div>
                <p>{activeRoom.kind === 'group' ? 'Group chat' : 'Private chat'}</p>
                <h1>{roomTitle(activeRoom, snapshot.self.userId)}</h1>
              </div>
              {activeRoom.kind === 'group' && <span>{activeRoom.members.length} members</span>}
            </header>

            {isGroupPreview ? (
              <section className={styles.groupPreview}>
                <p className={styles.tomato} aria-hidden="true">●</p>
                <h2>Join to see the conversation</h2>
                <p>Members are visible before joining. Earlier messages remain private.</p>
                <button type="button" onClick={() => joinGroup(activeRoom)} disabled={!preview}>
                  Join group
                </button>
              </section>
            ) : (
              <>
                <ol className={styles.messages} aria-label="Messages">
                  {activeMessages.length === 0 && <li className={styles.noMessages}>No messages yet.</li>}
                  {activeMessages.map((message) => {
                    const own = message.senderId === snapshot.self.userId;
                    return (
                      <li key={message.messageId} className={own ? styles.ownMessage : styles.receivedMessage}>
                        {!own && <strong>{message.senderName}</strong>}
                        <p>{message.text}</p>
                        <time>{message.sentAt}</time>
                      </li>
                    );
                  })}
                </ol>
                <form className={styles.composer} onSubmit={sendMessage}>
                  <label className="srOnly" htmlFor="message-draft">
                    Message {roomTitle(activeRoom, snapshot.self.userId)}
                  </label>
                  <textarea
                    id="message-draft"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Write a message…"
                    rows={2}
                    disabled={!preview}
                  />
                  <button type="submit" disabled={!preview || !draft.trim()}>
                    Send
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </main>

      {showCreateGroup && (
        <div className={styles.modalBackdrop} role="presentation">
          <form className={styles.modal} onSubmit={createGroup} aria-labelledby="create-group-title">
            <h2 id="create-group-title">Create group</h2>
            <p>You will be the only member initially. Others choose to join themselves.</p>
            <label htmlFor="group-name">Group name</label>
            <input
              id="group-name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              maxLength={64}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setShowCreateGroup(false)}>
                Cancel
              </button>
              <button type="submit" disabled={!preview || !groupName.trim()}>
                Create group
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
