import type { AuthenticatedActor } from './types.js';

type ActorSocket = {
  data: { actor?: AuthenticatedActor };
};

/**
 * Guitar replaces this temporary guard with auth.register/auth.login socket binding.
 * Room/message code must always obtain its actor through this one boundary.
 */
export function requireActor(socket: ActorSocket): AuthenticatedActor {
  const actor = socket.data.actor;

  if (!actor) {
    throw new Error('NOT_AUTHENTICATED');
  }

  return actor;
}
