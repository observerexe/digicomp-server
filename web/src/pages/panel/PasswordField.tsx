import { useState } from 'react';
import { generatePassword } from '../../lib/password';
import s from './panel.module.css';

export const MIN_PASSWORD = 8;

/** Password input with «Згенерувати»: shown as text, it is handed to the member once. */
export function PasswordField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={s.passwordRow}>
        <input id={id} type="text" autoComplete="off" spellCheck={false} maxLength={128} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn" onClick={() => onChange(generatePassword())}>
          Згенерувати
        </button>
      </div>
      <span className="hint">Щонайменше {MIN_PASSWORD} символів. Згенерований пароль надійніший.</span>
    </div>
  );
}

/** The password after create/reset: visible once, with copy. */
export function PasswordOnce({ who, password }: { who: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.secret} role="status">
      <span>
        Пароль для {who}. Передайте його особисто: більше він ніде не показується. Учасник може змінити його в профілі.
      </span>
      <span className={s.secretValue}>{password}</span>
      <span className={s.actions}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          {copied ? 'Скопійовано' : 'Копіювати'}
        </button>
      </span>
    </div>
  );
}
