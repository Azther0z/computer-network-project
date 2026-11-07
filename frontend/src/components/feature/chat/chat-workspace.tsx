'use client';

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { PendingMessage } from '../../../lib/chat-protocol';
import { mergeMessageEmojis } from '../../../lib/message-emojis';
import { roomTitle, selfFirst } from '../../../lib/room-display';
import type { SignedInAccount } from '../auth/use-account-auth';
import { useConversation } from './use-conversation';
import { useRoomTyping } from './use-room-typing';

import styles from './chat-workspace.module.css';
import { ChatSidebar } from './chat-sidebar';
import { GroupMemberDetails } from './group-member-details';
import { ChatMessageRow } from './chat-message-row';
import { CreateGroupDialog, DeleteAccountDialog } from './account-dialogs';

/** Composes chat views and local form state around the authenticated connection. */
export function ChatWorkspace({ account }: { account: SignedInAccount }) {
  const { snapshot, socket } = account;
  const {
    privateRooms,
    groups,
    activeRoomId,
    activeRoom,
    activeMessages,
    isGroupPreview,
    liveEmojis,
    busy,
    loadingRoomId,
    error,
    pendingMessage,
    selectRoom,
    openPrivate,
    joinGroup,
    createGroup,
    sendMessageWithId,
    rememberEmoji,
  } = useConversation(account);
  const [draft, setDraft] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const seenEmojiIds = useRef(new Set<string>());
  const [fireworkTarget, setFireworkTarget] = useState<HTMLDivElement | null>(null);
  const messageAreaRef = useRef<HTMLElement>(null);
  const { typingNames, stopTyping } = useRoomTyping({
    socket,
    request: account.request,
    room: activeRoom,
    selfId: snapshot.self.userId,
    draft,
    enabled: !isGroupPreview,
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (messageAreaRef.current) {
        messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeRoomId, activeMessages]);

  async function sendAndClearDraft(message: PendingMessage): Promise<void> {
    if (await sendMessageWithId(message)) {
      setDraft('');
    }
  }

  function submitDraft(): void {
    const text = draft.trim();
    if (!activeRoom || isGroupPreview || !text || busy) {
      return;
    }
    stopTyping();
    void sendAndClearDraft({
      roomId: activeRoom.roomId,
      text,
      clientMessageId: crypto.randomUUID(),
    });
  }

  function submitMessageForm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitDraft();
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    submitDraft();
  }

  async function submitGroupForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (await createGroup(groupName.trim())) {
      setGroupName('');
      setShowCreateGroup(false);
    }
  }

  async function removeAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !deletePassword) {
      return;
    }
    setDeleteError(null);
    const deleted = await account.deleteAccount(deletePassword);
    if (!deleted) {
      setDeleteError(
        account.error ?? 'Could not delete the account. Check your password and try again.',
      );
    }
  }

  return (
    <section className={styles.workspace} aria-label="Chat workspace">
      <ChatSidebar
        selfId={snapshot.self.userId}
        users={snapshot.users}
        privateRooms={privateRooms}
        groups={groups}
        activeRoomId={activeRoomId}
        busy={busy}
        accountBusy={account.busy}
        onOpenPrivate={(userId) => void openPrivate(userId)}
        onSelectRoom={selectRoom}
        onCreateGroup={() => setShowCreateGroup(true)}
        onDeleteAccount={() => {
          setDeleteError(null);
          setShowDeleteAccount(true);
        }}
        onLogout={() => void account.logout()}
      />

      <main className={styles.conversation}>
        <div ref={setFireworkTarget} className={styles.fireworkLayer} data-firework-layer="" />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {pendingMessage && (
          <button
            type="button"
            className={styles.retry}
            disabled={busy}
            onClick={() => void sendAndClearDraft(pendingMessage)}
          >
            Retry last message
          </button>
        )}
        {!activeRoom && (
          <div className={styles.emptyState}>
            <img
              className={styles.emptyStateIcon}
              src="./chat-conversation-icon.svg"
              alt="Chat icon"
            />
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
              {activeRoom.kind === 'group' && (
                <GroupMemberDetails
                  key={activeRoom.roomId}
                  members={activeRoom.members}
                  selfId={snapshot.self.userId}
                />
              )}
            </header>
            {activeRoom.kind === 'group' && isGroupPreview ? (
              <section className={styles.groupPreview}>
                <h2>Join to see the conversation</h2>
                <p>Members are visible before joining. Earlier messages remain private.</p>
                <div className={styles.previewMembers}>
                  <h3>Current members</h3>
                  <ul>
                    {selfFirst(activeRoom.members, snapshot.self.userId).map((member) => (
                      <li key={member.userId}>{member.name}</li>
                    ))}
                  </ul>
                </div>
                <button type="button" onClick={() => void joinGroup(activeRoom)} disabled={busy}>
                  Join group
                </button>
              </section>
            ) : (
              <>
                <section ref={messageAreaRef} className={styles.messageArea}>
                  <ol
                    className={`${styles.messages} ${activeMessages.length === 0 ? styles.messagesEmpty : ''}`}
                    aria-label="Messages"
                    aria-busy={loadingRoomId === activeRoom.roomId}
                  >
                    {loadingRoomId === activeRoom.roomId && (
                      <li className={styles.noMessages}>Loading messages…</li>
                    )}
                    {loadingRoomId !== activeRoom.roomId && activeMessages.length === 0 && (
                      <li className={styles.noMessages}>No messages yet.</li>
                    )}
                    {activeMessages.map((message) => (
                      <ChatMessageRow
                        key={message.messageId}
                        message={message}
                        selfId={snapshot.self.userId}
                        isGroup={activeRoom.kind === 'group'}
                        request={account.request}
                        attachments={mergeMessageEmojis(
                          message.emojis,
                          liveEmojis[message.messageId] ?? [],
                        )}
                        seenEmojiIds={seenEmojiIds.current}
                        fireworkTarget={fireworkTarget}
                        onAttachment={(attachment) =>
                          rememberEmoji({
                            roomId: activeRoom.roomId,
                            messageId: message.messageId,
                            attachment,
                          })
                        }
                      />
                    ))}
                  </ol>
                  <p className={styles.typingStatus} aria-live="polite">
                    {typingNames.length === 1
                      ? `${typingNames[0]} is typing…`
                      : typingNames.length > 1
                        ? `${typingNames.join(', ')} are typing…`
                        : ''}
                  </p>
                </section>
                <form className={styles.composer} onSubmit={submitMessageForm}>
                  <label className="srOnly" htmlFor="message-draft">
                    Message {roomTitle(activeRoom, snapshot.self.userId)}
                  </label>
                  <textarea
                    id="message-draft"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleMessageKeyDown}
                    placeholder="Write a message…"
                    rows={2}
                    disabled={busy || loadingRoomId === activeRoom.roomId}
                  />
                  <button
                    type="submit"
                    disabled={busy || loadingRoomId === activeRoom.roomId || !draft.trim()}
                  >
                    Send
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </main>

      {showCreateGroup && (
        <CreateGroupDialog
          name={groupName}
          busy={busy}
          onNameChange={setGroupName}
          onSubmit={submitGroupForm}
          onCancel={() => setShowCreateGroup(false)}
        />
      )}
      {showDeleteAccount && (
        <DeleteAccountDialog
          password={deletePassword}
          error={deleteError}
          busy={busy}
          onPasswordChange={setDeletePassword}
          onSubmit={removeAccount}
          onCancel={() => setShowDeleteAccount(false)}
        />
      )}
    </section>
  );
}
