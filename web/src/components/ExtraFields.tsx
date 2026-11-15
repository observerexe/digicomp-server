import type { FieldDef } from '../api/types';
import { itemTitle, useDictionary } from '../lib/dictionaries';
import { choiceKeys } from '../lib/fields';
import { formatDate } from '../lib/format';
import { DictChip } from './Palette';
import s from './ExtraFields.module.css';

/**
 * Filled extra fields as rows of a description list (<dl>), archived ones too:
 * the record keeps their values.
 */
export function ExtraFacts({ defs, extra }: { defs: FieldDef[]; extra: Record<string, unknown> }) {
  return (
    <>
      {defs
        .filter((d) => extra[d.key] !== undefined && extra[d.key] !== null)
        .map((d) => (
          <div key={d.key}>
            <dt>{d.label}</dt>
            <dd>
              <FactValue def={d} value={extra[d.key]} />
            </dd>
          </div>
        ))}
    </>
  );
}

function FactValue({ def, value }: { def: FieldDef; value: unknown }) {
  const dict = useDictionary(def.dictionary);
  switch (def.type) {
    case 'bool':
      return <>{value ? 'Так' : 'Ні'}</>;
    case 'date':
      return <>{formatDate(new Date(`${String(value)}T12:00:00Z`))}</>;
    case 'enum':
    case 'list<enum>':
      return (
        <span className={s.chips}>
          {choiceKeys(value).map((k) => {
            const item = dict.data?.items.find((i) => i.key === k);
            return <DictChip key={k} title={itemTitle(dict.data, k)} color={item?.color ?? 'gray'} />;
          })}
        </span>
      );
    case 'decimal':
      return <>{String(value).replace('.', ',')}</>;
    default:
      return <>{String(value)}</>;
  }
}
