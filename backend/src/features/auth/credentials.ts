import { expectObject, RequestError } from '../../lib/protocol.js';

export type Credentials = { name: string; canonicalName: string; password: string };

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 32;

function validPasswordLength(password: string): boolean {
  const length = [...password].length;
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH;
}

export function readCredentials(payload: unknown): Credentials {
  const input = expectObject(payload);
  if (typeof input.name !== 'string' || typeof input.password !== 'string') {
    throw new RequestError('INVALID_PAYLOAD', 'Name and password are required.');
  }
  const name = input.name.trim().normalize('NFC');
  const nameLength = [...name].length;
  if (nameLength < 1 || nameLength > MAX_NAME_LENGTH || /\p{Cc}/u.test(name)) {
    throw new RequestError(
      'INVALID_PAYLOAD',
      'Name must contain 1–32 characters without control characters.',
    );
  }
  if (!validPasswordLength(input.password)) {
    throw new RequestError('INVALID_PAYLOAD', 'Password must contain 8–128 characters.');
  }
  return { name, canonicalName: name.toLowerCase(), password: input.password };
}

export function readPasswordConfirmation(payload: unknown): string {
  const input = expectObject(payload);
  if (typeof input.password !== 'string' || !validPasswordLength(input.password)) {
    throw new RequestError('INVALID_PAYLOAD', 'Password must contain 8–128 characters.');
  }
  return input.password;
}
