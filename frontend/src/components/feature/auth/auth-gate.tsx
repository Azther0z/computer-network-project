'use client';

import { useState, type ReactNode } from 'react';
import { useAccountAuth, type AccountAuth } from './use-account-auth';
import type { AuthMode } from '../../../lib/account-types';
import { RegisterForm, SignInForm } from './account-form';
import { AccountDirectory } from './account-directory';
import { Brand } from '../../ui/brand';
import styles from './auth.module.css';

type SignedIn = AccountAuth & {
  snapshot: NonNullable<AccountAuth['snapshot']>;
  socket: NonNullable<AccountAuth['socket']>;
};

/** Supplies the same authenticated socket to the conversation UI through children. */
export function AuthGate({ children }: { children?: (account: SignedIn) => ReactNode }) {
  const auth = useAccountAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const connected = auth.status === 'connected';
  if (auth.snapshot && auth.socket && connected) {
    return <section className={styles.account} aria-label="Talkmato account">
      {children ? children({ ...auth, snapshot: auth.snapshot, socket: auth.socket })
        : <AccountDirectory snapshot={auth.snapshot} busy={auth.busy} logout={auth.logout} />}
    </section>;
  }
  if (connected && !auth.sessionChecked) {
    return <section className={styles.account} aria-label="Restoring Talkmato session">
      <div className={styles.restoring}><Brand /><p role="status">Restoring your session…</p></div>
    </section>;
  }
  return <section className={styles.account} aria-label="Talkmato account">
    <header className={styles.topBar}>
      <Brand />
      <div className={styles.connectionActions}>
        <p role="status" className={styles.connection} data-state={auth.status}>
          <span className={styles.dot} aria-hidden="true" />
          {connected ? 'Ready to connect' : auth.status === 'connecting' ? 'Connecting…' : 'Disconnected'}
        </p>
        {auth.status === 'offline' ? <button className={styles.reconnect} onClick={auth.reconnect}>Reconnect</button> : null}
      </div>
    </header>
    <div className={styles.authMain}>
      <div className={styles.formPanel}>
        <h1>{mode === 'register' ? 'Create your account' : 'Log in'}</h1>
        <p className={styles.description}>{mode === 'register'
          ? 'Register with a username and password to start conversations and keep your place in Talkmato.'
          : 'Enter your username and password to continue to Talkmato.'}</p>
        {mode === 'register' ? <RegisterForm disabled={!connected} busy={auth.busy} error={auth.error}
          onSubmit={(name, password) => auth.authenticate('register', name, password)} />
          : <SignInForm disabled={!connected} busy={auth.busy} error={auth.error}
            onSubmit={(name, password) => auth.authenticate('login', name, password)} />}
        <p className={styles.switchMode}>
          {mode === 'register' ? 'Already have an account? ' : 'No account yet? '}
          <button className={styles.link} disabled={auth.busy} onClick={() => {
            auth.clearError();
            setMode(mode === 'register' ? 'login' : 'register');
          }}>{mode === 'register' ? 'Log in' : 'Sign up'}</button>
        </p>
      </div>
      <p className={styles.privacyNote}>Your conversations stay with your account. Sign in again whenever you return.</p>
    </div>
  </section>;
}
