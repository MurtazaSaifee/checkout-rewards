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

**Consequences:** Clients can write one handler per status class. Today the service uses only 400, 404 (unknown routes) and 500; the other codes apply as the operations that need them land. Every new error must be assigned one of these meanings, and the contract's description states the rule so a reviewer can check it. The boundary between 409 and 422 takes judgement, and the rule is written down so that judgement is applied the same way each time.
