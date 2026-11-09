import { useRef, useState, type DragEvent } from 'react';
import { formatSize } from '../lib/format';
import s from './DropZone.module.css';

/**
 * File picker that also takes a file dropped from the desktop. On a phone it
 * is just the «Вибрати файл» button.
 */
export function DropZone(props: { id: string; label: string; file: File | null; onFile: (f: File | null) => void; accept?: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) props.onFile(f);
  };
  return (
    <div
      className={`${s.zone} ${over ? s.over : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid="dropzone"
    >
      <input
        ref={input}
        id={props.id}
        type="file"
        accept={props.accept}
        className={s.input}
        onChange={(e) => {
          props.onFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      {props.file ? (
        <p className={s.file}>
          {props.file.name} <span className={s.size}>{formatSize(props.file.size)}</span>
        </p>
      ) : (
        <p className={s.text}>
          <span className={s.desk}>Перетягніть файл сюди або </span>
        </p>
      )}
      <label htmlFor={props.id} className="btn">
        {props.file ? 'Інший файл' : props.label}
      </label>
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  );
}
