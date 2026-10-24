-- An idempotency record remembers how a checkout ended under a key the customer
-- sent. The row is inserted inside the checkout transaction, which claims the key:
-- a concurrent attempt with the same key waits on that insert until the claim
-- commits or rolls back. Only a successful checkout stores its response. A failed
-- one rolls the claim back with everything else, so its key is free again.
CREATE TABLE idempotency_keys (
  customer_id     text        NOT NULL CHECK (char_length(customer_id) BETWEEN 1 AND 128),
  idempotency_key text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  -- A SHA-256 digest of the cart and the checkout options, in hexadecimal.
  fingerprint     text        NOT NULL CHECK (char_length(fingerprint) = 64),
  -- The response as it was sent: its status, and its body as the exact JSON text,
  -- so a replay returns the same bytes. Both are null only while the claim is open.
  response_status integer     CHECK (response_status BETWEEN 100 AND 599),
  response_body  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, idempotency_key),
  CHECK ((response_status IS NULL) = (response_body IS NULL))
);
