'use client';

import { AuthGate } from './auth/auth-gate';
import { ChatWorkspace } from './chat-workspace';

/** Keeps AuthGate's render callback inside the client component boundary. */
export function ChatApp() {
  return <AuthGate>{(account) => <ChatWorkspace account={account} />}</AuthGate>;
}
