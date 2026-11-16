import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../../api/client';
import type { ArchiveItem, Dictionary } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { Chips, SearchField } from '../../components/Filters';
import { Icon } from '../../components/Icon';
import { ErrorMessage, PageHeader, Skeleton } from '../../components/ui';
import { errorOf } from '../../errors/messages';
import { CATEGORY, itemTitle, useDictionary, usedItems } from '../../lib/dictionaries';
import { formatDate, formatSize } from '../../lib/format';
import { PAPER_STATUS_LABEL } from '../../lib/labels';
import { useDebounced } from '../../lib/useDebounced';
import s from './docs.module.css';

/** File type for the list: «PDF», «DOCX». */
export const fileKind = (name: string | null) => name?.split('.').pop()?.toUpperCase() ?? '';

type Kind = 'file' | 'paper';
type State = 'frozen' | 'signed' | 'cancelled';

const KINDS = [
  { value: 'file', label: 'Файли' },
  { value: 'paper', label: 'Документи' },
];
const STATES = (['frozen', 'signed', 'cancelled'] as const).map((v) => ({ value: v, label: PAPER_STATUS_LABEL[v] }));

/**
 * Archive: one search over the uploaded files and the frozen editor
 * documents. Every filter is the server's; a state is only of documents,
 * a category — only of files, so each hides when the other kind is chosen.
 */
export function DocsPage() {
  const { can } = useAuth();
  const staff = can('documents.manage');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const q = useDebounced(search.trim(), 300);
  const query = {
    limit: '100',
    ...(q ? { search: q } : {}),
    ...(kind ? { kind } : {}),
    ...(state ? { status: state } : {}),
    ...(year ? { year } : {}),
    ...(category ? { category } : {}),
    ...(archived ? { archived: 'true' as const } : {}),
  };
  const list = useQuery({
    queryKey: ['archive', query],
    queryFn: () => unwrap(api.GET('/api/archive', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const dict = useDictionary(CATEGORY.document).data;
  const items = list.data?.items ?? [];
  const years = (list.data?.years ?? []).map((y) => ({ value: String(y), label: String(y) }));
  const categories = usedItems(dict, list.data?.categories ?? []);
  const filtered = !!(q || kind || state || year || category);

  const pickKind = (v: string | null) => {
    setKind(v as Kind | null);
    if (v === 'file') setState(null);
    if (v === 'paper') setCategory(null);
  };
  const pickArchived = (v: boolean) => {
    setArchived(v);
    setKind(null);
    setState(null);
    setYear(null);
  };

  return (
    <>
      <PageHeader title="Архів">
        {staff && (
          <Link to="/docs/new" className="btn btn-primary">
            Новий документ
          </Link>
        )}
      </PageHeader>
      <div className={s.tools}>
        <SearchField value={search} onChange={setSearch} placeholder="Назва, номер чи опис" />
        {!archived && <Chips label="Вид" options={KINDS} value={kind} onChange={pickKind} />}
        {!archived && kind !== 'file' && <Chips label="Стан" options={STATES} value={state} onChange={(v) => setState(v as State | null)} />}
        <Chips label="Рік" options={years} value={year} onChange={setYear} />
        {kind !== 'paper' && <Chips label="Категорія" options={categories} value={category} onChange={setCategory} />}
        {staff && (
          <label className={s.check}>
            <input type="checkbox" checked={archived} onChange={(e) => pickArchived(e.target.checked)} />
            Показати архівні файли
          </label>
        )}
      </div>
      {list.isPending ? (
        <Skeleton height={240} />
      ) : list.isError ? (
        <ErrorMessage text={errorOf(list.error)} />
      ) : items.length === 0 ? (
        <p className="hint">{filtered ? 'Нічого не знайдено.' : 'В Архіві ще нічого немає.'}</p>
      ) : (
        <ul className={s.list} aria-label="Архів">
          {items.map((it) => (
            <li key={`${it.kind}:${it.id}`}>{it.file ? <FileRow item={it} file={it.file} dict={dict} /> : it.paper && <PaperRow item={it} paper={it.paper} />}</li>
          ))}
        </ul>
      )}
      {list.data && list.data.total > items.length && (
        <p className="hint">
          Показано {items.length} з {list.data.total}. Уточніть пошук, щоб знайти інші.
        </p>
      )}
    </>
  );
}

function FileRow({ item, file, dict }: { item: ArchiveItem; file: NonNullable<ArchiveItem['file']>; dict: Dictionary | undefined }) {
  return (
    <Link to={`/docs/${item.id}`} className={s.row}>
      <span className={s.kind}>
        <Icon name="file" size={20} />
        {fileKind(file.fileName)}
      </span>
      <span className={s.main}>
        <span className={s.title}>
          {item.title}
          {file.accessScope === 'supervisors' && <span className={s.tag}>лише модератори</span>}
          {file.archived && <span className={s.tag}>в архіві</span>}
        </span>
        <span className={s.sub}>
          {[
            itemTitle(dict, file.category),
            file.version !== null && `версія ${file.version}`,
            file.size !== null && formatSize(file.size),
            `оновлено ${formatDate(item.updatedAt)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </Link>
  );
}

function PaperRow({ item, paper }: { item: ArchiveItem; paper: NonNullable<ArchiveItem['paper']> }) {
  return (
    <Link to={`/editor/${item.id}`} className={s.row}>
      <span className={s.kind}>
        <Icon name="pen" size={20} />
      </span>
      <span className={s.main}>
        <span className={s.title}>
          {[paper.number, item.title].filter(Boolean).join(' ')}
          <span className={s.tag}>{PAPER_STATUS_LABEL[paper.status]}</span>
        </span>
        <span className={s.sub}>{[paper.template ?? 'Документ без шаблону', paper.author.name ?? 'Видалений учасник', `оновлено ${formatDate(item.updatedAt)}`].join(' · ')}</span>
      </span>
    </Link>
  );
}
