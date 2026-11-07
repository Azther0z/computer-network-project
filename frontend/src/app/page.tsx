import { ChatApp } from '@/components/feature/chat/chat-app';

import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <ChatApp />
      </main>
    </div>
  );
}
