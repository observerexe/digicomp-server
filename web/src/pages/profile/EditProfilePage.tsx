import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError, unwrap } from '../../api/client';
import type { Me } from '../../api/types';
import { ME_KEY, useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { Card, ErrorMessage, PageHeader } from '../../components/ui';
import { errorOf, errorText } from '../../errors/messages';
import { resizeImage } from '../../lib/resizeImage';
import s from './profile.module.css';

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const BIO_MAX = 2000;

/** Own profile: bio and avatar for everyone; position, specialty, name by role. */
export function EditProfilePage() {
  const { user, can } = useAuth();
  if (!user) return null;
  return (
    <>
      <Link to="/profile" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Профіль
      </Link>
      <PageHeader title="Біо й аватар" />
      <div className={s.form}>
        <AvatarCard user={user} />
        <FieldsCard user={user} canName={can('profile.edit_own_name')} canRoleInfo={can('profile.edit_own_role_info')} />
      </div>
    </>
  );
}

function useSetMe() {
  const qc = useQueryClient();
  return (patch: Partial<Me>) => {
    qc.setQueryData<Me | null>(ME_KEY, (old) => (old ? { ...old, ...patch } : old));
    // Cards in «Команда» show the same data.
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
}

function AvatarCard({ user }: { user: Me }) {
  const setMe = useSetMe();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const small = await resizeImage(file);
      if (!AVATAR_TYPES.includes(small.type)) throw new ApiError(0, 'FILE_TYPE_NOT_ALLOWED');
      if (small.size > AVATAR_MAX_BYTES) throw new ApiError(0, 'FILE_TOO_LARGE');
      const body = new FormData();
      body.append('file', small);
      return unwrap(
        api.POST('/api/users/{id}/avatar', {
          params: { path: { id: user.id } },
          body: body as never,
        }),
      );
    },
    onSuccess: (r) => setMe({ avatarUrl: r.avatarUrl }),
    onError: (e) => setError(errorOf(e)),
    onSettled: () => setPreview(null),
  });

  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/users/{id}/avatar', { params: { path: { id: user.id } } })),
    onSuccess: () => setMe({ avatarUrl: null }),
    onError: (e) => setError(errorOf(e)),
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(errorText('FILE_TYPE_NOT_ALLOWED'));
      return;
    }
    setError(null);
    setPreview(URL.createObjectURL(file));
    upload.mutate(file);
  };

  const busy = upload.isPending || remove.isPending;
  return (
    <Card>
      <div className={s.avatarRow}>
        <Avatar name={user.name} url={preview ?? user.avatarUrl} size={96} />
        <div className={s.avatarButtons}>
          <input ref={input} id="avatar-file" type="file" accept="image/*" className={s.fileInput} onChange={onFile} tabIndex={-1} />
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Завантажуємо…' : user.avatarUrl ? 'Змінити фото' : 'Додати фото'}
          </button>
          {user.avatarUrl && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => remove.mutate()}>
              Прибрати
            </button>
          )}
        </div>
      </div>
      <p className="hint">PNG, JPEG або WebP. Велике фото телефон зменшить сам.</p>
      <ErrorMessage text={error} />
    </Card>
  );
}

function FieldsCard({ user, canName, canRoleInfo }: { user: Me; canName: boolean; canRoleInfo: boolean }) {
  const setMe = useSetMe();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: user.name, position: user.position, specialty: user.specialty, bio: user.bio });

  const save = useMutation({
    mutationFn: () => {
      // Only changed fields the role may edit (the API rejects the rest).
      const body: Partial<typeof form> = {};
      if (form.bio !== user.bio) body.bio = form.bio;
      if (canRoleInfo && form.position.trim() !== user.position) body.position = form.position.trim();
      if (canRoleInfo && form.specialty.trim() !== user.specialty) body.specialty = form.specialty.trim();
      if (canName && form.name.trim() !== user.name) body.name = form.name.trim();
      return unwrap(api.PATCH('/api/users/me', { body }));
    },
    onSuccess: (me) => {
      setMe(me);
      void navigate('/profile');
    },
  });

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Card>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="p-name">Ім’я</label>
          <input id="p-name" value={form.name} maxLength={100} disabled={!canName} onChange={set('name')} />
        </div>
        <div className="field">
          <label htmlFor="p-position">Посада</label>
          <input id="p-position" value={form.position} maxLength={100} disabled={!canRoleInfo} onChange={set('position')} />
        </div>
        <div className="field">
          <label htmlFor="p-specialty">Спеціальність</label>
          <input id="p-specialty" value={form.specialty} maxLength={200} disabled={!canRoleInfo} onChange={set('specialty')} />
        </div>
        {!(canName && canRoleInfo) && (
          <p className="hint">
            {canRoleInfo
              ? 'Ім’я змінює адміністратор.'
              : 'Ім’я, посаду й спеціальність змінює модератор або адміністратор.'}
          </p>
        )}
        <div className="field">
          <label htmlFor="p-bio">Біо</label>
          <textarea id="p-bio" value={form.bio} maxLength={BIO_MAX} onChange={set('bio')} />
          <span className={s.counter}>
            {form.bio.length} / {BIO_MAX}
          </span>
        </div>
        <ErrorMessage text={save.isError ? errorOf(save.error) : null} />
        <div className={s.actions}>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || (canName && !form.name.trim())}>
            {save.isPending ? 'Зберігаємо…' : 'Зберегти'}
          </button>
          <Link to="/profile" className="btn btn-ghost">
            Скасувати
          </Link>
        </div>
      </form>
    </Card>
  );
}
