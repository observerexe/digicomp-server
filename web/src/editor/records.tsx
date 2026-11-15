import { createContext, useContext } from 'react';
import type { RecordView } from '../lib/records';

/**
 * Records the document refers to (`ref:*` values, «@»), as the reader sees
 * them: the server's `refs`, plus what is picked while editing.
 */
export type PaperRecords = {
  get: (type: string, id: string) => RecordView | undefined;
  add: (r: RecordView) => void;
};

export const recordKey = (type: string, id: string) => `${type}:${id}`;

export const PaperRecordsContext = createContext<PaperRecords>({ get: () => undefined, add: () => {} });

export const usePaperRecords = () => useContext(PaperRecordsContext);
