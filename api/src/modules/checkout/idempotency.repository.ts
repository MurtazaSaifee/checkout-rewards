import type { PoolClient } from 'pg';

/** The response an earlier attempt stored under its key: the status, and the body as the exact JSON text sent. */
export interface StoredResponse {
  status: number;
  bodyJson: string;
}

export type KeyClaim =
  | { claimed: true }
  | { claimed: false; fingerprint: string; response: StoredResponse };

/**
 * Claims the idempotency key for the customer, inside the caller's transaction.
 *
 * The insert takes the unique (customer, key) pair. If another transaction holds
 * that pair and has not finished, the insert waits for it: when that transaction
 * commits, the insert does nothing and the committed record is read back; when it
 * rolls back, the insert succeeds and this transaction holds the key. A plain
 * check-then-insert would let two concurrent attempts both see no record.
 */
export async function claimIdempotencyKey(
  client: PoolClient,
  customerId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<KeyClaim> {
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (customer_id, idempotency_key, fingerprint)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_id, idempotency_key) DO NOTHING`,
    [customerId, idempotencyKey, fingerprint],
  );
  if (inserted.rowCount === 1) {
    return { claimed: true };
  }

  // The conflicting record was committed, so every column the claim left open is now set.
  const { rows } = await client.query<{
    fingerprint: string;
    responseStatus: number | null;
    responseBody: string | null;
  }>(
    `SELECT fingerprint, response_status AS "responseStatus", response_body AS "responseBody"
       FROM idempotency_keys
      WHERE customer_id = $1 AND idempotency_key = $2`,
    [customerId, idempotencyKey],
  );
  const row = rows[0];
  if (row === undefined || row.responseStatus === null || row.responseBody === null) {
    throw new Error('a committed idempotency record has no stored response');
  }
  return {
    claimed: false,
    fingerprint: row.fingerprint,
    response: { status: row.responseStatus, bodyJson: row.responseBody },
  };
}

/** Stores the response against the claimed key. Runs in the same transaction as the claim, before it commits. */
export async function storeIdempotentResponse(
  client: PoolClient,
  customerId: string,
  idempotencyKey: string,
  response: StoredResponse,
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
        SET response_status = $3, response_body = $4
      WHERE customer_id = $1 AND idempotency_key = $2`,
    [customerId, idempotencyKey, response.status, response.bodyJson],
  );
}
