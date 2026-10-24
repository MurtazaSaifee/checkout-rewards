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

## Material decisions

Each decision gives the context, the options weighed, the choice, the reasons and what the choice costs.

### 1. The database enforces the rules that overlapping requests could break

**Context.** Stock, one order per cart, one redemption per coupon, unique order numbers and one coupon per milestone must hold when requests overlap, including requests served by different API instances. A rule held only in application code is as strong as the code path that remembers it.

**Options considered.** (a) Read the state, check it in application code, then write. Two requests can both pass the check, so every path needs the right lock, and one path that forgets it breaks the rule silently. (b) Serialise writes in one process. This stops at one instance and queues every write behind one lock. (c) Constraints, row locks and conditional updates in Postgres.

**Choice.** (c). Application code takes the lock or writes conditionally, and a constraint backs up each rule.

**Why.** The guarantee does not depend on which process runs the code. A path that omits its lock still fails at the constraint instead of breaking the rule. The stock write shows this: `UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2` cannot leave stock negative even without the check that precedes it.

**Consequences.** Constraint violations must be turned back into domain answers. The coupon unique violation on the order becomes `COUPON_ALREADY_REDEEMED`, and the milestone violation becomes `NO_ELIGIBLE_MILESTONE`. Rules that a constraint cannot express, such as an order's lines matching what was charged, are held by code paths. The invariants table says which are which.

### 2. A checkout is one transaction, and its idempotency key is claimed inside it

**Context.** A checkout writes stock, a coupon, an order number, an order, the cart status and the idempotency record. A client that times out retries, and the retry can arrive while the first attempt is still running.

**Options considered.** (a) Claim the key in its own transaction first and store the result afterwards. A crash between the two leaves a claim with no result, which needs a rule for stale claims before a retry can be answered. (b) Claim the key as the first statement of the checkout transaction, so a concurrent attempt waits on the uncommitted claim. (c) No key; rely on the cart's checked-out status. This stops a second order from one cart, but it cannot return the first response to a retry, and it cannot tell a retry from a second purchase.

**Choice.** (b). `INSERT ... ON CONFLICT (customer_id, idempotency_key) DO NOTHING` is the first statement, and the response is stored in the same transaction as the order.

**Why.** The stored response exists exactly when the order does. A crash rolls the claim back with everything else, so no stale claim can block a retry. A refused or declined attempt also rolls back its claim, so a corrected retry is evaluated afresh.

**Consequences.** The payment is charged inside the transaction, so every lock taken before the charge is held through the gateway call. A slow gateway delays other checkouts that need the same cart or products, and a retry of a slow checkout waits instead of failing. No timeout is set; the strategy section explains the gap.

### 3. Carts hold no prices

**Context.** A customer reads a cart and pays later. Prices can change in between, and the customer must not pay a different amount from the one they saw without being told.

**Options considered.** (a) Store each price on its cart line when the line is set. The cart then holds prices that can go stale, and checkout must reconcile them with current prices. (b) Price at checkout with no guard. The customer can pay more than the total they saw, with no signal. (c) Price at checkout, and compare with the total the client saw; refuse with the current total when they differ.

**Choice.** (c). Checkout prices come from one read inside its own transaction. When an expected total is sent and differs, the checkout is refused with `PRICE_CHANGED` and the current total, and nothing is placed.

**Why.** The customer pays the total they were shown, or is told the total has changed. The refusal happens before the charge and changes no stock, coupon or order number. A cart has no stored price to go stale.

**Consequences.** A client that sends no expected total pays the price in force during its checkout. The web app sends the subtotal when no coupon is named, the discounted total for an unredeemed coupon that it lists, and nothing otherwise. A cart shows current prices on every read.

### 4. Order numbers and milestones come from one counter row

**Context.** Order numbers must be unique and have no gaps, and coupon milestones depend on how many orders have been placed. Checkouts and coupon generation can all ask for the next number at once.

**Options considered.** (a) A Postgres sequence. It is fast, but a value taken by a transaction that rolls back is not returned, so a failed checkout would leave a gap. (b) Count the placed orders when needed. This is correct only under a lock, and counting a growing table is slower than reading one row. (c) A counter row, incremented inside the checkout transaction and locked by coupon generation.

**Choice.** (c). Checkout increments `order_counter` with `UPDATE ... RETURNING` as its last write before the order insert. Coupon generation locks the same row before it counts issued coupons and works out the milestone.

**Why.** An update inside a transaction that rolls back gives its number back, so numbers have no gaps. Because generation holds the same lock while it counts, two generation calls cannot both issue a coupon for one milestone. The unique milestone constraint is the backstop if the lock were removed.

**Consequences.** Every checkout writes this row, so placed orders queue on it. The wait is short, because the increment comes after the charge and is followed only by the insert and commit. The row is a throughput ceiling. An every-nth rule cannot be spread across several counters without changing what counts as the nth order; the evolution section returns to this.

### 5. A coupon's owner is checked, and a foreign code is refused by name

**Context.** A customer types a coupon code. The service must answer differently for an unknown code and for a real code that belongs to someone else, so that a typing mistake can be corrected. The semantics list fixes the ownership rule; this records the choice of answer.

**Options considered.** (a) Answer every unknown or foreign code with 404, which reveals nothing about other customers' codes. (b) Answer a foreign code with 422 `COUPON_NOT_OWNED`, distinct from `COUPON_NOT_FOUND`. (c) Skip the ownership check and rely on the code being hard to guess.

**Choice.** (b). Codes are ten characters drawn with a cryptographic random source from a 31-character alphabet, which leaves out I, L, O, 0 and 1.

**Why.** A code is typed by the customer who holds it, so a distinct answer lets them tell a typing mistake from a code that is not theirs. Codes are random over 31 to the power of ten values, so a guess almost never hits a real code.

**Consequences.** The answer does reveal whether a guessed code exists, and nothing rate-limits attempts; that is listed under known gaps. Carts and orders answer a foreign identifier with 404 instead, because they are looked up by identifier rather than typed.

### 6. Reports are computed on each request, in one read-only snapshot

**Context.** The admin report and the order and coupon lists must agree. Running totals kept beside the orders can drift from the rows they summarise.

**Options considered.** (a) Maintain running totals, updated by checkout and by coupon generation. Reads are cheap, but every write path must update them, and one missed path makes the report disagree. (b) Compute every figure from the rows on each request. (c) Build a separate read model asynchronously.

**Choice.** (b). The report runs in one `REPEATABLE READ READ ONLY` transaction, so its figures come from one snapshot and agree with each other.

**Why.** The figures come from the same rows that the lists read, so they reconcile by construction, and a reconciliation test checks this after mixed checkouts. A read-only transaction takes no row locks, so a report does not delay a checkout.

**Consequences.** The cost of a report grows with the number of orders, which the evolution section covers. Nothing is stored, so the report cannot be stale.

### 7. Customer identity and the admin key are placeholders behind one middleware each

**Context.** Carts, orders and coupons belong to customers, and an administrator needs a view of everything. Authentication is outside what this build sets out to do.

**Options considered.** (a) Sign-in with tokens. This adds machinery the scope does not need, and it would rest on an identity the service does not otherwise hold. (b) A header the client claims for the customer (`X-Customer-Id`) and a shared key for administrators (`X-Admin-Key`). (c) A fixed list of users in configuration.

**Choice.** (b). The customer header is checked for format and used as the owner in every query. The admin key is compared with SHA-256 digests in constant time. Each check lives in one middleware, so real authentication replaces that middleware and no route changes.

**Why.** Every owner filter works the same whatever produced the identity, and the administrator check is a single function that a reviewer can read in one place.

**Consequences.** Anyone who can set the customer header acts as that customer, and anyone who holds the admin key is an administrator. The admin key is not a security control. The default `local-admin-key` is a public development value, so a deployment that keeps the defaults is not safe.

## Transactions, concurrency and idempotency

**Isolation.** Writes run at Postgres's default, READ COMMITTED. A statement sees the rows committed before it starts. An update or `SELECT ... FOR UPDATE` that waited on a row re-checks the newest committed version of that row once the lock is released, so a waiter does not act on a state its holder replaced. The report is the one exception: it runs at `REPEATABLE READ READ ONLY` so that its figures come from a single snapshot. No other isolation level is set, and no statement or lock timeout is set.

**Lock order.** A checkout takes its locks in this order:

1. The idempotency key, through its unique insert. A concurrent attempt with the same key waits here.
2. The cart row, with `FOR UPDATE`. This also serialises every edit to that cart.
3. The product rows, one `UPDATE` per line, in ascending product id, which is the order in which the cart's lines are read.
4. The coupon row, when a coupon is named.
5. The counter row, as the last write before the order insert.

Coupon generation takes only the counter row. Setting a cart line takes the cart row and reads stock without locking it. Every path that holds more than one lock takes them in this order, so no two paths can wait on each other in a cycle.

**Waits.** Three cases rely on a waiter seeing committed state:

- A checkout that waits behind another checkout of the same cart reads the cart's status once that checkout ends. If it placed the order, the waiting checkout is refused with `CART_ALREADY_CHECKED_OUT`.
- A checkout that waits for a coupon another checkout redeemed re-checks the redemption, and is refused with `COUPON_ALREADY_REDEEMED`.
- A cart edit that waits behind a checkout re-reads the cart's status once that checkout ends. If the checkout placed the order, the edit is refused with `CART_ALREADY_CHECKED_OUT`, so the order holds exactly the lines that were checked out.

**The checkout, in order.**

1. Claim the idempotency key. A stored response is replayed. A key used with a different request is refused with `IDEMPOTENCY_KEY_REUSED`.
2. Lock the cart and read its lines. A checked-out cart is refused. An empty cart is refused with `CART_EMPTY`.
3. Take stock for each line in order. Every short line is collected, and any shortage refuses the checkout with `INSUFFICIENT_STOCK` and lists the short lines.
4. If a coupon is named, lock it and check its owner and its redemption.
5. Price the order. If the expected total sent differs, refuse with `PRICE_CHANGED`.
6. Charge the payment. A decline is refused with `PAYMENT_DECLINED`.
7. Take the next order number.
8. Insert the order, mark the coupon redeemed, insert the lines and mark the cart checked out. The order insert also carries a unique constraint on the coupon code, and a violation gives the same answer as the lock in step 4.
9. Store the response against the key, and commit.

Any error before step 9 rolls back the whole transaction, including the key claim. `errors.test.ts` checks this with a gateway that fails once with an unexpected error instead of declining: the response is `500 INTERNAL_ERROR`, nothing is placed, and a retry with the same key then places the order.

**Replays.** A replay sends the stored body through the same JSON serialiser. The bytes match the first response because the body holds only strings, integers, nulls and arrays. The idempotency test compares the raw text of both responses, so a change that serialised the body differently would fail it.

**Concurrency tests.** These send simultaneous requests and check the outcome. Each test runs once unless its entry says it repeats the race in rounds.

- `checkout.test.ts`: "lets exactly as many checkouts succeed as stock allows, fails the rest with INSUFFICIENT_STOCK, and leaves stock at zero". Eight checkouts race for the three units of `limited-hoodie`. One run.
- `checkout.test.ts`: "is either included in the order or rejected, and the cart and the order always agree". An edit to a cart races its checkout. The race repeats in 20 rounds, each with a fresh cart.
- `checkout-idempotency.test.ts`: "places one order when ten simultaneous checkouts share a key, takes the stock once, and returns identical responses". Ten attempts share one key. One run.
- `checkout-idempotency.test.ts`: "makes a retry that arrives while the first attempt is still running wait for it, then replays its response". The test holds the cart's row lock from a second connection, so the first attempt stops part way through, and the retry is sent while it is stuck. The test checks that the retry waits, then gets the same response as the first attempt. One run.
- `checkout-coupons.test.ts`: "lets exactly one checkout redeem the coupon and answers the other with 422 COUPON_ALREADY_REDEEMED, in every round". Two carts redeem one coupon at once. The race repeats in 10 rounds, each with its own coupon.
- `coupons.test.ts`: "issues exactly one coupon per unrewarded milestone and refuses the rest with NO_ELIGIBLE_MILESTONE". Twelve generation calls run at once. One run.
- `coupons.test.ts`: "refuses with 409 NO_ELIGIBLE_MILESTONE when the unique milestone constraint rejects the insert". This test is not simultaneous. A coupon row is inserted directly to stand in for a call that won the race, so the constraint is what refuses the insert. One run.
- `cart-lines.test.ts`: "keeps a single line at the requested quantity when identical requests arrive at the same moment". Ten identical requests run at once. One run.
- `admin-report-reconciliation.test.ts`: "counts every placed order, gapless from one, and the order count equals the highest order number". The test reads the result of mixed simultaneous waves, which run once in the test's setup.

Simultaneous requests make overlap likely, but most of these tests do not choose an interleaving. The retry test holds a lock to choose one, and the first item in what to examine next extends that technique.

**Money and rounding.**

- Every amount is an integer number of cents, stored in `integer` columns with non-negative checks: `unit_price_cents`, `line_amount_cents`, `subtotal_cents`, `discount_cents` and `total_cents`.
- A line amount is the unit price times the quantity. The subtotal is the sum of the line amounts.
- The discount is worked out once, on the subtotal, as `floor(subtotal × percent / 100)`, using integer arithmetic. Ten percent of 1,995 cents is 199.5 cents and gives 199. Two lines of 995 cents give a subtotal of 1,990 and a discount of 199. Rounding each line first would give 198.
- The total is the subtotal less the discount. The percentage is at most 100, so the total is never negative.
- Report sums are `bigint` in Postgres. The repository converts them to numbers, which is exact for any total below 2^53 cents.
- The amount columns are 32-bit `integer`, so one line or order above 2,147,483,647 cents is refused by Postgres. The service reports that as `INTERNAL_ERROR` rather than as a domain error. This is a known gap.
- The web app repeats the discount formula to compute the expected total. The server's comparison is the authority: a mismatch in the web copy is refused as `PRICE_CHANGED` and is never charged.

## Errors and the status rule

Every error is an RFC 9457 Problem Details document sent as `application/problem+json`. It carries a `type` URI, a `title`, a `status`, a `detail`, a stable `code` and a `requestId`. The `type` host is a placeholder. Some codes add extension members: `shortLines` for `INSUFFICIENT_STOCK`, `currentTotalCents` for `PRICE_CHANGED`, and `errors` for `VALIDATION_FAILED`.

Each domain error fixes its status, code and title in one place, so a status cannot drift away from its code. Requests and responses are checked against `api/openapi.yaml`, whose `ErrorCode` enum lists the same 23 codes as the server.

| Status | Codes | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED`, `MALFORMED_JSON`, `CUSTOMER_ID_REQUIRED`, `IDEMPOTENCY_KEY_REQUIRED` | The request is malformed or lacks a required header. |
| 401 | `ADMIN_KEY_INVALID` | The admin key is missing or wrong. |
| 402 | `PAYMENT_DECLINED` | The gateway declined the payment. |
| 404 | `CART_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `ORDER_NOT_FOUND`, `ROUTE_NOT_FOUND` | No such cart, product or order is visible to the caller, and no such route exists. |
| 405 | `METHOD_NOT_ALLOWED` | The route exists, but not for this method. The response carries an `Allow` header that lists the methods the route accepts. |
| 409 | `CART_ALREADY_CHECKED_OUT`, `INSUFFICIENT_STOCK`, `PRICE_CHANGED`, `NO_ELIGIBLE_MILESTONE` | The state has changed, or does not allow the action now. |
| 413 | `PAYLOAD_TOO_LARGE` | The body is larger than the limit. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | The body is not JSON. |
| 422 | `CART_EMPTY`, `IDEMPOTENCY_KEY_REUSED`, `COUPON_NOT_FOUND`, `COUPON_NOT_OWNED`, `COUPON_ALREADY_REDEEMED` | The request is well formed but cannot be acted on as sent. |
| 500 | `INTERNAL_ERROR` | An unexpected failure. A checkout that fails this way has rolled back. |

The status tells the client what to do next:

- **400 and 422** mean the request must change. Sending it again unchanged gets the same answer.
- **409** means the state moved. The client reads the state again and decides afresh. A checkout refused with 409 has placed nothing.
- **402** means the payment must change. The rest of the request can stay the same, and the cart stays open.
- **401** means the admin key must be corrected.
- **404** for another customer's cart or order hides that it exists. A coupon is the exception, as the material decisions explain.
- **500** from a checkout means nothing was placed, so the same `Idempotency-Key` can be retried.

Each checkout writes one outcome line: `ORDER_PLACED`, `IDEMPOTENT_REPLAY`, or the code of its refusal. An operator can count outcomes from the logs without reading response bodies. An unexpected failure is logged at error level by the error handler instead.

## What is built, what is deferred, and known gaps

**Built.** Products are listed. A customer can set and remove cart lines, read a cart, and check it out with an idempotency key. Orders and coupons are listed per customer, and an administrator can generate coupons, list coupons and orders, and read the report. Checkout pays through an in-process gateway that approves `tok_ok` and declines `tok_decline`. The web app covers a customer's cart, checkout, orders and coupons, and an administration panel. Compose runs the database, the API and the web app together. The tests are HTTP tests against real Postgres, plus unit tests for the pricing module, for configuration parsing in the API and the load script, for the transaction helper, and for the load script's plan, reconciliation and run summary.

**Deferred on purpose.** These were left out of the scope:

- Authentication. The customer and admin identities are the placeholders in decision 7.
- A real payment provider, and the two-phase payment flow described below.
- Stock holds and their expiry, and cleanup of abandoned carts.
- Endpoints to change products. Prices and stock are changed in the database.
- Coupon expiry, stacking several coupons, and changing the milestone interval or the coupon percentage while the service runs.
- Cancellation and refunds.
- Expiry of idempotency keys.
- Metrics, tracing, dashboards and production deployment.
- Frontend tests and visual polish, multiple currencies, and taxes.

**Known gaps.** These are real defects or weaknesses in the current code. Each is listed here until it is fixed, and then removed.

- The contract validator loads `api/openapi.yaml` on the first request, so a problem in the contract appears at that request rather than at startup. The library exposes no supported way to wait for the load before the server listens, so the check is not moved to startup.
- Amount columns are 32-bit integers, so an amount above 2,147,483,647 cents is reported as `INTERNAL_ERROR` rather than as a domain error.
- Idempotency records are never deleted, so the table grows with every checkout.
- There are no statement or lock timeouts. A slow checkout holds its rows until it ends.
- Coupon attempts are not rate-limited, so the coupon answers can be probed freely.
- Coupon generation takes the next milestone to be the number of coupons issued plus one. That assumes generation is the only writer of coupons, so a coupon inserted directly into the database at a later milestone would stop generation.

## Beyond one instance

Today every API instance connects to one Postgres database, and no rule depends on which instance served a request. Nothing that matters is held in process beyond configuration and the connection pool. The changes below are what a production version would need. They are not built here.

- **Two-phase payment.** The checkout charges while it holds the cart and stock locks, so a slow gateway lengthens every waiting request. A production version would first record a pending order, charge with an idempotency key the provider accepts, then confirm or release the order. A reconciliation job would settle any payment whose outcome was never recorded. The charge would then run outside the locks that hold the cart and stock.
- **The counter row as a ceiling.** Every placed order passes through one row. That is acceptable at this scale, but it caps throughput. Measure its lock wait under load before changing it. An every-nth rule cannot be split across several counters without changing which order counts as the nth, so a change here has to keep one sequence of order numbers.
- **Popular products.** A popular product serialises its checkouts on one stock row. Stock holds with expiry would move that wait to the cart, which this build does not do.
- **Reports at scale.** The report reads the order history on each request. A read model updated in the same transaction as each order would keep reads cheap, and the reconciliation test would remain the check that it agrees with the lists.
- **Real authentication.** It replaces the customer header in the same middleware. Every owner filter in the queries stays, so the identity change does not reach the queries. Administrators get a role in place of the shared key.
- **Metrics.** Count outcomes by code, and time the waits for locks and for connections, so the cost of the cart and product locks is visible before it becomes a problem.
- **Timeouts.** Set a statement timeout and a lock timeout on each session, so one stuck call cannot hold rows indefinitely.
- **Idempotency retention.** Keep each key for longer than any client's retry window, then delete keys in a batch. Deleting too early would let a late retry place a second order.
- **Shared configuration.** Every instance must run with the same `ADMIN_KEY`, `COUPON_EVERY_N_ORDERS` and `COUPON_PERCENT_OFF`. Settings live in each process, not in the database, so an instance with a different interval would issue coupons at different milestones without any error.

## How AI tools were used

An AI coding assistant helped with planning, implementation and review. The author set the scope, reviewed each change before it was merged, and decided what to keep. Each branch was built in its own git worktree and reviewed, through its diff and its tests, before it was merged. The examples below are places where the review changed the result.

1. **Scope.** The first proposal treated the frontend as optional. The author rejected that, and made the frontend a required testing aid, with the race scenarios among its tools.
2. **Scope.** Endpoints for changing products were not added. A documented database statement changes prices and stock, which keeps the work on checkout correctness.
3. **Conflicts.** Two parallel branches each created migration `0004`. Review caught it, and the coupons migration was renumbered `0005` before the merge.
4. **Observability.** The first checkout implementation logged successes without an outcome code, and left refusals to the generic error log. It was changed to one outcome line per checkout, carrying its code.
5. **Concurrency.** A lost race in coupon generation surfaced as a 500. It was changed to 409 `NO_ELIGIBLE_MILESTONE`, and a test forces the unique constraint to reject an insert.
6. **Attribution.** Commit attribution was wrong until a review flagged it. It was corrected.
7. **Repository history.** A history rewrite meant to remove material that should not be public also deleted working files. They were restored from a backup bundle taken beforehand. Back up before any rewrite, and check the working tree afterwards.

## What to examine first with two more hours

1. **Interleavings.** Hold a coupon or cart row lock from a test connection, let a checkout wait on it, release the lock, and check that the waiter re-reads the committed state. The current tests sample overlap with `Promise.all`, which makes overlap likely but does not choose the order. This test would check the READ COMMITTED reasoning directly.
2. **Two-phase payment.** The charge runs while the cart and stock locks are held. Separating the pending order from the payment removes that, and it is the change with the largest effect on throughput.
3. **The known gaps.** Start with the missing pool error listener, and with the 32-bit amount columns, which can answer a valid request with a 500.
