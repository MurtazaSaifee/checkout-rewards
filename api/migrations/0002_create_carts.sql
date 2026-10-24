-- A cart belongs to the customer who created it and stores no prices: its lines
-- refer to products, and the current price is read whenever the cart is viewed.
CREATE TABLE carts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text        NOT NULL CHECK (char_length(customer_id) BETWEEN 1 AND 128),
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'checked_out')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One line per product in each cart. The quantity range is enforced here as well
-- as by the contract, so no code path can store a line outside it.
CREATE TABLE cart_lines (
  cart_id    uuid    NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id text    NOT NULL REFERENCES products (id),
  quantity   integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  PRIMARY KEY (cart_id, product_id)
);
