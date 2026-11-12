import { useState, type ReactNode } from 'react';
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

/**
 * A button that asks once more before an action that is hard to undo
 * (block, reset, revoke). Inline, no modal: works the same on a phone.
 */
export function ConfirmButton(props: {
  label: string;
  question: string;
  confirmLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const tone = props.danger ? 'btn-danger' : 'btn-primary';
  if (!asking) {
    return (
      <button type="button" className={`btn ${props.danger ? 'btn-danger' : ''}`} disabled={props.disabled} onClick={() => setAsking(true)}>
        {props.label}
      </button>
    );
  }
  return (
    <span className={s.confirm} role="group" aria-label={props.question}>
      <span>{props.question}</span>
      <button
        type="button"
        className={`btn ${tone}`}
        disabled={props.disabled}
        onClick={() => {
          setAsking(false);
          props.onConfirm();
        }}
      >
        {props.confirmLabel ?? 'Так'}
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
        Ні
      </button>
    </span>
  );
}
