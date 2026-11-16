import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import type { PaperField } from '../../api/types';
import s from './widgets.module.css';

/**
 * The choices come from a dictionary: staff get a link to it in «Довідники».
 * Same tab: leaving the document saves it, and coming back reads it again
 * with the new choices.
 */
export function ManageList({ field, disabled }: { field: PaperField; disabled: boolean }) {
  return !disabled && field.dictionary ? <DictionaryLink dictionary={field.dictionary} /> : null;
}

function DictionaryLink({ dictionary }: { dictionary: string }) {
  const { can } = useAuth();
  if (!can('dictionaries.manage')) return null;
  return (
    <Link className={s.manage} to={`/panel/dictionaries/${dictionary}`}>
      Керувати списком
    </Link>
  );
}
