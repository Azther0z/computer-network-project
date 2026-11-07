import { useEffect, useRef, useState } from 'react';
import type { ChatUser } from '@/lib/chat-types';
import { selfFirst } from '../../../lib/room-display';
import styles from './chat-workspace.module.css';

export function GroupMemberDetails({ members, selfId }: { members: ChatUser[]; selfId: string }) {
  const [shown, setShown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShown(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [shown]);

  return (
    <div ref={containerRef} className={styles.memberDetails}>
      <button
        type="button"
        className={styles.memberButton}
        aria-expanded={shown}
        onClick={() => setShown((current) => !current)}
      >
        {members.length} {members.length === 1 ? 'member' : 'members'}
      </button>
      {shown && (
        <div className={styles.memberPopover} role="dialog" aria-label="Group members">
          <strong>Members</strong>
          <ul>
            {selfFirst(members, selfId).map((member) => (
              <li key={member.userId}>
                <span>{member.name}</span>
                <small>{member.userId === selfId ? 'You' : member.online ? 'Online' : 'Offline'}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
