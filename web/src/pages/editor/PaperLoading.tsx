import { Skeleton } from '../../components/ui';
import s from './editor.module.css';

/** While a document (or the editor's chunk) loads. Outside PaperPage: it is shown before that chunk arrives. */
export function PaperLoading() {
  return (
    <div className={s.alone} aria-busy="true" aria-label="Завантаження">
      <Skeleton height={56} />
      <Skeleton height={480} />
    </div>
  );
}
