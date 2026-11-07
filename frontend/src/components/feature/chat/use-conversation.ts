import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ack } from '../../../lib/account-types';
import type {
  ChatMessage,
  GroupRoom,
  MessageEmoji,
  MessageEmojiAdded,
  PrivateRoom,
} from '../../../lib/chat-types';
import type { PendingMessage } from '../../../lib/chat-protocol';
import { mergeMessages, mergeRooms, withJoinedStatus } from '../../../lib/conversation-state';
import { isMessageEmoji, mergeMessageEmojis } from '../../../lib/message-emojis';
import type { SignedInAccount } from '../auth/use-account-auth';

const EMPTY_MESSAGES: ChatMessage[] = [];
const CONNECTION_CHANGED = 'Connection changed. Sign in again before using chat.';

function chatError(response: Ack<unknown>): string {
  if (response.ok) {
    return '';
  }
  const messages: Record<string, string> = {
    NOT_MEMBER: 'Join this group before viewing or sending messages.',
    USER_OFFLINE: 'That person is no longer online.',
    CLIENT_MESSAGE_ID_CONFLICT: 'This message retry conflicts with an earlier message.',
    INVALID_PAYLOAD: 'Please check the information and try again.',
  };
  return (
    messages[response.error.code] ?? 'That chat request could not be completed. Please try again.'
  );
}

/** Owns room state and synchronization. AuthGate owns the supplied connection. */
export function useConversation(account: SignedInAccount) {
  const { snapshot, socket } = account;
  // Stable listeners still use the latest authenticated request function.
  const requestRef = useRef(account.request);
  requestRef.current = account.request;
  const selfId = snapshot.self.userId;
  const [privateRooms, setPrivateRooms] = useState<PrivateRoom[]>(snapshot.privateRooms);
  const [groups, setGroups] = useState<GroupRoom[]>(() =>
    snapshot.groups.map((group) => withJoinedStatus(group, selfId)),
  );
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>({});
  // An attachment can arrive before its message history page or while its room is closed.
  const [liveEmojis, setLiveEmojis] = useState<Record<string, MessageEmoji[]>>({});
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingRoomId, setLoadingRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);

  const rememberEmoji = useCallback(({ messageId, attachment }: MessageEmojiAdded) => {
    if (!isMessageEmoji(attachment)) {
      return;
    }
    setLiveEmojis((current) => ({
      ...current,
      [messageId]: mergeMessageEmojis(current[messageId] ?? [], [attachment]),
    }));
  }, []);

  useEffect(() => {
    setPrivateRooms((current) => mergeRooms(current, snapshot.privateRooms));
    setGroups((current) =>
      mergeRooms(
        current,
        snapshot.groups.map((group) => withJoinedStatus(group, selfId)),
      ),
    );
  }, [snapshot.groups, snapshot.privateRooms, selfId]);

  useEffect(() => {
    const privateOpened = ({ room }: { room: PrivateRoom }) => {
      setPrivateRooms((current) => mergeRooms(current, [room]));
    };
    const messageCreated = (message: ChatMessage) => {
      setMessagesByRoom((current) => ({
        ...current,
        [message.roomId]: mergeMessages(current[message.roomId] ?? [], [message]),
      }));
    };
    socket.on('private.opened', privateOpened);
    socket.on('private.updated', privateOpened);
    socket.on('message.created', messageCreated);
    socket.on('message.emojiAdded', rememberEmoji);
    return () => {
      socket.off('private.opened', privateOpened);
      socket.off('private.updated', privateOpened);
      socket.off('message.created', messageCreated);
      socket.off('message.emojiAdded', rememberEmoji);
    };
  }, [socket, rememberEmoji]);

  const rooms = useMemo(() => [...privateRooms, ...groups], [groups, privateRooms]);
  const activeRoom = rooms.find((room) => room.roomId === activeRoomId) ?? null;
  const isGroupPreview = activeRoom?.kind === 'group' && !activeRoom.joined;
  const activeMessages =
    activeRoomId === null ? EMPTY_MESSAGES : (messagesByRoom[activeRoomId] ?? EMPTY_MESSAGES);

  useEffect(() => {
    if (!activeRoom || isGroupPreview) {
      return;
    }
    let cancelled = false;
    setLoadingRoomId(activeRoom.roomId);
    setError(null);
    void requestRef
      .current('room.history', { roomId: activeRoom.roomId })
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(chatError(response));
          return;
        }
        setMessagesByRoom((current) => ({
          ...current,
          [response.data.roomId]: mergeMessages(
            current[response.data.roomId] ?? [],
            response.data.messages,
          ),
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setError(CONNECTION_CHANGED);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRoomId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRoom, isGroupPreview]);

  async function openPrivate(peerId: string): Promise<void> {
    if (peerId === selfId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current('private.open', { peerId });
      if (!response.ok) {
        setError(chatError(response));
        return;
      }
      setPrivateRooms((current) => mergeRooms(current, [response.data.room]));
      setActiveRoomId(response.data.room.roomId);
    } catch {
      setError(CONNECTION_CHANGED);
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup(group: GroupRoom): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current('group.join', { roomId: group.roomId });
      if (!response.ok) {
        setError(chatError(response));
        return;
      }
      setGroups((current) => mergeRooms(current, [withJoinedStatus(response.data.group, selfId)]));
    } catch {
      setError(CONNECTION_CHANGED);
    } finally {
      setBusy(false);
    }
  }

  /** Unknown outcomes retain the exact ID and text for an explicit manual retry. */
  async function sendMessageWithId(message: PendingMessage): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current('room.send', message);
      if (!response.ok) {
        setError(chatError(response));
        return false;
      }
      setMessagesByRoom((current) => ({
        ...current,
        [message.roomId]: mergeMessages(current[message.roomId] ?? [], [response.data.message]),
      }));
      setPendingMessage(null);
      return true;
    } catch {
      setPendingMessage(message);
      setError('The send result was not confirmed. You can retry it manually.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(name: string): Promise<boolean> {
    if (!name || busy) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await requestRef.current('group.create', { name });
      if (!response.ok) {
        setError(chatError(response));
        return false;
      }
      const group = withJoinedStatus(response.data.group, selfId);
      setGroups((current) => mergeRooms(current, [group]));
      setActiveRoomId(group.roomId);
      return true;
    } catch {
      setError(CONNECTION_CHANGED);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
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
    selectRoom: setActiveRoomId,
    openPrivate,
    joinGroup,
    createGroup,
    sendMessageWithId,
    rememberEmoji,
  };
}
