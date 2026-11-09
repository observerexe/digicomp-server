import { useSyncExternalStore } from 'react';
import s from './ui.module.css';

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <p role="status" className={s.offline}>
      Немає з’єднання. Дані можуть бути застарілими, дії виконаються, коли зв’язок повернеться.
    </p>
  );
}
