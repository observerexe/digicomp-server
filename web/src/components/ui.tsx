import type { ReactNode } from 'react';
import s from './ui.module.css';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className={s.pageHeader}>
      <h1 className={s.h1}>{title}</h1>
      {children}
    </header>
  );
}

/** Placeholder block shown while data loads (no empty screens). */
export function Skeleton({ height = 96 }: { height?: number }) {
  return <div className={s.skeleton} style={{ height }} aria-hidden="true" />;
}

export function Card({ children }: { children: ReactNode }) {
  return <section className={s.card}>{children}</section>;
}

/** Error text by errorCode, announced to screen readers. */
export function ErrorMessage({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className={s.error}>
      {text}
    </p>
  );
}
