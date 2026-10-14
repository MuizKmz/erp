import type { FieldError } from '../../platform/http/errors';
import type { FieldChange } from './audit.rules';

/**
 * What saving a record would do, worked out without saving (CLAUDE.md → Phase 3 · decision 10). The screens' create
 * and update use it before they save, and the import's Check shows it, so both follow the same rules (SRS BR-VAL-020).
 */
export interface RecordPreview {
  /** What would change, field by field. Empty for a new record, or when the save changes nothing. */
  changes: FieldChange[];
  /** The permission the user lacks for this change (403), if any. */
  permission: string | null;
  /** Field problems (400). */
  errors: FieldError[];
  /** A broken business rule (409), such as a base unit already used on documents. */
  conflict?: string | null;
}
