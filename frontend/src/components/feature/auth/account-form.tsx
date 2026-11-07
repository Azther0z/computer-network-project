'use client';

import { useState, type FormEvent } from 'react';
import type { AuthMode } from '../../../lib/account-types';
import styles from './auth.module.css';

type Props = {
  disabled: boolean;
  busy: boolean;
  error: string | null;
  onSubmit(name: string, password: string): Promise<void>;
};

function AccountForm({ mode, disabled, busy, error, onSubmit }: Props & { mode: AuthMode }) {
  const [validation, setValidation] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const registering = mode === 'register';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '')
      .trim()
      .normalize('NFC');
    const password = String(data.get('password') ?? '');
    setValidation(null);
    if ([...name].length < 1 || [...name].length > 32 || /\p{Cc}/u.test(name)) {
      setValidation('Use a name of 1–32 characters without control characters.');
      return;
    }
    if ([...password].length < 8 || [...password].length > 128) {
      setValidation('Use a password of 8–128 characters.');
      return;
    }
    if (registering && password !== data.get('confirmation')) {
      setValidation('Passwords do not match. Enter the same password twice.');
      return;
    }
    void onSubmit(name, password);
    setShowPassword(false);
    // Passwords live only in the form and this one request; clear inputs after submission.
    for (const field of ['password', 'confirmation']) {
      const input = form.elements.namedItem(field);
      if (input instanceof HTMLInputElement) {
        input.value = '';
      }
    }
  }
  return (
    <form
      className={`${styles.form} ${registering ? styles.registerForm : ''}`}
      onSubmit={submit}
      aria-label={registering ? 'Register' : 'Sign in'}
    >
      <fieldset disabled={disabled || busy}>
        <label htmlFor={`${mode}-name`}>Username</label>
        <input
          id={`${mode}-name`}
          name="name"
          autoComplete="username"
          required
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={!!error || undefined}
          aria-describedby={error || validation ? `${mode}-error` : undefined}
        />
        <label htmlFor={`${mode}-password`}>Password</label>
        <div className={styles.passwordField}>
          <input
            id={`${mode}-password`}
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete={registering ? 'new-password' : 'current-password'}
            aria-invalid={!!error || undefined}
            aria-describedby={registering ? `${mode}-password-help` : undefined}
          />
          <button
            type="button"
            className={styles.passwordToggle}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {!showPassword ? <path d="m3 3 18 18" /> : null}
            </svg>
          </button>
        </div>
        {registering ? (
          <p id={`${mode}-password-help`} className={styles.help}>
            Use 8–128 characters.
          </p>
        ) : null}
        {registering ? (
          <>
            <label htmlFor="register-confirmation">Confirm password</label>
            <input
              id="register-confirmation"
              name="confirmation"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
            />
          </>
        ) : null}
        {validation || error ? (
          <p id={`${mode}-error`} className={styles.error} role="alert">
            {validation ?? error}
          </p>
        ) : null}
        <button className={styles.primary} type="submit">
          {busy ? 'Please wait…' : registering ? 'Create Account' : 'Log in'}
        </button>
      </fieldset>
    </form>
  );
}

export function RegisterForm(props: Props) {
  return <AccountForm {...props} mode="register" />;
}
export function SignInForm(props: Props) {
  return <AccountForm {...props} mode="login" />;
}
