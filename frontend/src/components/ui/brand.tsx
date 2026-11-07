import Image from 'next/image';
import styles from '../feature/auth/auth.module.css';

export function Brand() {
  return <div className={styles.brand}>
    <Image src="/talkmato-logo.svg" width={36} height={36} alt="" priority />
    <div><strong>Talkmato</strong><p>Small talks, fresh connections.</p></div>
  </div>;
}
