import type { AuthenticatedActor } from '../../lib/types.js';
import { RequestError } from '../../lib/protocol.js';

type ActorSocket = {
  data: { actor?: AuthenticatedActor };
};

/**
 * auth.register/auth.login set this binding; logout/disconnect remove it.
 * Room/message code must always obtain its actor through this one boundary.
 */
export function requireActor(socket: ActorSocket): AuthenticatedActor {
  const actor = socket.data.actor;

  if (!actor) {
    throw new RequestError('NOT_AUTHENTICATED', 'Sign in before using chat.');
  }

  return actor;
}
