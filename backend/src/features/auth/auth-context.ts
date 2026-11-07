import type { AuthenticatedActor } from '../../lib/types.js';

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
    throw new Error('NOT_AUTHENTICATED');
  }

  return actor;
}
