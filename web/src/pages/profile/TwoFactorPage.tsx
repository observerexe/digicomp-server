import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { Me } from '../../api/types';
import { ME_KEY, useAuth } from '../../auth/AuthProvider';
import { Icon } from '../../components/Icon';
import { QrCode } from '../../components/QrCode';
import { Card, ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import s from './profile.module.css';

const onlyDigits = (v: string) => v.replace(/\s/g, '');
const validCode = (v: string) => /^\d{6}$/.test(onlyDigits(v));

/** Turn on, turn off, new recovery codes (docs/tech/API.md, «2FA»). */
export function TwoFactorPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <Link to="/profile" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Профіль
      </Link>
      <PageHeader title="Вхід із кодом (2FA)" />
      <div className={s.form}>{user.twoFactorEnabled ? <Manage /> : <Enable />}</div>
    </>
  );
}

function Enable() {
  const { logout } = useAuth();
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);

  const setup = useMutation({ mutationFn: () => unwrap(api.POST('/api/auth/2fa/setup')) });
  const enable = useMutation({
    mutationFn: () => unwrap(api.POST('/api/auth/2fa/enable', { body: { code: onlyDigits(code) } })),
  });

  // Turning 2FA on closes every session: the next login asks for a code.
  const finish = () =>
    logout({ notice: 'Вхід із кодом увімкнено. Увійдіть знову: після пароля застосунок попросить код.', next: '/profile' });

  if (enable.data) {
    return (
      <Card>
        <div className={s.form}>
          <p className={s.ok}>Вхід із кодом увімкнено.</p>
          <RecoveryCodes codes={enable.data.recoveryCodes} />
          <label className={s.check}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            Коди збережено в надійному місці
          </label>
          <button type="button" className="btn btn-primary" disabled={!saved} onClick={() => void finish()}>
            Увійти знову
          </button>
        </div>
      </Card>
    );
  }

  if (!setup.data) {
    return (
      <Card>
        <div className={s.form}>
          <p className={s.lead}>
            Після пароля застосунок попросить 6-значний код із телефона. Навіть якщо пароль дізнаються, без телефона в акаунт не
            увійти.
          </p>
          <p className="hint">Підійде будь-який застосунок-автентифікатор: Aegis, Google Authenticator, 1Password, Bitwarden.</p>
          <ErrorMessage text={setup.isError ? errorOf(setup.error) : null} />
          <button type="button" className="btn btn-primary" disabled={setup.isPending} onClick={() => setup.mutate()}>
            {setup.isPending ? 'Готуємо…' : 'Почати налаштування'}
          </button>
        </div>
      </Card>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    enable.mutate();
  };
  return (
    <Card>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <ol className={s.steps}>
          <li>Відкрийте застосунок-автентифікатор і додайте новий акаунт.</li>
          <li>Відскануйте QR-код. Якщо камера недоступна, введіть ключ вручну.</li>
          <li>Введіть 6-значний код, який покаже застосунок.</li>
        </ol>
        <div className={s.qr}>
          <QrCode value={setup.data.otpauthUri} label="QR-код для застосунку-автентифікатора" />
        </div>
        <div>
          <p className="hint">Ключ для ручного введення:</p>
          <p className={s.secret}>{setup.data.secret.match(/.{1,4}/g)?.join(' ')}</p>
        </div>
        <div className="field">
          <label htmlFor="tf-code">Код із застосунку</label>
          <input
            id="tf-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={7}
            aria-invalid={enable.isError ? 'true' : 'false'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <ErrorMessage text={enable.isError ? errorOf(enable.error) : null} />
        <p className="hint">Після увімкнення всі пристрої вийдуть з акаунта, і вхід потребуватиме коду.</p>
        <button type="submit" className="btn btn-primary" disabled={enable.isPending || !validCode(code)}>
          {enable.isPending ? 'Перевіряємо…' : 'Увімкнути'}
        </button>
      </form>
    </Card>
  );
}

function Manage() {
  const qc = useQueryClient();
  const [regenCode, setRegenCode] = useState('');
  const [offCode, setOffCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  const regen = useMutation({
    mutationFn: () => unwrap(api.POST('/api/auth/2fa/recovery-codes', { body: { code: onlyDigits(regenCode) } })),
    onSuccess: () => setRegenCode(''),
  });
  const disable = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/auth/2fa/disable', {
          body: useRecovery ? { recoveryCode: offCode.trim() } : { code: onlyDigits(offCode) },
        }),
      ),
    onSuccess: () => qc.setQueryData<Me | null>(ME_KEY, (old) => (old ? { ...old, twoFactorEnabled: false } : old)),
  });

  return (
    <>
      <Card>
        <p className={s.ok}>Вхід із кодом увімкнено.</p>
      </Card>
      <Card>
        <form
          className={s.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            regen.mutate();
          }}
        >
          <h2 className={s.caption}>Нові запасні коди</h2>
          {regen.data ? (
            <RecoveryCodes codes={regen.data.recoveryCodes} />
          ) : (
            <>
              <p className="hint">Старі запасні коди перестануть працювати. Підтвердьте кодом із застосунку.</p>
              <div className="field">
                <label htmlFor="rc-code">Код із застосунку</label>
                <input
                  id="rc-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={7}
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value)}
                />
              </div>
              <ErrorMessage text={regen.isError ? errorOf(regen.error) : null} />
              <button type="submit" className="btn" disabled={regen.isPending || !validCode(regenCode)}>
                Отримати нові коди
              </button>
            </>
          )}
        </form>
      </Card>
      <Card>
        <form
          className={s.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
        >
          <h2 className={s.caption}>Вимкнути вхід із кодом</h2>
          <p className="hint">Акаунт знову буде захищений лише паролем. Для адміністратора розширена панель стане недоступною.</p>
          <div className="field">
            <label htmlFor="off-code">{useRecovery ? 'Запасний код' : 'Код із застосунку'}</label>
            <input
              id="off-code"
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 20 : 7}
              value={offCode}
              onChange={(e) => setOffCode(e.target.value)}
            />
          </div>
          <ErrorMessage text={disable.isError ? errorOf(disable.error) : null} />
          <div className={s.actions}>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={disable.isPending || (useRecovery ? offCode.trim().length < 6 : !validCode(offCode))}
            >
              Вимкнути
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setUseRecovery((v) => !v);
                setOffCode('');
              }}
            >
              {useRecovery ? 'Ввести код із застосунку' : 'Немає телефона? Запасний код'}
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}

/** Shown once: copy or download, the server keeps only hashes. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = `DigiComp HUB — запасні коди для входу.\nКожен код працює один раз.\n\n${codes.join('\n')}\n`;
  const href = useMemo(() => URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), [text]);
  useEffect(() => () => URL.revokeObjectURL(href), [href]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <p className={s.warn}>
        Збережіть ці коди зараз: більше їх не покажемо. Кожен код дає один вхід, якщо телефона немає під рукою.
      </p>
      <ul className={s.codes} aria-label="Запасні коди">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className={s.actions}>
        <button type="button" className="btn" onClick={() => void copy()}>
          {copied ? 'Скопійовано' : 'Скопіювати'}
        </button>
        <a className="btn" href={href} download="digicomp-recovery-codes.txt">
          Завантажити .txt
        </a>
      </div>
    </>
  );
}
