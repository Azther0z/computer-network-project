import { requireActor } from '../auth-context.js';
import { Storage } from '../storage.js';
import { DomainError, type AuthenticatedActor } from '../types.js';
import { allowedEmoji } from './catalog.js';
import { EmojiError, type EmojiSelector } from './clef.js';

type Ack = (value: { ok: true; data: { emoji: string } } | { ok: false; error: { code: string; message: string } }) => void;
type EmojiSocket = {
  connected: boolean;
  data: { actor?: AuthenticatedActor };
  on(event: string, listener: (...args: unknown[]) => void): void;
};
class RequestError extends Error { constructor(readonly code: string) { super(code); } }
const messages: Record<string, string> = {
  NOT_AUTHENTICATED: 'Sign in before using chat.',
  INVALID_PAYLOAD: 'Select a saved message for the AI effect.',
  NOT_MEMBER: 'Join the room before requesting an AI effect.',
  MESSAGE_NOT_AVAILABLE: 'This message is not available for an AI effect.',
  AI_UNAVAILABLE: 'The AI effect is unavailable. Try again later.',
  AI_INVALID_RESPONSE: 'The AI could not choose a valid emoji. You can try again.',
  AI_RATE_LIMITED: 'Please wait before requesting another AI effect.',
};
function input(payload: unknown): { roomId: string; messageId: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('INVALID_PAYLOAD');
  const value = payload as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || ['roomId', 'messageId'].some(key =>
    typeof value[key] !== 'string' || !value[key] || value[key].length > 128 || value[key] !== value[key].trim())) {
    throw new RequestError('INVALID_PAYLOAD');
  }
  return { roomId: value.roomId as string, messageId: value.messageId as string };
}

/** Acknowledgements only. No AI input, result or effect is stored or broadcast. */
export class EmojiEffects {
  private readonly active = new Set<string>();
  private readonly nextAllowed = new Map<string, number>();

  constructor(private readonly storage: Storage, private readonly selector: EmojiSelector,
    private readonly options: { now?: () => number; cooldownMs?: number; concurrency?: number } = {}) {}

  private begin(userId: string): void {
    const now = (this.options.now ?? Date.now)();
    for (const [id, expiry] of this.nextAllowed) if (expiry <= now) this.nextAllowed.delete(id);
    if (this.active.has(userId) || this.active.size >= (this.options.concurrency ?? 2) ||
        (this.nextAllowed.get(userId) ?? 0) > now) throw new EmojiError('AI_RATE_LIMITED');
    this.active.add(userId);
    this.nextAllowed.set(userId, now + (this.options.cooldownMs ?? 10_000));
  }

  register(socket: EmojiSocket): void {
    const pending = new Set<AbortController>();
    const cancel = () => { for (const controller of pending) controller.abort(); };
    socket.on('disconnect', cancel);
    socket.on('auth.logout', cancel);
    socket.on('message.emojiSuggest', async (payload, acknowledgement) => {
      if (typeof acknowledgement !== 'function') return;
      const ack = acknowledgement as Ack;
      let userId: string | undefined;
      let controller: AbortController | undefined;
      try {
        const actor = requireActor(socket);
        if (!socket.connected) throw new RequestError('NOT_AUTHENTICATED');
        const request = input(payload);
        this.storage.assertMember(actor.userId, request.roomId);
        const message = this.storage.getVisibleMessage(actor.userId, request.roomId, request.messageId);
        if (!message) throw new RequestError('MESSAGE_NOT_AVAILABLE');
        this.begin(actor.userId);
        userId = actor.userId;
        controller = new AbortController();
        pending.add(controller);
        const emoji = await this.selector.suggest(message.text, controller.signal);
        if (!socket.connected || socket.data.actor !== actor || controller.signal.aborted) {
          throw new RequestError('NOT_AUTHENTICATED');
        }
        if (!this.storage.getVisibleMessage(actor.userId, request.roomId, request.messageId)) {
          throw new RequestError('MESSAGE_NOT_AVAILABLE');
        }
        if (!allowedEmoji.has(emoji)) throw new EmojiError('AI_INVALID_RESPONSE');
        ack({ ok: true, data: { emoji } });
      } catch (error) {
        const code = error instanceof EmojiError || error instanceof RequestError || error instanceof DomainError ? error.code :
          error instanceof Error && error.message === 'NOT_AUTHENTICATED' ? 'NOT_AUTHENTICATED' : 'INTERNAL_ERROR';
        ack({ ok: false, error: { code, message: messages[code] ?? 'The AI effect could not be completed.' } });
      } finally {
        if (userId) this.active.delete(userId);
        if (controller) pending.delete(controller);
      }
    });
  }
}
