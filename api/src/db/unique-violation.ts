/** Postgres's SQLSTATE for a unique constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * True only when the error is a unique violation on the named constraint, so
 * any other failure still surfaces as an error.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION &&
    'constraint' in error &&
    error.constraint === constraint
  );
}
