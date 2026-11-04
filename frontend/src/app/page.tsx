import { ConnectionStatus } from '@/components/connection-status';
import { ChatWorkspace } from '@/components/chat-workspace';
import { demoWorkspace } from '@/lib/demo-workspace';

import styles from './page.module.css';

export default function Home() {
  const showPreview = process.env.NEXT_PUBLIC_DEMO_CHAT === 'true';

  if (showPreview) {
    return (
      <div className={styles.previewPage}>
        <ChatWorkspace initialSnapshot={demoWorkspace} preview />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Talkmato</p>
          <h1>Small talks, fresh connections.</h1>
          <p>
            The direct browser-to-Socket.IO connection is ready. Account registration and sign-in
            will be added next.
          </p>
        </div>
        <ConnectionStatus />
      </main>
    </div>
  );
}
