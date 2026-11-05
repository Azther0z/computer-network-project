import { AuthGate } from '@/components/auth/auth-gate';
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
      <main className={styles.main}><AuthGate /></main>
    </div>
  );
}
