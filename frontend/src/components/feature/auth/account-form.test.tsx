// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { RegisterForm, SignInForm } from './account-form';

afterEach(cleanup);
const base = { disabled: false, busy: false, error: null };

test('password visibility control reveals the password only on explicit request', () => {
  render(<SignInForm {...base} onSubmit={vi.fn()} />);
  const password = screen.getByLabelText('Password', { exact: true });
  expect(password.getAttribute('type')).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password.getAttribute('type')).toBe('text');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password.getAttribute('type')).toBe('password');
});

test('registration requires matching passwords and clears password fields after submission', () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<RegisterForm {...base} onSubmit={submit} />);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' Alice ' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'test-password' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different-password' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Register' }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Passwords do not match');
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'test-password' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Register' }));
  expect(submit).toHaveBeenCalledWith('Alice', 'test-password');
  expect((screen.getByLabelText('Password', { exact: true }) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Confirm password') as HTMLInputElement).value).toBe('');
});
