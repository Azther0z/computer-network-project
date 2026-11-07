import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatRequest, TypingUpdate } from '../../../lib/chat-protocol';
import type { GroupRoom, PrivateRoom } from '../../../lib/chat-types';
import type { AccountAuth } from '../auth/use-account-auth';

const ACTIVE_THROTTLE_MS = 500;
const REFRESH_INTERVAL_MS = 1_000;

type TypingConfiguration = {
  socket: NonNullable<AccountAuth['socket']>;
  request: ChatRequest;
  room: PrivateRoom | GroupRoom | null;
  selfId: string;
  draft: string;
  enabled: boolean;
};

/** Typing is temporary. Only room membership and message content are stored. */
export function useRoomTyping({
  socket,
  request,
  room,
  selfId,
  draft,
  enabled,
}: TypingConfiguration) {
  // Stable listeners still use the latest authenticated request function.
  const requestRef = useRef(request);
  requestRef.current = request;
  const typingRoomRef = useRef<string | null>(null);
  const lastActiveUpdateRef = useRef(0);
  const [typingByRoom, setTypingByRoom] = useState<Record<string, string[]>>({});

  const sendTyping = useCallback((roomId: string, isTyping: boolean) => {
    const now = Date.now();
    if (
      isTyping &&
      typingRoomRef.current === roomId &&
      now - lastActiveUpdateRef.current < ACTIVE_THROTTLE_MS
    ) {
      return;
    }
    if (isTyping) {
      typingRoomRef.current = roomId;
      lastActiveUpdateRef.current = now;
    } else if (typingRoomRef.current === roomId) {
      typingRoomRef.current = null;
    }
    // Draft status is best effort and is never buffered or retried.
    void requestRef.current('typing.set', { roomId, isTyping }).catch(() => {});
  }, []);

  useEffect(() => {
    const typingUpdated = ({ roomId, userId, isTyping }: TypingUpdate) => {
      setTypingByRoom((current) => {
        const users = new Set(current[roomId] ?? []);
        if (isTyping) {
          users.add(userId);
        } else {
          users.delete(userId);
        }
        return { ...current, [roomId]: [...users] };
      });
    };
    socket.on('typing.updated', typingUpdated);
    return () => {
      socket.off('typing.updated', typingUpdated);
    };
  }, [socket]);

  useEffect(
    () => () => {
      const previousRoomId = typingRoomRef.current;
      if (previousRoomId) {
        sendTyping(previousRoomId, false);
      }
    },
    [room?.roomId, sendTyping],
  );

  useEffect(() => {
    if (!room || !enabled || !draft.trim()) {
      const previousRoomId = typingRoomRef.current;
      if (previousRoomId) {
        sendTyping(previousRoomId, false);
      }
      return;
    }
    sendTyping(room.roomId, true);
    const interval = window.setInterval(() => sendTyping(room.roomId, true), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [room, draft, enabled, sendTyping]);

  const typingNames =
    room === null
      ? []
      : (typingByRoom[room.roomId] ?? [])
          .filter((userId) => userId !== selfId)
          .map((userId) => room.members.find((member) => member.userId === userId)?.name)
          .filter((name): name is string => name !== undefined);

  function stopTyping(): void {
    if (room) {
      sendTyping(room.roomId, false);
    }
  }

  return { typingNames, stopTyping };
}
