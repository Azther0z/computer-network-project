import type { FormEvent } from 'react';
import styles from './chat-workspace.module.css';

type DialogActions = {
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancel: () => void;
};

type CreateGroupDialogProps = DialogActions & {
  name: string;
  onNameChange: (name: string) => void;
};

export function CreateGroupDialog({ name, busy, onNameChange, onSubmit, onCancel }: CreateGroupDialogProps) {
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <form className={styles.modal} onSubmit={(event) => void onSubmit(event)} aria-labelledby="create-group-title">
        <h2 id="create-group-title">Create group</h2>
        <p>You will be the only member initially. Others choose to join themselves.</p>
        <label htmlFor="group-name">Group name</label>
        <input id="group-name" value={name} onChange={(event) => onNameChange(event.target.value)} maxLength={64} autoFocus />
        <div className={styles.modalActions}>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={busy || !name.trim()}>Create group</button>
        </div>
      </form>
    </div>
  );
}

type DeleteAccountDialogProps = DialogActions & {
  password: string;
  error: string | null;
  onPasswordChange: (password: string) => void;
};

export function DeleteAccountDialog({
  password, error, busy, onPasswordChange, onSubmit, onCancel,
}: DeleteAccountDialogProps) {
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <form className={styles.modal} onSubmit={(event) => void onSubmit(event)} aria-labelledby="delete-account-title">
        <h2 id="delete-account-title">Delete account?</h2>
        <p>This cannot be undone. Your old messages will remain, but their sender will display as Unknown.</p>
        <label htmlFor="delete-password">Confirm password</label>
        <input
          id="delete-password"
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        {error && <p className={styles.deleteError} role="alert">{error}</p>}
        <div className={styles.modalActions}>
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className={styles.dangerButton} disabled={busy || !password}>Delete permanently</button>
        </div>
      </form>
    </div>
  );
}
