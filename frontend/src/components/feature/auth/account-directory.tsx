import Image from 'next/image';
import type { AccountSnapshot } from '../../../lib/account-types';
import type { ChatUser } from '../../../lib/chat-types';
import { Brand } from '../../ui/brand';
import styles from './auth.module.css';

function Avatar({ user, index = 0 }: { user: ChatUser; index?: number }) {
  return (
    <span className={styles.avatar} data-color={index % 4} aria-hidden="true">
      {Array.from(user.name)[0]?.toUpperCase()}
      {user.online ? <span className={styles.avatarDot} /> : null}
    </span>
  );
}

export function AccountDirectory({
  snapshot,
  busy,
  logout,
}: {
  snapshot: AccountSnapshot;
  busy: boolean;
  logout(): Promise<void>;
}) {
  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="People and conversations">
        <Brand />
        <div className={styles.selfCard}>
          <Avatar user={snapshot.self} />
          <div>
            <strong>{snapshot.self.name} (you)</strong>
            <p>Connected</p>
          </div>
          <span className={styles.dot} aria-hidden="true" />
        </div>
        <section className={styles.sidebarSection}>
          <h2>
            Online users <span>{snapshot.users.length}</span>
          </h2>
          <ul className={styles.directory} aria-label="Online users">
            {snapshot.users.map((user, index) => (
              <li key={user.userId} className={styles.person}>
                <Avatar user={user} index={index} />
                <span>
                  {user.name}
                  {user.userId === snapshot.self.userId ? ' (you)' : ''}
                </span>
                <span className={styles.dot} aria-hidden="true" />
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.sidebarSection}>
          <h2>
            Private chats <span>{snapshot.privateRooms.length}</span>
          </h2>
          {snapshot.privateRooms.length ? (
            <ul className={styles.directory}>
              {snapshot.privateRooms.map((room, index) => {
                const peer = room.members.find((member) => member.userId !== snapshot.self.userId);
                return peer ? (
                  <li key={room.roomId} className={styles.person}>
                    <Avatar user={peer} index={index + 1} />
                    <div>
                      <strong>{peer.name}</strong>
                      <p>{peer.online ? 'Online' : 'Offline'} · Saved conversation</p>
                    </div>
                  </li>
                ) : null;
              })}
            </ul>
          ) : (
            <p className={styles.emptyDirectory}>Your saved conversations will appear here.</p>
          )}
        </section>
        <section className={styles.sidebarSection}>
          <h2>
            Group chats <span>All groups · {snapshot.groups.length}</span>
          </h2>
          {snapshot.groups.length ? (
            <ul className={styles.directory}>
              {snapshot.groups.map((group) => (
                <li key={group.roomId}>
                  <details className={styles.group}>
                    <summary>
                      <span className={styles.groupIcon} aria-hidden="true">
                        #
                      </span>
                      <span>
                        <strong>{group.name}</strong>
                        <small>
                          {group.members.length} members ·{' '}
                          {group.members.some((member) => member.userId === snapshot.self.userId)
                            ? 'Joined'
                            : 'Not joined'}
                        </small>
                      </span>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                        <path d="m6 4 4 4-4 4" />
                      </svg>
                    </summary>
                    <ul aria-label={`${group.name} members`}>
                      {group.members.map((member) => (
                        <li key={member.userId}>
                          {member.name}
                          <span>{member.online ? 'Online' : 'Offline'}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyDirectory}>No groups yet.</p>
          )}
        </section>
        <div className={styles.sidebarFooter}>
          <button className={styles.secondary} onClick={() => void logout()} disabled={busy}>
            Sign out
          </button>
          <p>A little hello goes a long way.</p>
        </div>
      </aside>
      <section className={styles.conversations} aria-label="Your conversations">
        <header>
          <h1>Your conversations</h1>
          <span className={styles.connectedLabel}>
            <span className={styles.dot} aria-hidden="true" />
            You’re connected
          </span>
        </header>
        <div className={styles.welcome}>
          <div className={styles.welcomeLogo}>
            <Image src="/talkmato-logo.svg" width={72} height={72} alt="" />
          </div>
          <h2>Good conversations start small.</h2>
          <p>You’re signed in. Find your people in the sidebar and see what’s growing.</p>
          <p className={styles.welcomeNote}>Small talks, fresh connections.</p>
        </div>
      </section>
    </div>
  );
}
