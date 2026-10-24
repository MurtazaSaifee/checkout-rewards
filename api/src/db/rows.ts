/**
 * The one row of a query that must return one, such as an aggregate or an
 * INSERT ... RETURNING. Having no row means the query or the schema is wrong,
 * not the data, so it throws with a message that names the query.
 */
export function singleRow<T>(rows: readonly T[], message: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(message);
  }
  return row;
}
