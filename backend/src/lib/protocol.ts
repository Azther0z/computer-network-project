import { DomainError } from './types.js';

export type ProtocolError = { code: string; message: string };

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ProtocolError };

export type Acknowledge<T = unknown> = (response: AckResponse<T>) => void;

/** Expected request failures are safe to return. Unexpected errors stay private. */
export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string = code,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export function requestErrorCode(error: unknown): string {
  if (error instanceof RequestError || error instanceof DomainError) {
    return error.code;
  }
  return 'INTERNAL_ERROR';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RequestError('INVALID_PAYLOAD', 'Payload must be an object.');
  }
  return value;
}

export function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new RequestError('INVALID_PAYLOAD', `${field} must be a string.`);
  }
  return value;
}

export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}
