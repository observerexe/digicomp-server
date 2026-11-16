import type { RecordType } from '../api/types';
import { errorOf } from '../errors/messages';
import { templateChoices, useNewPaper, useTemplates } from '../lib/paperTemplates';
import { ChoiceButton } from './ChoiceButton';
import { ErrorMessage } from './ui';

/**
 * A new report about this record (its templates the reader may make
 * documents from), opened in the editor; nothing when there is none.
 */
export function NewReport({ type, id, label = 'Новий документ' }: { type: RecordType; id: string; label?: string }) {
  const templates = useTemplates();
  const newPaper = useNewPaper();
  const choices = templateChoices(templates.data, { report: type });
  if (!choices.length) return null;
  return (
    <>
      <ChoiceButton
        label={label}
        className="btn btn-ghost"
        choices={choices}
        disabled={newPaper.isPending}
        onPick={(templateId) => templateId && newPaper.mutate({ templateId, about: { type, id } })}
      />
      <ErrorMessage text={newPaper.isError ? errorOf(newPaper.error) : null} />
    </>
  );
}
