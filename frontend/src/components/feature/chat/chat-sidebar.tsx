import type { ChatUser, GroupRoom, PrivateRoom } from '@/lib/chat-types';
import { roomTitle, selfFirst } from '../../../lib/room-display';
import styles from './chat-workspace.module.css';

type ChatSidebarProps = {
  selfId: string;
  users: ChatUser[];
  privateRooms: PrivateRoom[];
  groups: GroupRoom[];
  activeRoomId: string | null;
  busy: boolean;
  accountBusy: boolean;
  onOpenPrivate: (userId: string) => void;
  onSelectRoom: (roomId: string) => void;
  onCreateGroup: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
};

export function ChatSidebar({
  selfId,
  users,
  privateRooms,
  groups,
  activeRoomId,
  busy,
  accountBusy,
  onOpenPrivate,
  onSelectRoom,
  onCreateGroup,
  onDeleteAccount,
  onLogout,
}: ChatSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img src="./talkmato-logo.svg" alt="Talkmato logo" />
        <strong>Talkmato</strong>
        <div className={styles.accountActions}>
          <button
            type="button"
            className={styles.signOut}
            onClick={onLogout}
            disabled={accountBusy}
          >
            Sign out
          </button>
        </div>
      </div>
      <section>
        <h2>Online now</h2>
        <ul className={styles.userList}>
          {selfFirst(users, selfId).map((user) => (
            <li key={user.userId}>
              <button
                type="button"
                className={styles.personButton}
                onClick={() => onOpenPrivate(user.userId)}
                disabled={busy || user.userId === selfId}
              >
                <span className={styles.onlineDot} aria-hidden="true" />
                {user.name}
                {user.userId === selfId && <small>You</small>}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Private chats</h2>
        <ul className={styles.roomList}>
          {privateRooms.length === 0 && <li className={styles.noRooms}>No private chats yet.</li>}
          {privateRooms.map((room) => (
            <li key={room.roomId}>
              <button
                type="button"
                className={activeRoomId === room.roomId ? styles.activeRoom : undefined}
                onClick={() => onSelectRoom(room.roomId)}
              >
                {roomTitle(room, selfId)}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className={styles.sectionHeading}>
          <h2>Groups</h2>
          <button type="button" onClick={onCreateGroup} aria-label="Create group" disabled={busy}>
            +
          </button>
        </div>
        <ul className={styles.roomList}>
          {groups.map((group) => (
            <li key={group.roomId}>
              <button
                type="button"
                className={activeRoomId === group.roomId ? styles.activeRoom : undefined}
                onClick={() => onSelectRoom(group.roomId)}
              >
                <span aria-hidden="true">#</span>
                {group.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className={styles.sidebarFooter}>
        <button
          type="button"
          className={styles.deleteAccount}
          onClick={onDeleteAccount}
          disabled={accountBusy}
        >
          Delete account
        </button>
      </div>
    </aside>
  );
}
