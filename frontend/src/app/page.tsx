import { ConnectionStatus } from '@/components/connection-status';

import styles from './page.module.css';

export default function Home() {
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
