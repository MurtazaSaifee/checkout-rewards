-- Products carry the current unit price and the stock available to sell.
-- Money is integer cents. The CHECK constraints are the last line of defence:
-- no code path, present or future, can store a negative stock level.
CREATE TABLE products (
  id              text        PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  unit_price_cents integer    NOT NULL CHECK (unit_price_cents >= 0),
  stock           integer     NOT NULL CHECK (stock >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
