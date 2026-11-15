import { Link } from 'react-router';
import type { PaperStatus, RecordPaper, ReferringPaper } from '../api/types';
import s from './RecordPapers.module.css';

const STATE: Partial<Record<PaperStatus, string>> = { draft: ' · чернетка', cancelled: ' · скасовано' };

/**
 * Links to a record's documents: the one it was made with (`label` and its
 * number) and those about it the reader sees (title, number, state).
 */
export function RecordPapers({ label, paper, papers }: { label: string; paper: RecordPaper | null; papers: readonly ReferringPaper[] }) {
  if (!paper && papers.length === 0) return null;
  return (
    <span className={s.papers}>
      {paper && (
        <Link to={`/editor/${paper.id}`}>
          {label}
          {paper.number ? ` ${paper.number}` : ''}
        </Link>
      )}
      {papers.map((p) => (
        <Link key={p.id} to={`/editor/${p.id}`}>
          {p.title}
          {p.number ? ` ${p.number}` : ''}
          {STATE[p.status] ?? ''}
        </Link>
      ))}
    </span>
  );
}
