-- A coupon rewards the customer who placed a milestone order. The code is what
-- the customer types at checkout. The percentage is copied in when the coupon
-- is issued, so a later change to the configured percentage never alters it.
-- Coupons never expire, so there is no expiry column.
CREATE TABLE coupons (
  code                 text        PRIMARY KEY CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$'),
  -- One coupon per milestone. Generation takes the order-counter lock, which
  -- already serialises it; this constraint is the second safeguard.
  milestone            integer     NOT NULL UNIQUE CHECK (milestone >= 1),
  customer_id          text        NOT NULL CHECK (char_length(customer_id) BETWEEN 1 AND 128),
  percent_off          integer     NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  issued_at            timestamptz NOT NULL DEFAULT now(),
  -- The order that redeemed the coupon, if any. Unique, so a coupon is redeemed
  -- by at most one order, and an order redeems at most one coupon.
  redeemed_by_order_id uuid        UNIQUE REFERENCES orders (id)
);

CREATE INDEX coupons_by_customer ON coupons (customer_id, milestone);
