# Decisions

This document explains how the service keeps its rules when requests overlap, are retried or fail, and why it is built the way it is. The invariants table shows where each rule is enforced. The sections after it give the semantics chosen where the requirements were open, the reasoning behind each material decision, the transaction strategy, the money and error rules, what is built and what is deferred, how the design grows beyond one instance, how AI tools were used, and what to examine next.

## Overview

The service sells products from a catalogue with limited stock, turns customers' carts into orders, and rewards every nth placed order with a single-use percentage coupon. The difficulty is not the endpoints. It is what happens when requests overlap: two checkouts competing for the last units, a client retrying after a timeout, two checkouts redeeming one coupon, a payment declined after stock was claimed, or a price changing between the moment a customer reads a cart and the moment they pay.

Five choices carry most of the design:

- **The database enforces the rules.** Stock, order numbers, coupon redemption and milestones are protected by constraints, row locks and conditional updates in Postgres. No guarantee depends on one process, so the rules hold however many API instances connect.
- **A checkout is one transaction** that places the order in full or changes nothing. Its idempotency key is claimed inside that transaction, so a retry either receives the stored response or waits for the attempt it repeats.
- **Carts hold no prices.** A checkout is priced at current prices. A client may send the total it saw, and a difference is refused before any charge.
- **Coupons belong to the customer who placed the milestone order.** A coupon is spent only by the placed order that uses it.
- **Money is integer cents, and the API is written as an OpenAPI document before the handlers.** Each error has a stable code, and each HTTP status has one meaning.

Two scope limits are deliberate. Customer identity is a header the client claims, and the payment gateway is an in-process fake. Both are covered under deferred work.

## Invariants and where they are enforced

Each row names a rule and the mechanism that holds it: a constraint, a row lock or a conditional update. File paths are relative to the repository root.

| Invariant | Enforced by |
| --- | --- |
| Stock never goes negative, and no more is sold than is in stock | `products.stock CHECK (stock >= 0)` in `api/migrations/0001_create_products.sql`. Checkout runs `UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2` for each line (`takeStock`). A statement that changes no row is a shortage. Lines are taken in ascending product order. |
| A cart produces at most one order | `lockEditableCart` locks the cart row with `FOR UPDATE` and refuses a checked-out cart. `orders.cart_id UNIQUE` holds the rule even without the lock. |
| Edits to a cart and its checkout never interleave | Every cart edit and every checkout takes the cart row lock first. A waiting caller re-reads the committed status once the holder ends. |
| A retry never places a second order | `idempotency_keys` has the primary key `(customer_id, idempotency_key)`. Checkout claims the key with `INSERT ... ON CONFLICT DO NOTHING` as its first step, so a concurrent attempt waits on the claim until the first one commits or rolls back. |
| A key is never replayed for a different request | The request fingerprint, a SHA-256 digest of the cart and every checkout option with defaults applied, is stored with the key and compared before any replay (`IDEMPOTENCY_KEY_REUSED`). |
| Order numbers are unique, start at 1 and have no gaps | `orders.order_number UNIQUE CHECK (order_number >= 1)`. The `order_counter` row is incremented with `UPDATE ... RETURNING` as the last write before the order insert, so a rolled-back checkout gives its number back. |
| A coupon is redeemed by at most one order | Checkout locks the coupon row (`lockCouponByCode`, `FOR UPDATE`) and checks its redemption. `orders.coupon_code UNIQUE REFERENCES coupons` stops a second order for the same coupon even if the lock were removed. |
| A coupon records at most one order, and an order at most one coupon | `coupons.redeemed_by_order_id UNIQUE REFERENCES orders`. A checkout names one coupon field. |
| A coupon belongs to the milestone customer | `coupons.customer_id` is copied from the order numbered k×n when the coupon is issued. Checkout compares it with the calling customer under the coupon lock (`COUPON_NOT_OWNED`). |
| One coupon per milestone | `coupons.milestone UNIQUE`. Generation locks the counter row before it counts issued coupons. |
| A coupon is issued only for a reached milestone | Generation computes `floor(orders / n)` under the counter lock and refuses when the next milestone lies beyond it (`NO_ELIGIBLE_MILESTONE`). |
| The total is the subtotal less the discount, and is never negative | `orders_total_is_subtotal_less_discount` and `total_cents >= 0`. The discount is `floor(subtotal × percent / 100)` with the percentage between 0 and 100, so it cannot exceed the subtotal (`discountCents`). |
| An order's coupon fields are either all present or all absent | `orders_coupon_fields_together`. |
| A placed order never changes | No statement in the service updates or deletes `orders` or `order_lines`. Names and prices are copied in at checkout. The code paths hold this, not a trigger. |
| The lines and subtotal of an order match what was charged | Both are written in the checkout transaction from the same read that the price guard and the charge use. The code holds this, not a constraint. |
| The customer pays the total they saw | The price guard runs inside the checkout transaction, after the discount and before the charge (`PRICE_CHANGED`). |
| A failed checkout leaves nothing behind | Stock, coupon redemption, order number, order, cart status and idempotency record are written in one transaction and roll back together. |
| A cart has one line per product, with a quantity from 1 to 99 | `cart_lines` primary key `(cart_id, product_id)` and `CHECK (quantity BETWEEN 1 AND 99)`. Setting a line is an upsert. |
| Money is exact | Money columns are integer cents with non-negative checks, and the pricing module uses integer arithmetic only. |
| Customers see only their own carts, orders and coupons | Every query filters on the owner. Another customer's cart or order is answered exactly like a missing one. |
| Reports change nothing and agree with the lists | The report reads in one `REPEATABLE READ READ ONLY` transaction and stores nothing. |
| The schema and seed data apply once and never reset data | Migrations run under a transaction-scoped advisory lock and are recorded in `schema_migrations`. Seeding uses `INSERT ... ON CONFLICT (id) DO NOTHING`. |

## Ambiguities and the semantics chosen

The requirements left these questions open. Each choice is stated here and is exercised by the tests where the behaviour can be observed.

1. **Coupon ownership.** The coupon for milestone k goes to the customer who placed order k×n, and only that customer can redeem it. A customer with no order at a milestone never receives its coupon. Another customer's coupon is answered `COUPON_NOT_OWNED` rather than hidden as not found. Carts and orders are hidden because they are looked up by identifier. A coupon is a code the customer types, and the answer lets a mistyped code (`COUPON_NOT_FOUND`) be told apart from a real code that is not theirs. The cost is that a code's existence is disclosed to whoever already holds it.
2. **What counts toward a milestone.** Every placed order counts, including orders that redeemed a coupon. Milestone k is reached by order number k×n. Order numbers have no gaps and orders are never deleted, so a failed checkout never counts, and a reached milestone stays reached.
3. **The backlog.** Each generate call issues one coupon, for the oldest reached milestone that has none, and reports how many reached milestones still wait. When none is waiting, the call is refused with `NO_ELIGIBLE_MILESTONE`. Nothing issues coupons on a timer, so a missed milestone waits until an administrator asks.
4. **Redemption.** A coupon is spent only by a placed order. A failed checkout leaves it unredeemed, including a checkout with an empty cart, a short line, a changed price or a declined payment. A checkout takes at most one coupon. Coupons never expire, and each keeps the percentage it was issued with.
5. **Discount base.** The discount is worked out once, on the subtotal, and rounded down to a whole cent. Two lines of 995 cents at 10 percent give a discount of 199 cents, not 198.
6. **Prices.** A cart shows the price in force when it is read. A checkout is priced at the prices read inside its own transaction. If the client sent an expected total and it differs, nothing is placed and the response carries the current total. If no expected total was sent, the checkout proceeds at current prices. A placed order keeps the prices it was placed at.
7. **Expected total with a coupon.** The expected total is the total the customer sees, so with a coupon it is the discounted total. Comparing it with the subtotal would refuse a correct total, or accept an undiscounted one.
8. **Stock timing.** Setting a cart line checks the requested quantity against current stock and refuses an excess with `INSUFFICIENT_STOCK`, but holds nothing. Stock is taken only when an order is placed, so a line that passed the check can still be refused at checkout.
9. **Quantities.** A cart-line request sets the quantity; it does not add to it, so repeating the request changes nothing. Zero is not a quantity. Removal is a separate delete.
10. **Retries.** A checkout must carry an `Idempotency-Key`. A retry with the same key and the same request receives the first attempt's response, and waits for that attempt if it is still running. Only a successful checkout stores its response. A refused or declined checkout frees its key, so a corrected retry is evaluated afresh.
11. **Checked-out carts.** A checked-out cart cannot be edited or checked out again, even under a new key. A key protects retries of the attempt that placed the order, not later purchases.
12. **Empty carts** are refused with `CART_EMPTY` (422), and the cart stays open.
13. **Declines.** A declined checkout places nothing, takes no stock and no order number, and leaves the cart open. The same cart can be checked out again with an approving token, and the same key works again, because a declined attempt stored nothing.
14. **Settings.** The milestone interval and the coupon percentage are read at startup and fixed for the life of the process. Changing the interval once orders exist would move milestones that have already passed.
15. **Products.** Prices and stock are changed in the database, where the constraints still apply. Checkout handles a price or stock change that happens while a cart is open.
