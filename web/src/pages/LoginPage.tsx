import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { ErrorMessage } from '../components/ui';
import { errorText } from '../errors/messages';
import s from './LoginPage.module.css';

/** Only same-app paths after login (no open redirect). */
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/api') ? next : '/';
}

export function LoginPage() {
  const { user, login, verifyTwoFactor } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      // An expired challenge sends the person back to the password step.
      if (code === 'TWO_FACTOR_CHALLENGE_INVALID') setChallenge(null);
      setError(errorText(code));
    } finally {
      setBusy(false);
    }
  }

  const onPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await login(email.trim(), password);
      if (res) {
        setChallenge(res.challengeToken);
        setPassword('');
      }
    });
  };

  const onCode = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      verifyTwoFactor(challenge!, useRecovery ? { recoveryCode: code.trim() } : { code: code.replace(/\s/g, '') }),
    );
  };

  return (
    <div className={s.page}>
      <main className={s.box}>
        <img src="/icons/icon.svg" alt="" width={56} height={56} />
        <h1 className={s.title}>DigiComp HUB</h1>

        {!challenge ? (
          <form onSubmit={onPassword} className={s.form} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Пароль</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <ErrorMessage text={error} />
            <button type="submit" className="btn btn-primary" disabled={busy || !email || !password}>
              {busy ? 'Входимо…' : 'Увійти'}
            </button>
            <p className="hint">Акаунт створює модератор або адміністратор. Забули пароль — зверніться до адміністратора.</p>
          </form>
        ) : (
          <form onSubmit={onCode} className={s.form} noValidate>
            <p className={s.lead}>
              {useRecovery
                ? 'Введіть один із запасних кодів, які ви зберегли під час налаштування.'
                : 'Введіть 6-значний код із застосунку-автентифікатора.'}
            </p>
            <div className="field">
              <label htmlFor="code">{useRecovery ? 'Запасний код' : 'Код'}</label>
              <input
                id="code"
                autoComplete="one-time-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                maxLength={useRecovery ? 12 : 7}
                autoFocus
                aria-invalid={error ? 'true' : 'false'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <ErrorMessage text={error} />
            <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length < 6}>
              {busy ? 'Перевіряємо…' : 'Підтвердити'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setUseRecovery((v) => !v);
                setCode('');
                setError(null);
              }}
            >
              {useRecovery ? 'Ввести код із застосунку' : 'Немає телефона? Запасний код'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
