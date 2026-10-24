-- A placed order records the coupon it redeemed, if any: the code, the percentage it
-- took off and the discount in cents. For every order the total is the subtotal less
-- the discount, which the check below holds to be true.
--
-- The unique coupon code allows one order per coupon. Checkout also locks the
-- coupon's row, so a second checkout waits and is refused cleanly. This constraint is
-- what keeps a coupon from being redeemed twice even if that lock were ever removed.
ALTER TABLE orders
  ADD COLUMN coupon_code        text    UNIQUE REFERENCES coupons (code),
  ADD COLUMN coupon_percent_off integer CHECK (coupon_percent_off BETWEEN 1 AND 100),
  ADD COLUMN discount_cents     integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD CONSTRAINT orders_coupon_fields_together
    CHECK ((coupon_code IS NULL) = (coupon_percent_off IS NULL)),
  ADD CONSTRAINT orders_total_is_subtotal_less_discount
    CHECK (total_cents = subtotal_cents - discount_cents);
