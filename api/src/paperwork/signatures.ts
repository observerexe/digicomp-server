import { ValidateBy, type ValidationOptions } from 'class-validator';
import {
  SIGN_HEIGHT,
  SIGN_LIMITS,
  SIGN_WIDTH,
  strokesValid,
} from '../../../shared/editor-schema/signature';

/**
 * Drawn signatures: the field, limits and drawing are shared with the
 * editor (shared/editor-schema/signature.ts); here — the DTO check.
 */

/** DTO check: see strokesValid. */
export function IsStrokes(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isStrokes',
      validator: {
        validate: (v) => strokesValid(v),
        defaultMessage: () =>
          `$property must be 1–${SIGN_LIMITS.strokes} strokes of whole points within ${SIGN_WIDTH}×${SIGN_HEIGHT}, up to ${SIGN_LIMITS.strokePoints} points each, ${SIGN_LIMITS.points} in all`,
      },
    },
    options,
  );
}
