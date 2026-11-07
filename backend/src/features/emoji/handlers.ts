import { requireActor } from '../auth/auth-context.js';
import { Storage } from '../../database/storage.js';
import type { AuthenticatedActor, MessageEmoji } from '../../lib/types.js';
import { isRecord, RequestError, requestErrorCode, type Acknowledge } from '../../lib/protocol.js';
import { allowedEmoji } from './catalog.js';
import type { EmojiSelector } from './clef.js';
import { EmojiError } from './emoji-error.js';

type EmojiResult = { emoji: string; attachment: MessageEmoji };
type EmojiSocket = {
  connected: boolean;
  data: { actor?: AuthenticatedActor };
  on(event: string, listener: (...args: unknown[]) => void): void;
};
const messages: Record<string, string> = {
  NOT_AUTHENTICATED: 'Sign in before using chat.',
  INVALID_PAYLOAD: 'Select a saved message for the AI effect.',
  NOT_MEMBER: 'Join the room before requesting an AI effect.',
  MESSAGE_NOT_AVAILABLE: 'This message is not available for an AI effect.',
  AI_UNAVAILABLE: 'The AI effect is unavailable. Try again later.',
  AI_INVALID_RESPONSE: 'The AI could not choose a valid emoji. You can try again.',
  AI_RATE_LIMITED: 'Please wait before requesting another AI effect.',
};
function readEmojiRequest(payload: unknown): { roomId: string; messageId: string } {
  if (!isRecord(payload)) {
    throw new RequestError('INVALID_PAYLOAD');
  }
  const value = payload as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    ['roomId', 'messageId'].some(
      (key) =>
        typeof value[key] !== 'string' ||
        !value[key] ||
        value[key].length > 128 ||
        value[key] !== value[key].trim(),
    )
  ) {
    throw new RequestError('INVALID_PAYLOAD');
  }
  return { roomId: value.roomId as string, messageId: value.messageId as string };
}

/** Persist the first result before delivery; room channels are never authorization. */
export class EmojiEffects {
  private readonly activeUserIds = new Set<string>();
  private readonly activeMessageIds = new Set<string>();
  private readonly nextAllowedAtByUserId = new Map<string, number>();

  constructor(
    private readonly storage: Storage,
    private readonly selector: EmojiSelector,
    private readonly options: {
      now?: () => number;
      cooldownMs?: number;
      concurrency?: number;
      emitToUser?: (userId: string, event: string, payload: unknown) => void;
    } = {},
  ) {}

  private reserveSelection(userId: string, messageId: string): void {
    const now = (this.options.now ?? Date.now)();
    for (const [id, expiry] of this.nextAllowedAtByUserId) {
      if (expiry <= now) {
        this.nextAllowedAtByUserId.delete(id);
      }
    }
    const accountBusy = this.activeUserIds.has(userId);
    const messageBusy = this.activeMessageIds.has(messageId);
    const capacityReached = this.activeUserIds.size >= (this.options.concurrency ?? 2);
    const coolingDown = (this.nextAllowedAtByUserId.get(userId) ?? 0) > now;
    if (accountBusy || messageBusy || capacityReached || coolingDown) {
      throw new EmojiError('AI_RATE_LIMITED');
    }
    this.activeUserIds.add(userId);
    this.activeMessageIds.add(messageId);
    this.nextAllowedAtByUserId.set(userId, now + (this.options.cooldownMs ?? 1_000));
  }

  private broadcastAttachment(roomId: string, messageId: string, attachment: MessageEmoji): void {
    // Delivery channels can be stale. Check each recipient against persisted visibility.
    for (const member of this.storage.getRoomMembers(roomId)) {
      if (this.storage.isMessageVisibleTo(member.userId, roomId, messageId)) {
        this.options.emitToUser?.(member.userId, 'message.emojiAdded', {
          roomId,
          messageId,
          attachment,
        });
      }
    }
  }

  register(socket: EmojiSocket): void {
    const pending = new Set<AbortController>();
    const cancel = () => {
      for (const controller of pending) {
        controller.abort();
      }
    };
    socket.on('disconnect', cancel);
    socket.on('auth.logout', cancel);
    socket.on('message.emojiSuggest', async (payload, acknowledgement) => {
      if (typeof acknowledgement !== 'function') {
        return;
      }
      const ack = acknowledgement as Acknowledge<EmojiResult>;
      let userId: string | undefined;
      let activeMessageId: string | undefined;
      let controller: AbortController | undefined;
      try {
        const actor = requireActor(socket);
        if (!socket.connected) {
          throw new RequestError('NOT_AUTHENTICATED');
        }
        const request = readEmojiRequest(payload);
        this.storage.assertMember(actor.userId, request.roomId);
        const message = this.storage.getVisibleMessage(
          actor.userId,
          request.roomId,
          request.messageId,
        );
        if (!message) {
          throw new RequestError('MESSAGE_NOT_AVAILABLE');
        }
        const saved = message.emojis[0];
        if (saved) {
          ack({ ok: true, data: { emoji: saved.emoji, attachment: saved } });
          return;
        }
        this.reserveSelection(actor.userId, request.messageId);
        userId = actor.userId;
        activeMessageId = request.messageId;
        controller = new AbortController();
        pending.add(controller);
        const emoji = await this.selector.suggest(message.text, controller.signal);
        if (!socket.connected || socket.data.actor !== actor || controller.signal.aborted) {
          throw new RequestError('NOT_AUTHENTICATED');
        }
        if (!this.storage.getVisibleMessage(actor.userId, request.roomId, request.messageId)) {
          throw new RequestError('MESSAGE_NOT_AVAILABLE');
        }
        if (!allowedEmoji.has(emoji)) {
          throw new EmojiError('AI_INVALID_RESPONSE');
        }
        const { attachment, created } = this.storage.attachMessageEmoji(
          actor.userId,
          request.roomId,
          request.messageId,
          emoji,
        );
        if (created) {
          this.broadcastAttachment(request.roomId, request.messageId, attachment);
        }
        ack({ ok: true, data: { emoji: attachment.emoji, attachment } });
      } catch (error) {
        const code = requestErrorCode(error);
        ack({
          ok: false,
          error: { code, message: messages[code] ?? 'The AI effect could not be completed.' },
        });
      } finally {
        if (userId) {
          this.activeUserIds.delete(userId);
        }
        if (activeMessageId) {
          this.activeMessageIds.delete(activeMessageId);
        }
        if (controller) {
          pending.delete(controller);
        }
      }
    });
  }
}
