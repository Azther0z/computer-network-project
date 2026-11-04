import type { Socket } from 'socket.io';

import type { AuthenticatedActor } from './types.js';

/**
 * Guitar replaces this temporary guard with auth.register/auth.login socket binding.
 * Room/message code must always obtain its actor through this one boundary.
 */
export function requireActor(socket: Socket): AuthenticatedActor {
  const actor = socket.data.actor as AuthenticatedActor | undefined;

  if (!actor) {
    throw new Error('NOT_AUTHENTICATED');
  }

  return actor;
}
