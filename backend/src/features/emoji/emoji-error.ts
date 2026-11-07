import { RequestError } from '../../lib/protocol.js';

export class EmojiError extends RequestError {
  constructor(readonly code: 'AI_UNAVAILABLE' | 'AI_INVALID_RESPONSE' | 'AI_RATE_LIMITED') {
    super(code);
  }
}
