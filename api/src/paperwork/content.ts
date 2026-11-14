import { ValidateBy, type ValidationOptions } from 'class-validator';
import { checkContent } from '../../../shared/editor-schema';

export {
  CONTENT_LIMITS,
  EMPTY_CONTENT,
  type PaperContent,
} from '../../../shared/editor-schema';

/**
 * DTO check: a document of the shared editor schema
 * (shared/editor-schema: known nodes, marks and attribute values only).
 */
export function IsPaperContent(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isPaperContent',
      validator: {
        validate: (v) => checkContent(v),
        defaultMessage: () => '$property must be a document (type: doc)',
      },
    },
    options,
  );
}
