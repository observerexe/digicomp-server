import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { errorOf } from '../errors/messages';
import { ConfirmButton, ErrorMessage } from './ui';

/**
 * «Видалити» = у кошик: asks once, deletes, leaves for the section's list.
 * The record's own query is dropped first, so the open page does not refetch a deleted record.
 */
export function TrashButton(props: {
  question: string;
  remove: () => Promise<unknown>;
  /** The record's own query. */
  own: QueryKey;
  /** Lists to refresh. */
  lists: QueryKey;
  /** Where to go after. */
  to: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: props.remove,
    onSuccess: () => {
      qc.removeQueries({ queryKey: props.own });
      void navigate(props.to);
      void qc.invalidateQueries({ queryKey: props.lists });
      void qc.invalidateQueries({ queryKey: ['trash'] });
    },
  });
  return (
    <>
      <ConfirmButton label="Видалити" question={props.question} confirmLabel="Видалити" danger disabled={remove.isPending} onConfirm={() => remove.mutate()} />
      <ErrorMessage text={remove.isError ? errorOf(remove.error) : null} />
    </>
  );
}
