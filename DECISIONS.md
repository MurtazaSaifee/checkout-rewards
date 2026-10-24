# Decisions

This document records the material decisions behind the service: the problem each one solves, the alternatives considered, what was chosen, why, and what it costs.

## Decision: Postgres enforces the invariants

**Context:** The service must never oversell stock, redeem a coupon twice, or create two orders from one checkout, even when requests overlap. A check written in application code is racy. Two requests can each read "three units in stock", each decide there is enough, and each proceed.

**Options considered:**

1. In-process locks (mutexes) around the business logic.
2. An in-memory store behind a single-threaded queue.
3. Embedded SQLite with transactions.
4. Postgres, with each invariant expressed as a constraint or as a single statement that checks and changes state together.

**Choice:** Postgres, with the invariants held by the database itself. Stock is a column with `CHECK (stock >= 0)`, so no code path can store a negative value. Identifiers and natural keys are primary keys or unique constraints. Where a decision depends on the current state, the check and the change happen in one statement, for example a conditional `UPDATE ... WHERE stock >= $n`. Where several steps must be serialised, the row is locked with `SELECT ... FOR UPDATE` inside a transaction.

**Why:** In-process locks protect only the process that holds them. The moment a second instance runs, they stop protecting anything, and nothing signals that. Constraints enforced by the database hold however many API instances connect. They also guard against bugs and manual edits: a negative stock level is rejected even when the application code that should prevent it is wrong. An in-memory store or SQLite would need the same guarantees rebuilt by hand, and neither handles several writer processes well.

Schema changes are serialised too. The migration runner applies all pending files in one transaction under a transaction-scoped advisory lock. Instances that start together queue on the lock, and the second one finds nothing left to apply. Seeding uses `INSERT ... ON CONFLICT (id) DO NOTHING`, so it is safe to run on every start and never overwrites a value someone has since changed.

**Consequences:** The service needs a Postgres server, which Compose provides and the test setup expects. The rules are visible in the schema, where a reviewer can read them, but enforcement is split between SQL and TypeScript, so the statement that enforces a rule must be read to see it. Behaviour under concurrency depends on Postgres's isolation and locking semantics, which the design treats as part of its contract. Scaling out needs no change to these rules.

## Decision: Contract-first OpenAPI

**Context:** The API has many endpoints and a precise set of error codes. Clients need one authoritative description of it, and the implementation must be checked against that description rather than drift from it.

**Options considered:**

1. Generate the specification from code annotations.
2. Describe the API in prose in the README.
3. Write the OpenAPI document first, validate the implementation against it at runtime, and generate client types from it.

**Choice:** Option 3. `api/openapi.yaml` is written before the handlers. `express-openapi-validator` validates every request and every response against it, and the web app generates its types from the same file with `openapi-typescript`.

**Why:** The error model and the status codes are the most important part of this API. A single reviewable document makes them easy to check, where annotations would scatter them through handlers. Generated specifications describe what the code happens to do, which makes them a weak design tool. Prose drifts from the code. Validating responses at runtime means a handler cannot return a shape the contract does not declare. Generating frontend types from the same file means a contract change breaks the frontend build instead of failing at runtime.

**Consequences:** Every change starts in the contract. The validator adds work to each request, which is acceptable at this scale. The validator loads and checks the document on the first request rather than at process start, so a broken document surfaces as a failure of that request. The integration tests exercise every operation, which makes a broken document fail the test run and the continuous integration build instead. The document is OpenAPI 3.0.3.

## Decision: Plain SQL over an ORM

**Context:** The invariants depend on specific statements: `SELECT ... FOR UPDATE`, conditional `UPDATE` statements, unique constraints. A reviewer needs to read those statements where the rule is enforced, and a generated statement hides the lock or the condition the design relies on.

**Options considered:**

1. An ORM such as Prisma or TypeORM.
2. A query builder such as Kysely.
3. Hand-written SQL through the `pg` driver, with plain migration files.

**Choice:** Option 3. Queries are hand-written SQL run through `pg`. Migrations are numbered `.sql` files that a small runner applies at startup.

**Why:** An ORM generates the statements, and the generated statements are exactly what the design must control. Row locks and conditional updates are awkward in ORMs and usually end up as raw-query escape hatches, which turns the escape hatch into the main path. A query builder still places an abstraction between the reader and the statement. Plain SQL keeps each enforcing statement readable where it lives, and the migration files are exactly what Postgres runs.

**Consequences:** There is more SQL to write and review, and no generated row types, so the shape of each query result is declared by hand next to the query. The schema changes only through migration files, which are the single source of truth for it. The tests check behaviour through the API rather than the mapping layer, so a mistake in a hand-written mapping shows up as a failing response.

## Decision: Problem Details error model

**Context:** Clients must handle errors programmatically. Errors come from many layers (contract validation, JSON parsing, routing, business rules, and unexpected failures), and internal detail such as stack traces must never reach a client.

**Options considered:**

1. A bespoke envelope such as `{ "error": { "message": "..." } }`.
2. RFC 9457 Problem Details with extra fields added as needed.
3. RFC 9457 Problem Details, with a stable application-level `code` and the request identifier as standard members.

**Choice:** Option 3. Every error is an RFC 9457 document served as `application/problem+json`. It has `type`, `title`, `status` and `detail`, plus a stable `code` and the `requestId`. Code-specific fields are extension members. For example, a validation error lists the offending `errors` by path. Domain failures are typed errors that carry their own status, code and title, and they are mapped in one place. Anything unexpected becomes `INTERNAL_ERROR` with a generic detail. The underlying error is logged under the request identifier and never sent to the client.

**Why:** RFC 9457 is a standard shape that clients and tooling already understand. Clients branch on `code`, because `title` and `detail` are written for people and may change. The `type` member is required by the standard and is stable per code. The request identifier appears in the header and in the body, so a client can quote it and an operator can find the matching log lines. A single mapping point means no route can return an error in a different shape.

**Consequences:** Each error code is a commitment to clients, so codes are listed in the contract's `ErrorCode` enum and never renamed. The `type` URI is an identifier rather than a link to a page; its host is a placeholder. A new domain error needs a code, a status and a contract entry. The `ErrorCode` union in TypeScript stops a handler from using a code the contract does not declare.

## Decision: One rule for status codes

**Context:** A client should decide from the status alone whether to correct the request, re-read the resource and try again, or stop. Ad hoc choices between 400, 409 and 422 make that unpredictable, and so does mixing "not found" with "not yours".

**Options considered:**

1. Use 400 for every failed request, whatever the cause.
2. Use 409 for every rejected state change.
3. Assign each status a single meaning, and apply it everywhere.

**Choice:** Option 3, with these meanings:

- **400** the request is malformed: bad JSON, a value of the wrong type, an unknown parameter, or a missing required header. The contract validator rejects these before any business logic runs.
- **401** the admin key header is missing or wrong.
- **402** the payment was declined.
- **404** the resource does not exist, or it exists but is not visible to this caller. Ownership is never revealed, so another customer's cart and the absence of a cart look the same. An unknown route also answers 404.
- **409** the request conflicts with the current state of a resource. The client should re-read that resource before deciding what to do.
- **422** the request is well formed and breaks a business rule that the current state does not change, such as checking out an empty cart or reusing an idempotency key for a different request.
- **500** an unexpected failure, reported without internal detail.

**Why:** The rule turns the status into a retry policy. A 400 or 422 means the same request will fail again and must change first. A 409 means re-reading state and trying again is reasonable. A 402 means the customer has to change the payment. A 404 keeps one customer's data from being detectable by another.

**Consequences:** Clients can write one handler per status class. Today the service uses 400, 404, 409 and 500; the other codes apply as the operations that need them land. Every new error must be assigned one of these meanings, and the contract's description states the rule so a reviewer can check it. The boundary between 409 and 422 takes judgement, and the rule is written down so that judgement is applied the same way each time.

## Decision: Customer identity is claimed, not verified

**Context:** Each cart belongs to one customer, and the API must know which customer a request is for. The service has no sign-in, so there is no verified identity to rely on.

**Options considered:**

1. Verify the customer with a token or session issued at sign-in.
2. Accept a customer identifier in the `X-Customer-Id` header and trust it.
3. Take the customer from the request path or body.

**Choice:** Option 2. Every cart operation requires the `X-Customer-Id` header. A request without it, or with a blank value, is refused with `CUSTOMER_ID_REQUIRED` before any other check runs. A cart is found only when its owner matches the header, and a cart owned by someone else is reported as not found.

The header is claimed, not verified: any caller can send any identifier. The rule keeps carts apart in ordinary use. It is not a security control.

**Why:** A verified identity needs a sign-in mechanism that the service does not have yet. A header keeps customer data out of paths and bodies, and one middleware applies the rule to every cart route. The check runs before the contract validator, so a missing header gets its own code rather than a generic validation failure.

**Consequences:** Anyone who knows a customer's identifier can read and change that customer's cart. The service must not rely on this header to protect money or personal data. When sign-in arrives, the header is replaced by a verified identity at the same point in the request pipeline, and the owner filter in the queries stays as it is.

## Decision: Carts store no prices

**Context:** A cart shows what a customer would pay. Prices change, and a cart can stay open for days, so a copied price can go out of date without anyone noticing.

**Options considered:**

1. Copy each product's unit price into the cart line when the line is set.
2. Read each line's unit price from the product every time the cart is read.

**Choice:** Option 2. A cart line stores only the product and the quantity. The unit price, line amount and subtotal are calculated from the current product price on every read and every change, by one pure module with no database access. Money is held as whole cents.

**Why:** A stored price is a second copy of a fact that already lives in the products table, and the two copies drift apart. Reading the live price means a cart never shows a stale figure, and a price change needs no repair of existing carts. One arithmetic module means every total is computed the same way, and whole cents keep the arithmetic exact.

**Consequences:** A cart's total can differ between two reads when a price changes between them. The figures shown in a cart are current estimates, not a promise of what a later purchase will cost. Every caller that needs a total uses the same module, so they agree with each other.

## Decision: Lines are set to a quantity, not incremented

**Context:** A client may send the same request twice when a connection drops, or two browser tabs may change the same line. If each request added its quantity to the line, a retry would count twice.

**Options considered:**

1. Add the quantity in each request to the line.
2. Set the line to the quantity in the request, replacing whatever was there.

**Choice:** Option 2. Setting a line creates it if needed and replaces its quantity, so sending the same request again leaves the cart unchanged. Removing a line deletes it, and removing a line that is already gone also succeeds. Quantities are whole numbers from 1 to 99. Zero is not a quantity: a client removes a line with the delete operation.

**Why:** A replacement has the same effect however many times it arrives, so retries are safe. Concurrent identical requests leave one line, not several. The quantity a customer sees is the quantity the cart holds, which an increment cannot guarantee when two tabs are open. Refusing zero leaves one way to remove a line.

**Consequences:** To add one more unit, a client must read the current quantity and send the new total. Two clients editing the same line race, and the last request wins. The limit of 99 is a business rule. Changing it means changing the contract, the schema check and the tests together.

## Decision: Stock is checked when a line is set and taken at checkout

**Context:** A customer who asks for more of a product than is in stock should learn that when they set the line, not at the end. Reserving stock for every open cart would let abandoned carts block other customers, and nothing signals when a cart has been abandoned.

**Options considered:**

1. Reserve stock when a line is set, and release it when the cart is abandoned.
2. Check stock when a line is set without changing it, and take stock only at checkout.
3. Do not check stock until checkout.

**Choice:** Option 2. Setting a line compares the requested quantity with the product's current stock. If the quantity is higher, the request is refused with `INSUFFICIENT_STOCK` (409), and the body lists each short line with the quantity requested and the quantity available. The check changes nothing. Only checkout takes stock.

**Why:** A reservation needs an expiry rule, and an abandoned cart gives no signal that it has been abandoned. Reserving on set would turn idle carts into lost sales for everyone else. The check still gives the customer early feedback at no cost to anyone. The guarantee that stock never goes negative does not rest on this check. It rests on the database constraint and on a conditional update at checkout.

**Consequences:** A line that passes the check can still fail at checkout when another customer has bought the stock first. The check answers whether there is enough now, not whether there will be enough when the customer pays. Checkout must make its own conditional decrement and report a shortage when it finds one.

## Decision: Cart changes are serialised on the cart row

**Context:** A change to a cart reads the cart's status, checks the product and writes a line. If two changes to the same cart run together, one can check the cart before the other has written, and a line can be added to a cart that has just been checked out.

**Options considered:**

1. Lock the cart row with `SELECT ... FOR UPDATE` inside a transaction for each change.
2. Give each cart a version number, and have clients retry when it has moved on.
3. Run every transaction at the serialisable isolation level, and retry the ones Postgres aborts.

**Choice:** Option 1. Each change to a cart runs in one transaction that first locks the cart row, and checkout takes the same lock. A change to a cart that is already checked out is refused with `CART_ALREADY_CHECKED_OUT` (409), and removing a line from such a cart is refused the same way.

**Why:** A row lock is simple to read, and it is held only for the short duration of one change. A version number would make clients retry on every collision. Serialisable isolation makes Postgres abort some transactions, and each abort needs a retry. Locking the cart row serialises changes to one cart and leaves every other cart alone. The lock is held by the database, so it holds however many API instances connect.

**Consequences:** Changes to the same cart wait for each other, so a slow change delays the rest. Changes to different carts never wait. Every operation that changes a cart must take the same lock, and a single helper takes it and checks that the cart is still open, so the cart changes and checkout share one definition of an editable cart.

## Decision: Checkout is one transaction

**Context:** A checkout changes several rows: the cart, the stock of each product, the order counter, and the new order with its lines. A failure part way through must not leave some of those changes in place and others out, such as stock taken for an order that was never recorded.

**Options considered:**

1. Run each step as its own statement, and undo the completed steps when a later one fails.
2. Record the order as pending first, confirm it in a later step, and clear abandoned pending orders with a background job.
3. Run every step inside one database transaction, which Postgres commits or rolls back as a unit.

**Choice:** Option 3. Checkout locks the cart row with the same lock cart edits take, checks that the cart is open and not empty, prices the lines at current prices, takes the stock, takes the next order number, inserts the order and its lines, and marks the cart checked out. The transaction commits only when every step has succeeded.

**Why:** Rollback is a guarantee the database already gives, so no step needs its own undo logic. Hand-written undo steps are where partial failures go wrong. A pending state needs a clean-up job and a rule for what customers see while an order is pending. Checks that refuse a cart are run before any stock is touched, so the common refusals change nothing.

**Consequences:** The transaction holds row locks from its first statement until it commits, so nothing inside it may call another service, which would hold those locks for the length of the call. A cart edit that races a checkout either lands first and is part of the order, or waits and is refused with `CART_ALREADY_CHECKED_OUT`. No order can contain a line the cart did not hold when it was checked out.

## Decision: Stock is taken with one conditional update per line

**Context:** Many checkouts can want the same product at once. A checkout that reads the stock, decides there is enough and then writes the reduced level can be overtaken by another checkout that does the same between the read and the write. Both could then take the last units.

**Options considered:**

1. Read the stock level, check it in application code, then write the reduced level.
2. Lock each product row with `SELECT ... FOR UPDATE`, then check and write under the lock.
3. Decrement with one conditional statement per line, `UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2`, and treat a statement that changes no row as a shortage.

**Choice:** Option 3. Checkout issues one conditional update per line, in ascending product identifier order. A line whose update changes no row is short. Checkout does not stop at the first short line. It tries every line, collects each short line with the quantity requested and the quantity available, and then fails the whole checkout. The rollback returns the stock that the earlier lines took.

**Why:** The check and the change are one statement, so no other transaction can act between them. Option 2 is also correct, but it holds the lock across more work and needs a separate read and write. Taking lines in one fixed order means two checkouts that want the same products queue in the same order, which avoids deadlocks. Reporting every short line lets the customer fix the whole cart in one visit instead of discovering the shortages one at a time.

**Consequences:** A refused checkout reads the available quantity for each short line, which is cheap at this scale. The rule is only as strong as the statement that carries it, so the `WHERE stock >= $2` clause is where a reviewer must look. The `CHECK (stock >= 0)` constraint on the column is the backstop: if that clause were ever lost, the update would fail instead of overselling.

## Decision: Order numbers come from a counter row taken last

**Context:** Customers and staff refer to orders by number, so the numbers should run 1, 2, 3 with no gaps. A checkout that fails must not consume a number. The number must be assigned inside the checkout transaction, so it always belongs to the order that is actually stored.

**Options considered:**

1. A Postgres sequence.
2. The highest existing number plus one, read in the same statement that inserts the order.
3. A single counter row, incremented inside the transaction as its last write before the order insert.

**Choice:** Option 3. The counter is one row holding the last number issued. Checkout increments it with `UPDATE ... RETURNING` as the last write before the order insert, so the row stays locked until the checkout commits or rolls back.

**Why:** A sequence never rolls back, so a checkout that fails after drawing a number leaves a gap. Option 2 is racy, because two checkouts can read the same highest number. A counter row incremented inside the transaction rolls back with it, so a failed checkout gives its number back. Taking the number last keeps the lock on the row as short as possible.

**Consequences:** Every checkout that reaches the counter waits for the checkouts ahead of it to commit. That queue is deliberate, and it is why the counter is updated as late as possible. Because the lock lasts until commit, numbers become visible in the order they were issued: a customer never sees order 6 before order 5 exists. The numbers have no gaps while orders are never deleted, which the service does not do.

## Decision: Orders store a snapshot of their lines

**Context:** An order records what the customer agreed to pay. Products can be renamed or repriced later, and an order that read those values from the products table would change with them.

**Options considered:**

1. Store only the product identifier on each order line, and join to the products table to show the name and price.
2. Copy the product name, unit price, quantity and line amount into each order line when the order is placed, and store the subtotal and total with the order.

**Choice:** Option 2. Each order line keeps its product identifier together with the name, unit price, quantity and line amount, and the order keeps its subtotal and total. Reading an order returns these stored values and never recalculates them.

**Why:** A join would show a past order with today's name and price, which is wrong for a record of a payment. Copying the figures costs a little storage and removes the dependency between an order and the catalogue. Storing the totals rather than recomputing them means the order keeps the figures the customer saw at checkout.

**Consequences:** The same name and price appear in many rows, which is intended. A price or name change affects carts from then on and leaves placed orders as they were. The product identifier is kept so a line can still be traced to its product, but it is not used to produce any figure shown on an order.

## Decision: Checkout retries are safe through an idempotency key

**Context:** A client that sends a checkout and then loses the response, through a timeout, a dropped connection or a crash, cannot tell whether the order was placed. A retry that is not protected can place a second order and take the stock again. If the first attempt did succeed, the retry reaches a cart that reads as checked out, so the client gets a 409 with no order to show the customer. Neither outcome can be left to chance.

**Options considered:**

1. Rely on the one-checkout-per-cart rule alone. A retry after success is refused with `CART_ALREADY_CHECKED_OUT`, which is safe, but the refusal carries no order, so the client has to find the order it lost.
2. Record the attempt in its own committed transaction before checkout starts, and update it when checkout finishes. A crash between the two leaves a pending record that needs a clean-up job, and a failed attempt needs its own reconciliation.
3. Claim a client-supplied key as the first step of the checkout transaction, under a unique constraint on the customer and the key. A successful checkout stores its response under the key in the same transaction, and a later attempt with the same key receives that response.
4. Look the key up before checkout and insert it at the end. Two concurrent attempts can both find no record and both proceed, which is the race the database constraints exist to prevent.

**Choice:** Option 3. Every checkout request must carry an `Idempotency-Key` header, and keys are scoped to the customer. The first step of checkout is an insert of the key with `ON CONFLICT (customer_id, idempotency_key) DO NOTHING`. If the insert places a row, the attempt continues. If it does not, the committed record is read. A different request fingerprint is refused with `IDEMPOTENCY_KEY_REUSED` (422), and a matching one replays the stored status and body. The fingerprint is a SHA-256 digest of the canonical JSON of the cart identifier and the checkout options, with defaults applied. Only a successful checkout stores its response, and the stored text is the exact JSON sent, so a replay is byte for byte the same.

**Why:** The claim has to come before the cart lock. If the cart were locked first, a retry of a placed checkout would meet a cart that is already checked out and be refused before it found its own key. The concurrency rests on Postgres, as it does elsewhere in the service. A second insert with the same key waits for the first transaction. If that transaction commits, the insert does nothing and the stored response is read. If it rolls back, the insert succeeds and the second attempt proceeds. This holds however many API instances connect, and needs no application lock.

Storing only successes follows from the transaction. A failed checkout, whether for a short line, an empty cart or a missing cart, leaves the cart open, so the customer can fix it and retry with the same key. A stored 409 would replay a stale refusal for a cart that is now fine. Because the claim is part of the same transaction, the failure rolls it back and frees the key.

The stored body is text, not a re-serialised order, so a replay matches the response the client first received even if the serialiser changes later. The fingerprint covers the cart, so a key reused for a different cart is treated as a client bug rather than replayed. It covers the options as well, so an option added later changes the request identity without any change to the key logic.

**Consequences:** A retry that arrives while the first attempt is still running waits for it, so a slow first attempt also delays its retries. The wait ends when the first attempt commits or rolls back. Requests without the header are refused with `IDEMPOTENCY_KEY_REQUIRED` (400), which breaks any client that does not send one. Keys never expire, so the table gains one row per placed order. A retention window would be a later decision: a retry after the window would place a new order, so the window must outlast any retry a client makes. The key is not a secret that protects the order. The customer header is claimed too, so anyone who knows a customer's identifier can already read that customer's orders. A new key on a checked-out cart is still refused with `CART_ALREADY_CHECKED_OUT`, because the key protects retries of one attempt. The one-checkout-per-cart rule still holds through the cart lock and the unique cart identifier on orders.
