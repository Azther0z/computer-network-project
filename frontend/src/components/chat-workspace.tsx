'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AccountSnapshot, Ack } from '@/lib/account-types';
import type { ChatMessage, GroupRoom, PrivateRoom } from '@/lib/chat-types';
import type { AccountAuth } from '@/lib/use-account-auth';

import styles from './chat-workspace.module.css';
import { MessageEmojiEffect } from './message-emoji-effect';

type SignedInAccount = AccountAuth & {
  snapshot: AccountSnapshot;
  socket: NonNullable<AccountAuth['socket']>;
};
type Room = PrivateRoom | GroupRoom;
type HistoryPage = { roomId: string; messages: ChatMessage[] };
type SendResult = { message: ChatMessage; replayed: boolean };
type PrivateOpenResult = { room: PrivateRoom };
type GroupResult = { group: Omit<GroupRoom, 'joined'> };
type PendingMessage = { roomId: string; text: string; clientMessageId: string };
type TypingUpdate = { roomId: string; userId: string; isTyping: boolean };

function roomTitle(room: Room, selfId: string): string {
  if (room.kind === 'group') return room.name;
  return room.members.find((member) => member.userId !== selfId)?.name ?? 'Private chat';
}

function asJoinedGroup(group: Omit<GroupRoom, 'joined'>, selfId: string): GroupRoom {
  return { ...group, joined: group.members.some((member) => member.userId === selfId) };
}

function mergeByRoomId<T extends { roomId: string }>(current: T[], incoming: T[]): T[] {
  const rooms = new Map(current.map((room) => [room.roomId, room]));
  for (const room of incoming) rooms.set(room.roomId, room);
  return [...rooms.values()];
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(current.map((message) => [message.messageId, message]));
  for (const message of incoming) messages.set(message.messageId, message);
  return [...messages.values()].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
}

function selfFirst<T extends { userId: string }>(users: T[], selfId: string): T[] {
  return [...users].sort((left, right) => Number(right.userId === selfId) - Number(left.userId === selfId));
}

function displayTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function errorMessage(response: Ack<unknown>): string {
  if (response.ok) return '';
  const messages: Record<string, string> = {
    NOT_MEMBER: 'Join this group before viewing or sending messages.',
    USER_OFFLINE: 'That person is no longer online.',
    CLIENT_MESSAGE_ID_CONFLICT: 'This message retry conflicts with an earlier message.',
    INVALID_PAYLOAD: 'Please check the information and try again.',
  };
  return messages[response.error.code] ?? 'That chat request could not be completed. Please try again.';
}

/** Uses the authenticated Socket.IO connection supplied by AuthGate; it never opens one. */
export function ChatWorkspace({ account }: { account: SignedInAccount }) {
  const { snapshot, socket } = account;
  const requestRef = useRef(account.request);
  requestRef.current = account.request;
  const [privateRooms, setPrivateRooms] = useState<PrivateRoom[]>(snapshot.privateRooms);
  const [groups, setGroups] = useState<GroupRoom[]>(() =>
    snapshot.groups.map((group) => asJoinedGroup(group, snapshot.self.userId)),
  );
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingRoomId, setLoadingRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [typingByRoom, setTypingByRoom] = useState<Record<string, string[]>>({});
  const [showMemberDetails, setShowMemberDetails] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const typingRoomRef = useRef<string | null>(null);
  const lastTypingUpdateRef = useRef(0);
  const memberDetailsRef = useRef<HTMLDivElement>(null);
  const messageAreaRef = useRef<HTMLElement>(null);

  const sendTyping = useCallback((roomId: string, isTyping: boolean) => {
    const now = Date.now();
    if (isTyping && typingRoomRef.current === roomId && now - lastTypingUpdateRef.current < 500) return;
    if (isTyping) {
      typingRoomRef.current = roomId;
      lastTypingUpdateRef.current = now;
    } else if (typingRoomRef.current === roomId) {
      typingRoomRef.current = null;
    }
    void requestRef.current('typing.set', { roomId, isTyping }).catch(() => {});
  }, []);

  useEffect(() => {
    setPrivateRooms((current) => mergeByRoomId(current, snapshot.privateRooms));
    setGroups((current) => mergeByRoomId(
      current,
      snapshot.groups.map((group) => asJoinedGroup(group, snapshot.self.userId)),
    ));
  }, [snapshot.groups, snapshot.privateRooms, snapshot.self.userId]);

  useEffect(() => {
    const privateOpened = ({ room }: PrivateOpenResult) => {
      setPrivateRooms((current) => mergeByRoomId(current, [room]));
    };
    const messageCreated = (message: ChatMessage) => {
      setMessagesByRoom((current) => ({
        ...current,
        [message.roomId]: mergeMessages(current[message.roomId] ?? [], [message]),
      }));
    };
    const typingUpdated = ({ roomId, userId, isTyping }: TypingUpdate) => {
      setTypingByRoom((current) => {
        const users = new Set(current[roomId] ?? []);
        if (isTyping) users.add(userId); else users.delete(userId);
        return { ...current, [roomId]: [...users] };
      });
    };
    socket.on('private.opened', privateOpened);
    socket.on('private.updated', privateOpened);
    socket.on('message.created', messageCreated);
    socket.on('typing.updated', typingUpdated);
    return () => {
      socket.off('private.opened', privateOpened);
      socket.off('private.updated', privateOpened);
      socket.off('message.created', messageCreated);
      socket.off('typing.updated', typingUpdated);
    };
  }, [socket]);

  const rooms = useMemo<Room[]>(() => [...privateRooms, ...groups], [groups, privateRooms]);
  const activeRoom = rooms.find((room) => room.roomId === activeRoomId) ?? null;
  const isGroupPreview = activeRoom?.kind === 'group' && !activeRoom.joined;
  const activeMessages = activeRoomId === null ? [] : messagesByRoom[activeRoomId] ?? [];
  const typingNames = activeRoom === null ? [] : (typingByRoom[activeRoom.roomId] ?? [])
    .filter((userId) => userId !== snapshot.self.userId)
    .map((userId) => activeRoom.members.find((member) => member.userId === userId)?.name)
    .filter((name): name is string => name !== undefined);

  useEffect(() => () => {
    const roomId = typingRoomRef.current;
    if (roomId) sendTyping(roomId, false);
  }, [activeRoom?.roomId, sendTyping]);

  useEffect(() => {
    if (!activeRoom || isGroupPreview || !draft.trim()) {
      const roomId = typingRoomRef.current;
      if (roomId) sendTyping(roomId, false);
      return;
    }
    sendTyping(activeRoom.roomId, true);
    const refresh = window.setInterval(() => sendTyping(activeRoom.roomId, true), 1_000);
    return () => window.clearInterval(refresh);
  }, [activeRoom, draft, isGroupPreview, sendTyping]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (messageAreaRef.current) messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeRoomId, activeMessages]);

  useEffect(() => { setShowMemberDetails(false); }, [activeRoomId]);

  useEffect(() => {
    if (!showMemberDetails) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (memberDetailsRef.current && !memberDetailsRef.current.contains(event.target as Node)) {
        setShowMemberDetails(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showMemberDetails]);

  useEffect(() => {
    if (!activeRoom || isGroupPreview) return;
    let cancelled = false;
    setLoadingRoomId(activeRoom.roomId);
    setError(null);
    void requestRef.current<HistoryPage>('room.history', { roomId: activeRoom.roomId })
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          setError(errorMessage(response));
          return;
        }
        setMessagesByRoom((current) => ({
          ...current,
          [response.data.roomId]: mergeMessages(current[response.data.roomId] ?? [], response.data.messages),
        }));
      })
      .catch(() => { if (!cancelled) setError('Connection changed. Sign in again before using chat.'); })
      .finally(() => { if (!cancelled) setLoadingRoomId(null); });
    return () => { cancelled = true; };
  }, [activeRoom, isGroupPreview]);

  async function openPrivate(peerId: string): Promise<void> {
    if (peerId === snapshot.self.userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current<PrivateOpenResult>('private.open', { peerId });
      if (!response.ok) { setError(errorMessage(response)); return; }
      setPrivateRooms((current) => mergeByRoomId(current, [response.data.room]));
      setActiveRoomId(response.data.room.roomId);
    } catch {
      setError('Connection changed. Sign in again before using chat.');
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup(group: GroupRoom): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current<GroupResult>('group.join', { roomId: group.roomId });
      if (!response.ok) { setError(errorMessage(response)); return; }
      setGroups((current) => mergeByRoomId(current, [asJoinedGroup(response.data.group, snapshot.self.userId)]));
    } catch {
      setError('Connection changed. Sign in again before using chat.');
    } finally {
      setBusy(false);
    }
  }

  async function sendWithId(message: PendingMessage): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current<SendResult>('room.send', message);
      if (!response.ok) { setError(errorMessage(response)); return; }
      setMessagesByRoom((current) => ({
        ...current,
        [message.roomId]: mergeMessages(current[message.roomId] ?? [], [response.data.message]),
      }));
      setPendingMessage(null);
      setDraft('');
    } catch {
      setPendingMessage(message);
      setError('The send result was not confirmed. You can retry it manually.');
    } finally {
      setBusy(false);
    }
  }

  function submitMessage(): void {
    const text = draft.trim();
    if (!activeRoom || isGroupPreview || !text || busy) return;
    sendTyping(activeRoom.roomId, false);
    void sendWithId({ roomId: activeRoom.roomId, text, clientMessageId: crypto.randomUUID() });
  }

  function sendMessage(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitMessage();
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submitMessage();
  }

  async function createGroup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = groupName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current<GroupResult>('group.create', { name });
      if (!response.ok) { setError(errorMessage(response)); return; }
      const group = asJoinedGroup(response.data.group, snapshot.self.userId);
      setGroups((current) => mergeByRoomId(current, [group]));
      setActiveRoomId(group.roomId);
      setGroupName('');
      setShowCreateGroup(false);
    } catch {
      setError('Connection changed. Sign in again before using chat.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !deletePassword) return;
    setDeleteError(null);
    const deleted = await account.deleteAccount(deletePassword);
    if (!deleted) setDeleteError(account.error ?? 'Could not delete the account. Check your password and try again.');
  }

  return (
    <section className={styles.workspace} aria-label="Chat workspace">
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src="./talkmato-logo.svg" alt="Talkmato logo" />
          <strong>Talkmato</strong>
          <div className={styles.accountActions}><button type="button" className={styles.signOut} onClick={() => void account.logout()} disabled={account.busy}>Sign out</button></div>
        </div>
        <section>
          <h2>Online now</h2>
          <ul className={styles.userList}>
            {selfFirst(snapshot.users, snapshot.self.userId).map((user) => <li key={user.userId}>
              <button type="button" className={styles.personButton} onClick={() => void openPrivate(user.userId)} disabled={busy || user.userId === snapshot.self.userId}>
                <span className={styles.onlineDot} aria-hidden="true" />{user.name}
                {user.userId === snapshot.self.userId && <small>You</small>}
              </button>
            </li>)}
          </ul>
        </section>
        <section>
          <h2>Private chats</h2>
          <ul className={styles.roomList}>
            {privateRooms.length === 0 && <li className={styles.noRooms}>No private chats yet.</li>}
            {privateRooms.map((room) => <li key={room.roomId}>
              <button type="button" className={activeRoomId === room.roomId ? styles.activeRoom : undefined} onClick={() => setActiveRoomId(room.roomId)}>
                {roomTitle(room, snapshot.self.userId)}
              </button>
            </li>)}
          </ul>
        </section>
        <section>
          <div className={styles.sectionHeading}>
            <h2>Groups</h2><button type="button" onClick={() => setShowCreateGroup(true)} aria-label="Create group" disabled={busy}>+</button>
          </div>
          <ul className={styles.roomList}>
            {groups.map((group) => <li key={group.roomId}>
              <button type="button" className={activeRoomId === group.roomId ? styles.activeRoom : undefined} onClick={() => setActiveRoomId(group.roomId)}>
                <span aria-hidden="true">#</span>{group.name}
              </button>
            </li>)}
          </ul>
        </section>
        <div className={styles.sidebarFooter}><button type="button" className={styles.deleteAccount} onClick={() => { setDeleteError(null); setShowDeleteAccount(true); }} disabled={account.busy}>Delete account</button></div>
      </aside>

      <main className={styles.conversation}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pendingMessage && <button type="button" className={styles.retry} disabled={busy} onClick={() => void sendWithId(pendingMessage)}>Retry last message</button>}
        {!activeRoom && <div className={styles.emptyState}><img className={styles.emptyStateIcon} src="./chat-conversation-icon.svg" alt="Chat icon" /><h1>Choose a conversation</h1><p>Select a person or group to open a room.</p></div>}
        {activeRoom && <>
          <header className={styles.roomHeader}>
            <div><p>{activeRoom.kind === 'group' ? 'Group chat' : 'Private chat'}</p><h1>{roomTitle(activeRoom, snapshot.self.userId)}</h1></div>
            {activeRoom.kind === 'group' && <div ref={memberDetailsRef} className={styles.memberDetails}><button type="button" className={styles.memberButton} aria-expanded={showMemberDetails} onClick={() => setShowMemberDetails((shown) => !shown)}>{activeRoom.members.length} {activeRoom.members.length === 1 ? 'member' : 'members'}</button>{showMemberDetails && <div className={styles.memberPopover} role="dialog" aria-label="Group members"><strong>Members</strong><ul>{selfFirst(activeRoom.members, snapshot.self.userId).map((member) => <li key={member.userId}><span>{member.name}</span><small>{member.userId === snapshot.self.userId ? 'You' : member.online ? 'Online' : 'Offline'}</small></li>)}</ul></div>}</div>}
          </header>
          {isGroupPreview ? <section className={styles.groupPreview}><h2>Join to see the conversation</h2><p>Members are visible before joining. Earlier messages remain private.</p><div className={styles.previewMembers}><h3>Current members</h3><ul>{selfFirst(activeRoom.members, snapshot.self.userId).map((member) => <li key={member.userId}>{member.name}</li>)}</ul></div><button type="button" onClick={() => void joinGroup(activeRoom)} disabled={busy}>Join group</button></section> : <>
            <section ref={messageAreaRef} className={styles.messageArea}>
            <ol className={`${styles.messages} ${activeMessages.length === 0 ? styles.messagesEmpty : ''}`} aria-label="Messages" aria-busy={loadingRoomId === activeRoom.roomId}>
              {loadingRoomId === activeRoom.roomId && <li className={styles.noMessages}>Loading messages…</li>}
              {loadingRoomId !== activeRoom.roomId && activeMessages.length === 0 && <li className={styles.noMessages}>No messages yet.</li>}
              {activeMessages.map((message) => {
                const own = message.senderId === snapshot.self.userId;
                return <li key={message.messageId} className={own ? styles.ownMessage : styles.receivedMessage}>
                  {!own && activeRoom.kind === 'group' && <strong className={styles.messageSender}>{message.senderName}</strong>}
                  <div className={styles.messageBubble}><p>{message.text}</p><time>{displayTime(message.sentAt)}</time></div>
                  <MessageEmojiEffect roomId={activeRoom.roomId} messageId={message.messageId} request={account.request} />
                </li>;
              })}
            </ol>
            <p className={styles.typingStatus} aria-live="polite">{typingNames.length === 1 ? `${typingNames[0]} is typing…` : typingNames.length > 1 ? `${typingNames.join(', ')} are typing…` : ''}</p>
            </section>
            <form className={styles.composer} onSubmit={sendMessage}>
              <label className="srOnly" htmlFor="message-draft">Message {roomTitle(activeRoom, snapshot.self.userId)}</label>
              <textarea id="message-draft" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleMessageKeyDown} placeholder="Write a message…" rows={2} disabled={busy || loadingRoomId === activeRoom.roomId} />
              <button type="submit" disabled={busy || loadingRoomId === activeRoom.roomId || !draft.trim()}>Send</button>
            </form>
          </>}
        </>}
      </main>

      {showCreateGroup && <div className={styles.modalBackdrop} role="presentation"><form className={styles.modal} onSubmit={(event) => void createGroup(event)} aria-labelledby="create-group-title"><h2 id="create-group-title">Create group</h2><p>You will be the only member initially. Others choose to join themselves.</p><label htmlFor="group-name">Group name</label><input id="group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={64} autoFocus /><div className={styles.modalActions}><button type="button" onClick={() => setShowCreateGroup(false)}>Cancel</button><button type="submit" disabled={busy || !groupName.trim()}>Create group</button></div></form></div>}
      {showDeleteAccount && <div className={styles.modalBackdrop} role="presentation"><form className={styles.modal} onSubmit={(event) => void removeAccount(event)} aria-labelledby="delete-account-title"><h2 id="delete-account-title">Delete account?</h2><p>This cannot be undone. Your old messages will remain, but their sender will display as Unknown.</p><label htmlFor="delete-password">Confirm password</label><input id="delete-password" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" autoFocus />{deleteError && <p className={styles.deleteError} role="alert">{deleteError}</p>}<div className={styles.modalActions}><button type="button" onClick={() => setShowDeleteAccount(false)} disabled={busy}>Cancel</button><button type="submit" className={styles.dangerButton} disabled={busy || !deletePassword}>Delete permanently</button></div></form></div>}
    </section>
  );
}
