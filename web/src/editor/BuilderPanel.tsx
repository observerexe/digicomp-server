import { useEffect, useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { RecordSchema, TemplateKind } from '../api/types';
import { Icon } from '../components/Icon';
import { useDictionaries } from '../lib/dictionaries';
import { fieldBlockOf, textBlockOf, type Block, type Palette } from './blocks';
import { FOOTER_MAX, SIGN_LABEL_MAX, SIGNER_AUTHOR, SIGNER_ORG } from '../../../shared/editor-schema';
import { FIELD_LIMITS } from '../../../shared/editor-schema/fields';
import { BLOCK_MIME, type BuilderSelection } from './builder';
import s from './BuilderPanel.module.css';
import { isAutoBinding } from './blocks/schema';
import { bindingOptions, hasLength, isChoice, isList, isNumeric, keyProblem, LABEL_MAX, limitsText, recordRowsOf, reportRecordOf, withType, type FieldDef, type FieldType } from './template';

export type BuilderTab = 'blocks' | 'props' | 'template';

type Props = {
  tab: BuilderTab;
  /** The tabs shown: a published version — «Шаблон» only. */
  tabs: readonly BuilderTab[];
  onTab: (tab: BuilderTab) => void;
  palette: Palette;
  /** Fields of the record already bound on the sheet: their blocks are not offered again. */
  used: ReadonlySet<string>;
  /** «Шаблон»: settings of the template and its versions. */
  settings: ReactNode;
  selected: BuilderSelection;
  /** Every field with settings, those not on the sheet too (the key of a field picked in a block). */
  defs: ReadonlyMap<string, FieldDef>;
  /** Fields on the sheet. */
  fields: readonly FieldDef[];
  /** Columns of «Повторювані рядки»: the key of their rows field by the column's key. */
  columns: ReadonlyMap<string, string>;
  kind: TemplateKind;
  schema: RecordSchema | null | undefined;
  onPick: (block: string) => void;
  onChange: (f: FieldDef) => void;
  onRename: (from: string, to: string) => void;
  onRemoveField: (key: string) => void;
  onRemoveBlock: (index: number) => void;
  /** Settings of a block of the top level (signatures, the footer). */
  onBlockAttrs: (index: number, attrs: Record<string, unknown>) => void;
  onSelectField: (key: string) => void;
};

const TAB_LABEL: Record<BuilderTab, string> = { blocks: 'Блоки', props: 'Властивості', template: 'Шаблон' };

/** The constructor's panel: «Блоки» (the palette), «Властивості» (of what is selected), «Шаблон». */
export function BuilderPanel(props: Props) {
  const id = useId();
  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = props.tabs.indexOf(props.tab);
    const next = props.tabs[(i + (e.key === 'ArrowRight' ? 1 : props.tabs.length - 1)) % props.tabs.length]!;
    props.onTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <aside className={s.panel} aria-label="Конструктор">
      <div role="tablist" aria-label="Панель конструктора" className={s.tabs} onKeyDown={tabKeys}>
        {props.tabs.map((t) => (
          <button
            key={t}
            id={`${id}-${t}`}
            type="button"
            role="tab"
            aria-selected={props.tab === t}
            aria-controls={`${id}-panel`}
            tabIndex={props.tab === t ? 0 : -1}
            className={s.tab}
            onClick={() => props.onTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${props.tab}`} className={s.body}>
        {props.tab === 'blocks' ? (
          <PaletteTab palette={props.palette} used={props.used} onPick={props.onPick} />
        ) : props.tab === 'props' ? (
          <Properties {...props} />
        ) : (
          props.settings
        )}
      </div>
    </aside>
  );
}

/** A click on the palette must not take the cursor away from the sheet. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/** A block of the record's field already bound on the sheet. */
export const isUsed = (b: Block, used: ReadonlySet<string>) => b.kind === 'field' && b.binding !== undefined && used.has(b.binding);

function PaletteTab({ palette, used, onPick }: { palette: Palette; used: ReadonlySet<string>; onPick: (block: string) => void }) {
  const drag = (b: Block) => (e: DragEvent) => {
    e.dataTransfer.setData(BLOCK_MIME, b.key);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <>
      <p className="hint">Натисніть блок, щоб вставити його біля курсора, або перетягніть на аркуш. На аркуші — «/».</p>
      {palette.groups.map((g) => (
        <section key={g.key} className={s.group} aria-label={g.label}>
          <h3 className={s[`h-${g.key}`]}>{g.label}</h3>
          {g.key === 'schema' && <p className="hint">Поле вставляється вже прив’язаним до запису.</p>}
          <div className={s.blocks}>
            {palette.blocks
              .filter((b) => b.group === g.key)
              .map((b) => {
                const taken = isUsed(b, used);
                return (
                  <button
                    key={b.key}
                    type="button"
                    className={s.block}
                    draggable={!taken}
                    disabled={taken}
                    title={taken ? 'Уже на аркуші' : undefined}
                    onDragStart={drag(b)}
                    onMouseDown={keepFocus}
                    onClick={() => onPick(b.key)}
                  >
                    <span className={`${s.blockIcon} ${s[`i-${g.key}`]}`}>
                      <Icon name={b.icon} size={18} />
                    </span>
                    {b.label}
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}

function Properties(props: Props) {
  const { selected, defs } = props;
  if (!selected) return <p className="hint">Виберіть блок на аркуші.</p>;
  if (selected.kind === 'block') {
    const block = textBlockOf(selected.node);
    const setAttrs = (attrs: Record<string, unknown>) => props.onBlockAttrs(selected.index, attrs);
    return (
      <>
        <Heading
          block={block}
          label={selected.node === 'conditional' ? 'Умовний блок' : (block?.label ?? selected.node)}
          hint={selected.node === 'conditional' ? conditionHint(selected.attrs, props) : (BLOCK_HINT[selected.node] ?? 'Текст шаблону: у документі він не змінюється.')}
        />
        {selected.node === 'signatures' && <SignaturesForm attrs={selected.attrs} fields={props.fields} onChange={setAttrs} />}
        {selected.node === 'pageFooter' && (
          <div className="field">
            <label htmlFor="block-footer">Текст колонтитула</label>
            <input id="block-footer" maxLength={FOOTER_MAX} value={selected.attrs.text as string} onChange={(e) => setAttrs({ text: e.target.value })} />
            <span className="hint">Друкується внизу кожної сторінки. Номери сторінок — угорі, з другої.</span>
          </div>
        )}
        {selected.keys.length > 0 && (
          <div className={s.prop}>
            <span className={s.propLabel}>Поля в блоці</span>
            <div className={s.chips}>
              {selected.keys.map((k) => (
                <button key={k} type="button" className={s.chip} onClick={() => props.onSelectField(k)}>
                  {defs.get(k)?.label ?? k}
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="button" className={`btn btn-danger ${s.remove}`} onClick={() => props.onRemoveBlock(selected.index)}>
          <Icon name="trash" size={18} />
          Видалити блок
        </button>
      </>
    );
  }
  const f = defs.get(selected.key);
  if (!f) return <p className="hint">Поле «{selected.key}» без налаштувань: видаліть його з аркуша.</p>;
  // A new form for each field: what is typed in it belongs to that field.
  return <FieldForm key={f.key} f={f} {...props} />;
}

/** A conditional block: when it is in the document. Its condition comes with the template; the constructor does not set it. */
function conditionHint(attrs: Record<string, unknown>, { defs, schema }: Props): string {
  const f = defs.get(attrs.field as string);
  const value = attrs.value as string;
  const choice = schema?.fields.find((x) => x.key === f?.binding)?.options?.find((o) => o.key === value)?.label ?? value;
  return `Є в документі, лише коли в полі «${f?.label ?? String(attrs.field)}» обрано «${choice}». Умову тут не змінюють.`;
}

/** What a structure block shows, under its name. */
const BLOCK_HINT: Record<string, string> = {
  orgHeader: 'Назва закладу й групи з «Реквізитів» на панелі керування.',
  approval: 'Посада й ім’я підписанта з «Реквізитів» на панелі керування.',
  signatures: 'Одна або дві колонки: підпис, лінія й ім’я того, хто підписує.',
  pageFooter: 'Рядок унизу кожної сторінки друку.',
};

const SIDES = [
  { side: 'left', label: 'Ліва колонка' },
  { side: 'right', label: 'Права колонка' },
] as const;

/** Signatures: each column — a label and who signs (the author, the signer, a member of a field, or a bare line). */
function SignaturesForm({ attrs, fields, onChange }: { attrs: Record<string, unknown>; fields: readonly FieldDef[]; onChange: (attrs: Record<string, unknown>) => void }) {
  const id = useId();
  const people = fields.filter((f) => f.type === 'ref:user');
  return (
    <>
      {SIDES.map(({ side, label }) => {
        const signer = attrs[`${side}Signer`] as string | null;
        const own = attrs[`${side}Label`] as string;
        return (
          <fieldset key={side} className={s.prop}>
            <legend className={s.propLabel}>{label}</legend>
            <div className="field">
              <label htmlFor={`${id}-${side}-label`}>Підпис</label>
              <input id={`${id}-${side}-label`} maxLength={SIGN_LABEL_MAX} value={own} onChange={(e) => onChange({ [`${side}Label`]: e.target.value })} />
              {side === 'right' && !own && <span className="hint">Без підпису права колонка не друкується.</span>}
            </div>
            <div className="field">
              <label htmlFor={`${id}-${side}-signer`}>Хто підписує</label>
              <select id={`${id}-${side}-signer`} value={signer ?? ''} onChange={(e) => onChange({ [`${side}Signer`]: e.target.value || null })}>
                <option value={SIGNER_AUTHOR}>Автор документа</option>
                <option value={SIGNER_ORG}>Підписант з «Реквізитів»</option>
                {people.map((f) => (
                  <option key={f.key} value={f.key}>
                    Поле «{f.label}»
                  </option>
                ))}
                {signer !== null && signer !== SIGNER_AUTHOR && signer !== SIGNER_ORG && !people.some((f) => f.key === signer) && <option value={signer}>{signer}</option>}
                <option value="">Нікого: лише лінія</option>
              </select>
            </div>
          </fieldset>
        );
      })}
      {people.length === 0 && <p className="hint">Щоб підписував учасник, вибраний у документі, додайте на аркуш поле «Учасник».</p>}
    </>
  );
}

function Heading({ block, label, hint }: { block: Block | null; label: string; hint: string }) {
  return (
    <div className={s.heading}>
      <span className={`${s.headingIcon} ${s[`i-${block?.group ?? 'text'}`]}`}>
        <Icon name={block?.icon ?? 'paragraph'} size={22} />
      </span>
      <span>
        <strong>{label}</strong>
        <span className="hint">{hint}</span>
      </span>
    </div>
  );
}

function FieldForm({ f, fields, columns, defs, kind, schema, onChange, onRename, onRemoveField }: Props & { f: FieldDef }) {
  const id = useId();
  const block = fieldBlockOf(f.type);
  // «Повторювані рядки» are never bound; a column is filled, changed and printed as its rows.
  const rows = f.type === 'rows';
  const columnOf = columns.get(f.key);
  const ownRows = columnOf === undefined ? undefined : defs.get(columnOf);
  // «Рядок = запис»: the block whose columns are bound — each row makes a record.
  const recordRows = recordRowsOf(fields, columns);
  const [keyText, setKeyText] = useState(f.key);
  const [label, setLabel] = useState(f.label);
  const taken = new Set(fields.map((x) => x.key));
  const keyError = keyProblem(keyText, f.key, taken);
  const applyKey = () => {
    if (!keyError && keyText !== f.key) onRename(f.key, keyText);
  };
  const bindings = bindingOptions(f, kind, schema, fields, columns);
  const bound = f.binding ? schema?.fields.find((x) => x.key === f.binding) : undefined;
  // Shows what the record gets later: nobody fills or changes it.
  const auto = isAutoBinding(kind, bound);
  const set = (patch: Partial<FieldDef>) => onChange({ ...f, ...patch });
  const bind = (key: string) => {
    const target = bindings.find((x) => x.key === key);
    if (!target) return set({ binding: null });
    set({
      binding: key,
      // A bound choice takes its values from the record's field.
      dictionary: null,
      // A template that creates a record fills what the record needs; an auto field — nobody.
      required: !isAutoBinding(kind, target) && (f.required || (kind === 'creates' && !!target.required)),
      editable: !isAutoBinding(kind, target) && f.editable,
      label: f.label === block?.label ? target.label : f.label,
    });
    if (f.label === block?.label) setLabel(target.label);
    // A row makes a record: at least one row, never changed after publication.
    if (ownRows && (!ownRows.required || ownRows.editable)) onChange({ ...ownRows, required: true, editable: false });
  };
  const rowsOwnRecords = rows && recordRows === f.key;
  // A report's record: required, never changed after publication.
  const reportRecord = kind === 'report' && !!schema && reportRecordOf(fields, schema.type, columns) === f.key;
  const recordRuleBroken = reportRecord && (!f.required || f.editable);
  useEffect(() => {
    if (recordRuleBroken) onChange({ ...f, required: true, editable: false });
  }, [recordRuleBroken]);

  return (
    <>
      <Heading block={block} label={block?.label ?? f.type} hint={block?.hint ?? 'Поле, яке заповнює людина'} />
      <div className="field">
        <label htmlFor={`${id}-key`}>Ключ</label>
        <input
          id={`${id}-key`}
          className={s.mono}
          value={keyText}
          maxLength={40}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!keyError}
          aria-describedby={`${id}-key-hint`}
          onChange={(e) => setKeyText(e.target.value)}
          onBlur={applyKey}
          onKeyDown={(e) => e.key === 'Enter' && applyKey()}
        />
        <span id={`${id}-key-hint`} className={keyError ? s.error : 'hint'}>
          {keyError ?? 'Латиницею. За ключем значення з’являється в тексті й у звіті.'}
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-label`}>Підпис у формі</label>
        <input
          id={`${id}-label`}
          value={label}
          maxLength={LABEL_MAX}
          aria-invalid={!label.trim()}
          onChange={(e) => {
            setLabel(e.target.value);
            if (e.target.value.trim()) set({ label: e.target.value });
          }}
          onBlur={() => !label.trim() && setLabel(f.label)}
        />
      </div>
      {block?.variants && (
        <div className={s.prop} role="group" aria-label="Вид поля">
          <span className={s.propLabel}>Вид</span>
          <div className={s.segmented}>
            {block.variants.map((v) => (
              <button key={v.type} type="button" aria-pressed={f.type === v.type} onClick={() => f.type !== v.type && onChange(withType(f, v.type as FieldType))}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {ownRows && <p className="hint">Стовпець блоку «{ownRows.label}»: хто заповнює, зміна після публікації й друк — як у блоку.</p>}
      {rowsOwnRecords && schema && (
        <p className="hint">Рядок = запис «{schema.label}»: кожен заповнений рядок створить запис. Хоча б один рядок обов’язковий; після публікації рядки не змінюються.</p>
      )}
      {reportRecord && <p className="hint">Про цей запис звіт: людина вибирає його, решта полів підставиться з нього. Обов’язкове; після публікації не змінюється.</p>}
      {kind !== 'free' && schema && !rows && !reportRecord && (!ownRows || kind === 'creates') && (
        <div className="field">
          <label htmlFor={`${id}-binding`}>Зв’язок із записом</label>
          <select id={`${id}-binding`} value={f.binding ?? ''} onChange={(e) => bind(e.target.value)}>
            <option value="">Без зв’язку</option>
            {f.binding && !bindings.some((b) => b.key === f.binding) && <option value={f.binding}>{bound?.label ?? f.binding} (недоступне)</option>}
            {bindings.map((b) => (
              <option key={b.key} value={b.key}>
                {schema.label} → {b.label}
              </option>
            ))}
          </select>
          <span className="hint">
            {auto
              ? kind === 'report'
                ? `Підставиться з поля «${bound!.label}» запису, про який звіт; ніхто не заповнює.`
                : `Заповниться із запису «${bound!.label}» після публікації; ніхто не заповнює.`
              : bound
                ? [
                    `Значення піде в поле запису «${bound.label}».`,
                    limitsText({ min: bound.min ?? null, max: bound.max ?? null, maxLength: bound.maxLength ?? null, maxItems: bound.maxItems ?? null }),
                  ]
                    .filter(Boolean)
                    .join(' Межі запису: ')
                : bindings.length
                  ? ownRows
                    ? 'Прив’язаний стовпець робить кожен рядок окремим записом.'
                    : 'Прив’язане поле пише значення в сам запис.'
                  : ownRows && fields.some((o) => o.binding && columns.get(o.key) !== columnOf)
                    ? 'Стовпець прив’язується, коли поза цим блоком нічого не прив’язано.'
                    : !ownRows && recordRows
                      ? `Записи створюють рядки блоку «${defs.get(recordRows)?.label ?? recordRows}»: поза ним поля не прив’язуються.`
                      : 'У записі немає полів, до яких можна прив’язати це поле.'}
          </span>
        </div>
      )}
      {!auto && (
        <>
          {/* Another kind of the field — its limits anew (an integer's bounds are rounded). */}
          <Limits key={f.type} id={id} f={f} onChange={onChange} />
          {isChoice(f.type) && !f.binding && <DictionaryChoice id={`${id}-dict`} value={f.dictionary} onChange={(dictionary) => set({ dictionary })} />}
          {!ownRows && (
            <div className="field">
              <label htmlFor={`${id}-fill`}>Хто заповнює</label>
              <select id={`${id}-fill`} value={f.fill} onChange={(e) => set({ fill: e.target.value as FieldDef['fill'] })}>
                <option value="author">Автор документа</option>
                <option value="staff">Модератор</option>
              </select>
            </div>
          )}
          {!rowsOwnRecords && !reportRecord && (
            <Switch label={rows ? 'Хоча б один рядок' : ownRows ? 'Обов’язкове в кожному рядку' : 'Обов’язкове'} on={f.required} onChange={(required) => set({ required })} />
          )}
          {!ownRows && !rowsOwnRecords && !reportRecord && <Switch label="Можна змінити після публікації" on={f.editable} onChange={(editable) => set({ editable })} />}
        </>
      )}
      {!ownRows && <Switch label="Показувати в друці" on={f.print} onChange={(print) => set({ print })} />}
      <button type="button" className={`btn btn-danger ${s.remove}`} onClick={() => onRemoveField(f.key)}>
        <Icon name="trash" size={18} />
        {rows ? 'Видалити блок' : 'Видалити поле'}
      </button>
    </>
  );
}

/** Limits that suit the type: numbers — from/to, text — length, a list — how many. */
function Limits({ id, f, onChange }: { id: string; f: FieldDef; onChange: (f: FieldDef) => void }) {
  const integer = f.type === 'int';
  return (
    <>
      {isNumeric(f.type) && (
        <div className={s.pair}>
          <NumberBox id={`${id}-min`} label="Від" value={f.min} integer={integer} onChange={(min) => onChange({ ...f, min })} />
          <NumberBox id={`${id}-max`} label="До" value={f.max} integer={integer} onChange={(max) => onChange({ ...f, max })} />
        </div>
      )}
      {f.min !== null && f.max !== null && f.min > f.max && <p className={s.error}>«Від» більше за «До».</p>}
      {hasLength(f.type) && (
        <NumberBox id={`${id}-len`} label="Найбільша довжина, знаків" value={f.maxLength} integer positive onChange={(maxLength) => onChange({ ...f, maxLength })} />
      )}
      {isList(f.type) && <NumberBox id={`${id}-items`} label="Найбільше, шт." value={f.maxItems} integer positive onChange={(maxItems) => onChange({ ...f, maxItems })} />}
      {f.type === 'rows' && (
        <NumberBox
          id={`${id}-rows`}
          label="Найбільше рядків"
          value={f.maxItems}
          integer
          positive
          placeholder={`до ${FIELD_LIMITS.rowsDefault}`}
          onChange={(maxItems) => onChange({ ...f, maxItems })}
        />
      )}
    </>
  );
}

/** A number or nothing (no limit); an invalid one is shown, not applied. */
function NumberBox(props: { id: string; label: string; value: number | null; integer: boolean; positive?: boolean; placeholder?: string; onChange: (v: number | null) => void }) {
  const [raw, setRaw] = useState(props.value === null ? '' : String(props.value).replace('.', ','));
  const parse = (v: string): number | null | undefined => {
    const t = v.trim().replace(',', '.');
    if (t === '') return null;
    if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return undefined;
    const n = Number(t);
    if (props.integer && !Number.isInteger(n)) return undefined;
    if (props.positive && n < 1) return undefined;
    return Math.abs(n) <= 1e9 ? n : undefined;
  };
  const bad = parse(raw) === undefined;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="text"
        inputMode={props.integer ? 'numeric' : 'decimal'}
        value={raw}
        placeholder={props.placeholder ?? 'без меж'}
        aria-invalid={bad}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = parse(e.target.value);
          if (n !== undefined) props.onChange(n);
        }}
      />
      {bad && <span className={s.error}>{props.integer ? (props.positive ? 'Ціле число від 1' : 'Ціле число') : 'Число, до 2 знаків після коми'}</span>}
    </div>
  );
}

function DictionaryChoice({ id, value, onChange }: { id: string; value: string | null; onChange: (v: string | null) => void }) {
  const dicts = useDictionaries();
  return (
    <div className="field">
      <label htmlFor={id}>Довідник</label>
      <select id={id} value={value ?? ''} aria-invalid={!value} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Виберіть довідник</option>
        {value && !dicts.data?.some((d) => d.key === value) && <option value={value}>{value}</option>}
        {dicts.data?.map((d) => (
          <option key={d.key} value={d.key}>
            {d.title}
          </option>
        ))}
      </select>
      <span className="hint">Варіанти вибору — пункти довідника. Довідники — на «Панелі керування».</span>
    </div>
  );
}

export function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={s.switchRow}>
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={s.switch} onClick={() => onChange(!on)}>
        <span className={s.knob} />
      </button>
    </div>
  );
}
