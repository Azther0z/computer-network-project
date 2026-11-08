'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { AccountSnapshot, Ack } from '@/lib/account-types';
import type { ChatMessage, GroupRoom, MessageEmoji, MessageEmojiAdded, PrivateRoom } from '@/lib/chat-types';
import { isMessageEmoji, mergeMessageEmojis } from '../../../lib/message-emojis';
import type { AccountAuth } from '@/components/feature/auth/use-account-auth';

import styles from './chat-workspace.module.css';
import { MessageEmojiEffect } from './emoji/message-emoji-effect';
import { useRoomHistory, type HistoryPage } from './use-room-history';

type SignedInAccount = AccountAuth & {
  snapshot: AccountSnapshot;
  readOnly?: boolean;
};
type Room = PrivateRoom | GroupRoom;
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
  for (const message of incoming) {
    const previous = messages.get(message.messageId);
    messages.set(message.messageId, { ...message, emojis: mergeMessageEmojis(previous?.emojis ?? [], message.emojis ?? []) });
  }
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
  const readOnly = account.readOnly ?? false;
  const requestRef = useRef(account.request);
  requestRef.current = account.request;
  const [privateRooms, setPrivateRooms] = useState<PrivateRoom[]>(snapshot.privateRooms);
  const [groups, setGroups] = useState<GroupRoom[]>(() =>
    snapshot.groups.map((group) => asJoinedGroup(group, snapshot.self.userId)),
  );
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  // Keep attachments that arrive before their history page, or while another room is open.
  const [liveEmojis, setLiveEmojis] = useState<Record<string, MessageEmoji[]>>({});
  const seenEmojiIds = useRef(new Set<string>());
  const [fireworkTarget, setFireworkTarget] = useState<HTMLDivElement | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
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
  const composing = useRef(false);
  const scrollAnchor = useRef<{ top: number; height: number } | null>(null);
  const followLatest = useRef(true);
  const scrolledRoom = useRef<string | null>(null);

  const rememberEmoji = useCallback(({ messageId, attachment }: MessageEmojiAdded) => {
    if (!isMessageEmoji(attachment)) return;
    setLiveEmojis(current => ({ ...current, [messageId]: mergeMessageEmojis(current[messageId] ?? [], [attachment]) }));
  }, []);

  const sendTyping = useCallback((roomId: string, isTyping: boolean) => {
    if (readOnly) return;
    const now = Date.now();
    if (isTyping && typingRoomRef.current === roomId && now - lastTypingUpdateRef.current < 500) return;
    if (isTyping) {
      typingRoomRef.current = roomId;
      lastTypingUpdateRef.current = now;
    } else if (typingRoomRef.current === roomId) {
      typingRoomRef.current = null;
    }
    void requestRef.current('typing.set', { roomId, isTyping }).catch(() => {});
  }, [readOnly]);

  useEffect(() => {
    setPrivateRooms((current) => mergeByRoomId(current, snapshot.privateRooms));
    setGroups((current) => mergeByRoomId(
      current,
      snapshot.groups.map((group) => asJoinedGroup(group, snapshot.self.userId)),
    ));
  }, [snapshot.groups, snapshot.privateRooms, snapshot.self.userId]);

  useEffect(() => {
    if (!socket || readOnly) return;
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
    socket.on('message.emojiAdded', rememberEmoji);
    socket.on('typing.updated', typingUpdated);
    return () => {
      socket.off('private.opened', privateOpened);
      socket.off('private.updated', privateOpened);
      socket.off('message.created', messageCreated);
      socket.off('message.emojiAdded', rememberEmoji);
      socket.off('typing.updated', typingUpdated);
    };
  }, [socket, readOnly, rememberEmoji]);

  const rooms = useMemo<Room[]>(() => [...privateRooms, ...groups], [groups, privateRooms]);
  const activeRoom = rooms.find((room) => room.roomId === activeRoomId) ?? null;
  const isGroupPreview = activeRoom?.kind === 'group' && !activeRoom.joined;
  const activeMessages = useMemo(() => activeRoomId === null ? [] : messagesByRoom[activeRoomId] ?? [], [activeRoomId, messagesByRoom]);
  const typingNames = activeRoom === null || readOnly ? [] : (typingByRoom[activeRoom.roomId] ?? [])
    .filter((userId) => userId !== snapshot.self.userId)
    .map((userId) => activeRoom.members.find((member) => member.userId === userId)?.name)
    .filter((name): name is string => name !== undefined);

  useEffect(() => () => {
    const roomId = typingRoomRef.current;
    if (roomId) sendTyping(roomId, false);
  }, [activeRoom?.roomId, sendTyping]);

  useEffect(() => {
    if (readOnly || !activeRoom || isGroupPreview || !draft.trim()) {
      const roomId = typingRoomRef.current;
      if (roomId) sendTyping(roomId, false);
      return;
    }
    sendTyping(activeRoom.roomId, true);
    const refresh = window.setInterval(() => sendTyping(activeRoom.roomId, true), 1_000);
    return () => window.clearInterval(refresh);
  }, [activeRoom, draft, isGroupPreview, readOnly, sendTyping]);

  useLayoutEffect(() => {
    const area = messageAreaRef.current;
    if (!area) return;
    if (scrolledRoom.current !== activeRoomId) {
      scrolledRoom.current = activeRoomId;
      scrollAnchor.current = null;
      followLatest.current = true;
    }
    if (scrollAnchor.current) {
      const anchor = scrollAnchor.current;
      area.scrollTop = anchor.top + area.scrollHeight - anchor.height;
      scrollAnchor.current = null;
    } else if (followLatest.current) {
      area.scrollTop = area.scrollHeight;
    }
  }, [activeRoomId, activeMessages]);

  const acceptHistory = useCallback((page: HistoryPage, older: boolean) => {
    const area = messageAreaRef.current;
    if (older && area) scrollAnchor.current = { top: area.scrollTop, height: area.scrollHeight };
    setMessagesByRoom(current => ({
      ...current,
      [page.roomId]: mergeMessages(
        older ? current[page.roomId] ?? [] : (current[page.roomId] ?? []).filter(message => (message.seq ?? 0) > page.highWatermarkSeq),
        page.messages,
      ),
    }));
  }, []);
  const history = useRoomHistory({
    roomId: activeRoom && !isGroupPreview ? activeRoom.roomId : null,
    enabled: !readOnly,
    connectionId: socket?.id,
    request: account.request,
    onPage: acceptHistory,
  });

  useEffect(() => {
    if (readOnly) {
      setTypingByRoom({});
      setDeletePassword('');
      setShowDeleteAccount(false);
      composing.current = false;
    }
  }, [readOnly]);

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

  async function openPrivate(peerId: string): Promise<void> {
    if (readOnly || peerId === snapshot.self.userId || busy) return;
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
    if (readOnly || busy) return;
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
    if (readOnly || busy) return;
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
    if (readOnly || !activeRoom || isGroupPreview || !text || busy || [...text].length > 4000) return;
    sendTyping(activeRoom.roomId, false);
    void sendWithId({ roomId: activeRoom.roomId, text, clientMessageId: crypto.randomUUID() });
  }

  function sendMessage(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitMessage();
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submitMessage();
  }

  async function createGroup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = groupName.trim();
    if (readOnly || !name || [...name].length > 64 || busy) return;
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
    if (readOnly || busy || !deletePassword) return;
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
          <div className={styles.accountActions}><button type="button" className={styles.signOut} onClick={() => void account.logout()} disabled={account.busy || readOnly}>Sign out</button></div>
        </div>
        <section>
          <h2>{readOnly ? 'Last known online' : 'Online now'}</h2>
          <ul className={styles.userList}>
            {selfFirst(snapshot.users, snapshot.self.userId).map((user) => <li key={user.userId}>
              <button type="button" className={styles.personButton} onClick={() => void openPrivate(user.userId)} disabled={readOnly || busy || user.userId === snapshot.self.userId}>
                <span className={readOnly ? styles.offlineDot : styles.onlineDot} aria-hidden="true" />{user.name}
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
            <h2>Groups</h2><button type="button" onClick={() => setShowCreateGroup(true)} aria-label="Create group" disabled={readOnly || busy}>+</button>
          </div>
          <ul className={styles.roomList}>
            {groups.map((group) => <li key={group.roomId}>
              <button type="button" className={activeRoomId === group.roomId ? styles.activeRoom : undefined} onClick={() => setActiveRoomId(group.roomId)}>
                <span aria-hidden="true">#</span>{group.name}
              </button>
            </li>)}
          </ul>
        </section>
        <div className={styles.sidebarFooter}><button type="button" className={styles.deleteAccount} onClick={() => { setDeleteError(null); setShowDeleteAccount(true); }} disabled={account.busy || readOnly}>Delete account</button></div>
      </aside>

      <main className={styles.conversation}>
        {readOnly && <p className={styles.connectionNotice} role="status">
          Connection lost. Cached messages are read-only. Reconnecting…
          <button type="button" onClick={account.reconnect}>Reconnect</button>
        </p>}
        <div ref={setFireworkTarget} className={styles.fireworkLayer} data-firework-layer="" />
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pendingMessage && <button type="button" className={styles.retry} disabled={readOnly || busy} onClick={() => void sendWithId(pendingMessage)}>Retry last message</button>}
        {!activeRoom && <div className={styles.emptyState}><img className={styles.emptyStateIcon} src="./chat-conversation-icon.svg" alt="Chat icon" /><h1>Choose a conversation</h1><p>Select a person or group to open a room.</p></div>}
        {activeRoom && <>
          <header className={styles.roomHeader}>
            <div><p>{activeRoom.kind === 'group' ? 'Group chat' : 'Private chat'}</p><h1>{roomTitle(activeRoom, snapshot.self.userId)}</h1></div>
            {activeRoom.kind === 'group' && <div ref={memberDetailsRef} className={styles.memberDetails}><button type="button" className={styles.memberButton} aria-expanded={showMemberDetails} onClick={() => setShowMemberDetails((shown) => !shown)}>{activeRoom.members.length} {activeRoom.members.length === 1 ? 'member' : 'members'}</button>{showMemberDetails && <div className={styles.memberPopover} role="dialog" aria-label="Group members"><strong>Members</strong><ul>{selfFirst(activeRoom.members, snapshot.self.userId).map((member) => <li key={member.userId}><span>{member.name}</span><small>{member.userId === snapshot.self.userId ? 'You' : member.online ? 'Online' : 'Offline'}</small></li>)}</ul></div>}</div>}
          </header>
          {isGroupPreview ? <section className={styles.groupPreview}><h2>Join to see the conversation</h2><p>Members are visible before joining. Earlier messages remain private.</p><div className={styles.previewMembers}><h3>Current members</h3><ul>{selfFirst(activeRoom.members, snapshot.self.userId).map((member) => <li key={member.userId}>{member.name}</li>)}</ul></div><button type="button" onClick={() => void joinGroup(activeRoom)} disabled={readOnly || busy}>Join group</button></section> : <>
            <section ref={messageAreaRef} className={styles.messageArea} onScroll={() => {
              const area = messageAreaRef.current;
              if (area) followLatest.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
            }}>
            {history.canLoadOlder && <button type="button" className={styles.historyControl} onClick={history.loadOlder} disabled={readOnly || history.loading}>Load older</button>}
            {history.failed && <div className={styles.historyError} role="alert">Could not load saved messages. <button type="button" onClick={history.retry} disabled={readOnly || history.loading}>Retry history</button></div>}
            <ol className={`${styles.messages} ${activeMessages.length === 0 ? styles.messagesEmpty : ''}`} aria-label="Messages" aria-busy={history.loading}>
              {history.loading && activeMessages.length === 0 && <li className={styles.noMessages}>Loading messages…</li>}
              {!history.loading && activeMessages.length === 0 && <li className={styles.noMessages}>No messages yet.</li>}
              {activeMessages.map((message) => {
                const own = message.senderId === snapshot.self.userId;
                const showSender = !own && activeRoom.kind === 'group';
                return <li key={message.messageId} className={`${styles.messageRow} ${own ? `${styles.ownMessageRow} ${styles.ownMessage}` : ''} ${showSender ? styles.groupMessageRow : ''}`}>
                  {showSender && <strong className={styles.messageSender}>{message.senderName}</strong>}
                  <div className={styles.messageBubble}><p>{message.text}</p><time>{displayTime(message.sentAt)}</time></div>
                  <MessageEmojiEffect roomId={activeRoom.roomId} messageId={message.messageId} request={account.request} disabled={readOnly}
                    attachments={mergeMessageEmojis(message.emojis ?? [], liveEmojis[message.messageId] ?? [])} seenEmojiIds={seenEmojiIds.current} fireworkTarget={fireworkTarget}
                    onAttachment={attachment => rememberEmoji({ roomId: activeRoom.roomId, messageId: message.messageId, attachment })} />
                </li>;
              })}
            </ol>
            <p className={styles.typingStatus} aria-live="polite">{typingNames.length === 1 ? `${typingNames[0]} is typing…` : typingNames.length > 1 ? `${typingNames.join(', ')} are typing…` : ''}</p>
            </section>
            <form className={styles.composer} onSubmit={sendMessage}>
              <label className="srOnly" htmlFor="message-draft">Message {roomTitle(activeRoom, snapshot.self.userId)}</label>
              <textarea id="message-draft" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleMessageKeyDown} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} placeholder="Write a message…" rows={2} disabled={readOnly || busy || history.loading} />
              <button type="submit" disabled={readOnly || busy || history.loading || !draft.trim() || [...draft.trim()].length > 4000}>Send</button>
            </form>
          </>}
        </>}
      </main>

      {showCreateGroup && <div className={styles.modalBackdrop} role="presentation"><form className={styles.modal} onSubmit={(event) => void createGroup(event)} aria-labelledby="create-group-title"><h2 id="create-group-title">Create group</h2><p>You will be the only member initially. Others choose to join themselves.</p><label htmlFor="group-name">Group name</label><input id="group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} autoFocus /><div className={styles.modalActions}><button type="button" onClick={() => setShowCreateGroup(false)}>Cancel</button><button type="submit" disabled={readOnly || busy || !groupName.trim() || [...groupName.trim()].length > 64}>Create group</button></div></form></div>}
      {showDeleteAccount && <div className={styles.modalBackdrop} role="presentation"><form className={styles.modal} onSubmit={(event) => void removeAccount(event)} aria-labelledby="delete-account-title"><h2 id="delete-account-title">Delete account?</h2><p>This cannot be undone. Your old messages will remain, but their sender will display as Unknown.</p><label htmlFor="delete-password">Confirm password</label><input id="delete-password" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" autoFocus />{deleteError && <p className={styles.deleteError} role="alert">{deleteError}</p>}<div className={styles.modalActions}><button type="button" onClick={() => setShowDeleteAccount(false)} disabled={readOnly || busy}>Cancel</button><button type="submit" className={styles.dangerButton} disabled={readOnly || busy || !deletePassword}>Delete permanently</button></div></form></div>}
    </section>
  );
}
