import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { OrgSettings } from '../../api/types';
import { Icon } from '../../components/Icon';
import { MemberSelect } from '../../components/MemberSelect';
import { Card, ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { ORG_KEY, useOrgSettings } from '../../lib/org';
import s from './org.module.css';

/** /panel/org: requisites for documents — header and default signer (staff). */
export function OrgPage() {
  const q = useOrgSettings();
  return (
    <>
      <Link to="/panel" className="btn btn-ghost">
        <Icon name="back" size={20} />
        Панель керування
      </Link>
      <PageHeader title="Реквізити" />
      <Card>{q.isPending ? <Skeleton height={320} /> : q.isError ? <ErrorMessage text={errorOf(q.error)} /> : <OrgForm org={q.data} />}</Card>
    </>
  );
}

const TEXT = ['institution', 'groupName', 'signerPosition'] as const;

function OrgForm({ org }: { org: OrgSettings }) {
  const qc = useQueryClient();
  const initial = { institution: org.institution, groupName: org.groupName, signerId: org.signer?.id ?? '', signerPosition: org.signerPosition };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      // Only what changed: an untouched blocked signer stays until replaced.
      const body: { institution?: string; groupName?: string; signerPosition?: string; signerId?: string | null } = {};
      for (const k of TEXT) if (form[k].trim() !== org[k]) body[k] = form[k].trim();
      if (form.signerId !== initial.signerId) body.signerId = form.signerId || null;
      return unwrap(api.PATCH('/api/org-settings', { body }));
    },
    onSuccess: (next) => {
      qc.setQueryData(ORG_KEY, next);
      setSaved(true);
    },
  });

  const set = (k: (typeof TEXT)[number]) => (e: ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  const blank = TEXT.some((k) => !form[k].trim());
  return (
    <form className={s.form} onSubmit={onSubmit} noValidate>
      <h2 className={s.caption}>Шапка документів</h2>
      <div className="field">
        <label htmlFor="org-institution">Назва закладу</label>
        <input id="org-institution" value={form.institution} maxLength={200} onChange={set('institution')} />
        <span className="hint">У шапці друкується так, як записано.</span>
      </div>
      <div className="field">
        <label htmlFor="org-group">Назва групи</label>
        <input id="org-group" value={form.groupName} maxLength={200} onChange={set('groupName')} />
      </div>
      <h2 className={s.caption}>Підписант за замовчуванням</h2>
      <MemberSelect
        id="org-signer"
        label="Учасник"
        value={form.signerId}
        onChange={(id) => {
          setSaved(false);
          setForm((f) => ({ ...f, signerId: id }));
        }}
      />
      {org.signer && !org.signer.active && form.signerId === org.signer.id && <p className="hint">Підписанта ({org.signer.name}) заблоковано — виберіть іншого.</p>}
      <div className="field">
        <label htmlFor="org-position">Посада під підписом</label>
        <input id="org-position" value={form.signerPosition} maxLength={200} onChange={set('signerPosition')} />
      </div>
      <ErrorMessage text={save.isError ? errorOf(save.error) : null} />
      <div className={s.actions}>
        <button type="submit" className="btn btn-primary" disabled={save.isPending || blank}>
          {save.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
        {saved && <span className="hint">Збережено.</span>}
      </div>
    </form>
  );
}
