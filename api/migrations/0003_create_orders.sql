-- An order is the permanent record of a successful checkout. The order and its
-- lines copy names, prices and amounts as they were at checkout, so later price
-- or name changes never alter a placed order.
CREATE TABLE orders (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   integer     NOT NULL UNIQUE CHECK (order_number >= 1),
  customer_id    text        NOT NULL CHECK (char_length(customer_id) BETWEEN 1 AND 128),
  -- One order per cart. The cart lock already prevents a second checkout; this
  -- constraint makes the rule hold even if that lock is ever removed.
  cart_id        uuid        NOT NULL UNIQUE REFERENCES carts (id),
  subtotal_cents integer     NOT NULL CHECK (subtotal_cents >= 0),
  total_cents    integer     NOT NULL CHECK (total_cents >= 0),
  placed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_by_customer ON orders (customer_id, order_number);

CREATE TABLE order_lines (
  order_id          uuid    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id        text    NOT NULL REFERENCES products (id),
  product_name     text    NOT NULL CHECK (char_length(product_name) BETWEEN 1 AND 120),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_amount_cents integer NOT NULL CHECK (line_amount_cents >= 0),
  PRIMARY KEY (order_id, product_id)
);

-- The order-number counter. One row holds the last number handed out. Checkout
-- increments it as its last write before the order insert, so a checkout that
-- fails earlier never takes a number and the numbers have no gaps.
CREATE TABLE order_counter (
  id                integer PRIMARY KEY CHECK (id = 1),
  last_order_number integer NOT NULL DEFAULT 0 CHECK (last_order_number >= 0)
);

INSERT INTO order_counter (id) VALUES (1);
