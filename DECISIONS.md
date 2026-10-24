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
