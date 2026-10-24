# Checkout and Rewards

[![CI](https://github.com/MurtazaSaifee/checkout-rewards/actions/workflows/ci.yml/badge.svg)](https://github.com/MurtazaSaifee/checkout-rewards/actions/workflows/ci.yml)

A backend for an ecommerce store where customers keep carts and check out, and every nth placed order earns the customer who placed it a single-use discount coupon. The service is a TypeScript API on Postgres, with a small React app for trying it by hand.

The API serves the product listing, customers' carts, checkout with order viewing, and coupons. `api/openapi.yaml` is the authoritative description of every endpoint, status code and error code.

## Scope and limits

The service covers the product listing, carts, checkout, orders, coupons, and the administrator's report. The rules that overlapping requests could break are enforced in the database, and `DECISIONS.md` explains the design.

These are not built:

- Authentication. Customers are identified by a header they send, and the admin key is a shared placeholder.
- A real payment provider. The gateway is an in-process fake, and checkout does not use two-phase payment.
- Endpoints for editing products. Prices and stock change in the database, as shown below.
- Coupon expiry, stacking several coupons on one order, and changing the milestone interval or the coupon percentage while the service runs.
- Stock holds for carts, cleanup of abandoned carts, expiry of idempotency keys, and cancellation or refunds.
- Metrics, tracing, dashboards and a production deployment. Compose runs the stack locally.
- Frontend tests and visual polish, multiple currencies, and taxes.

Known gaps in the current code are listed in `DECISIONS.md` until they are fixed.

## Time spent

About five hours in total, approximately: about 1.5 hours of planning (08:30 to about 10:00 IST), about 2.5 hours of implementation (10:00 to about 12:30 IST, with each branch reviewed before it was merged), and the remainder on a final review and fix pass. Times are local, on 24 October 2026.

## Quick start

You need Docker. From a clean checkout:

```sh
docker compose up --build
```

This starts Postgres, the API and the built web app.

- Web app: http://localhost:8080
- API through the web app: http://localhost:8080/api/products
- API directly: http://localhost:3000/api/products

On the first start the service applies the migrations and seeds six products, one of which (`limited-hoodie`) has three units in stock. Migrations and seeding run on every start and are safe to repeat: a restart never duplicates a product and never resets stock that has changed.

Stop the stack with `docker compose down`. Add `-v` to also drop the database volume and start again from the seed data.

### Changing a product by hand

There are no endpoints for editing products. To change a price or stock level, update the row directly:

```sh
docker compose exec db psql -U postgres -d checkout_rewards \
  -c "UPDATE products SET stock = 3, unit_price_cents = 1200 WHERE id = 'ceramic-mug';"
```

Prices are integer cents. Stock cannot go below zero: the database rejects such a change.

Two checkout refusals can be triggered this way, and each refusal changes nothing:

- `PRICE_CHANGED`: read a cart's subtotal, change a price in the database, then check the cart out with that subtotal as the expected total. The checkout is refused and names the new total.
- `INSUFFICIENT_STOCK`: set a cart line, then lower the stock of that product below the quantity in the cart. The checkout is refused and lists the short line.

For example, if alice's cart holds two `canvas-tote` at 1800 cents, its subtotal is 3600. After this change, checking out with `{"expectedTotalCents": 3600}` is answered `409 PRICE_CHANGED` with `currentTotalCents` 4000:

```sh
docker compose exec db psql -U postgres -d checkout_rewards \
  -c "UPDATE products SET unit_price_cents = 2000 WHERE id = 'canvas-tote';"
```

In the web app, add products to a cart, change the price the same way, and press Check out: the panel shows the new total.

## Running the tests

You need Node.js 22.12 or later (CI uses 24) and a Postgres server that the tests can create databases on. Each integration test file creates its own uniquely named database, applies the migrations and seed data, and drops the database afterwards, so the files run in parallel against one server.

```sh
npm ci
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

`TEST_DATABASE_URL` is an administrative connection, so its role needs permission to create and drop databases. It defaults to the URL above.

The other checks run the same way as CI:

```sh
npm run typecheck   # both workspaces; regenerates the web app's API types first
npm run lint
```

## Running the services without Docker

Start a Postgres server, then in two terminals:

```sh
npm ci
DATABASE_URL=postgres://postgres:postgres@localhost:5432/checkout_rewards npm run dev -w api
npm run dev -w web
```

The web dev server runs on http://localhost:5173 and forwards `/api` to the API on port 3000.

## Configuration

Settings are read once at startup. An invalid value stops the service before it accepts traffic.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port the API listens on. |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/checkout_rewards` | Connection string for the service database. |
| `LOG_LEVEL` | `info` | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `API_ORIGIN` | `http://localhost:3000` | Web dev server only: where `/api` is forwarded. |
| `TEST_DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/postgres` | Tests only: server on which per-file test databases are created. |
| `ADMIN_KEY` | `local-admin-key` | Shared key that administrative requests send in the `X-Admin-Key` header. A public placeholder, not sign-in. |
| `COUPON_EVERY_N_ORDERS` | `5` | Every nth placed order is a milestone and earns a coupon. A whole number from 1 up to 2147483647. |
| `COUPON_PERCENT_OFF` | `10` | Percentage off each coupon, a whole number from 1 to 100. |

The defaults are public development values. Compose sets its own `DATABASE_URL` and keeps the defaults for the admin key and coupon settings, so a deployment that others can reach should set its own `ADMIN_KEY`.

## Contract and executable examples

- `api/openapi.yaml` is the OpenAPI 3.0 document. Every request and response is validated against it at runtime, and the web app's API types are generated from it.
- `api/examples.sh` exercises the API with `curl` and `jq` against a running stack and fails if a response status differs from the expected one:

  ```sh
  docker compose up --build -d
  ./api/examples.sh
  ```

  Set `BASE_URL` to target another stack (default `http://localhost:8080/api`). The checkout and coupon sections take stock and place orders, and the coupon section assumes the default `COUPON_EVERY_N_ORDERS` of 5. Run the script once against a freshly started stack with default settings, and set `ADMIN_KEY` if that stack uses another admin key.

## Who may call what

Most operations act for one customer, who is named in the `X-Customer-Id` header. These are creating and reading carts, setting and removing cart lines, checkout, the customer's orders (`GET /api/orders` and `GET /api/orders/{orderId}`), and the customer's coupons (`GET /api/coupons`).

Four operations are administrative and take the `X-Admin-Key` header instead: `GET` and `POST /api/admin/coupons`, `GET /api/admin/orders` and `GET /api/admin/report`. A missing or wrong key is refused with `401 ADMIN_KEY_INVALID`.

`GET /api/products` is public and needs neither header. Both headers are placeholders for real authentication; see [Scope and limits](#scope-and-limits).

## Carts and customer identity

Cart operations name the customer in the `X-Customer-Id` header, a value of 1 to 128 letters, digits, `.`, `_`, `:` or `-`. A request without the header, or with a blank one, is refused with `CUSTOMER_ID_REQUIRED`. The identifier is claimed, not verified: any caller can send any identifier. It keeps one customer's carts out of another's view in normal use, and it is not a security control.

A cart line is set to a quantity, not added to. `PUT /api/carts/{cartId}/lines/{productId}` with `{"quantity": 2}` creates or replaces the line, so sending the same request again changes nothing. Quantities run from 1 to 99, and `DELETE` on the same path removes the line. Carts store no prices: every read shows the product's current unit price. Setting a line checks the requested quantity against stock but does not reduce stock.

## Checkout and orders

`POST /api/carts/{cartId}/checkout` places the cart's order and returns it with status 201. Checkout runs in one database transaction that either places the whole order or changes nothing: it locks the cart, prices the lines at current prices, takes stock with one conditional update per line, takes the next order number, and records the order and its lines.

Every checkout request must send an `Idempotency-Key` header, 1 to 128 letters, digits, `.`, `_`, `:` or `-`, that names one attempt. A retry with the same key and the same request returns the first attempt's response, byte for byte, and places no second order. Reusing the key for a different request, such as another cart or other checkout options, is refused with `IDEMPOTENCY_KEY_REUSED`. A request without the header is refused with `IDEMPOTENCY_KEY_REQUIRED`. Only a successful checkout is remembered: a checkout that fails, for example with `INSUFFICIENT_STOCK` or `CART_EMPTY`, stores nothing, so the same key works again once the cart is fixed.

If any line is short, the response is `409 INSUFFICIENT_STOCK`, and its `shortLines` list every short line with the quantity requested and the quantity available. A failed checkout takes no order number, so numbers run 1, 2, 3 with no gaps.

The checkout body may also carry `expectedTotalCents`, the total the customer saw. When the total at current prices differs from it, the checkout is refused with `409 PRICE_CHANGED`, and `currentTotalCents` gives the total now. Nothing is placed, and the cart stays open, so the same cart can be checked out again at the new total. Leave the field out to check out at current prices. The web app sends the subtotal when no coupon is named, and the discounted total when the named coupon is one it lists as unredeemed. A cart is checked out once: a second attempt, or a change to the cart afterwards, is refused with `CART_ALREADY_CHECKED_OUT`.

The checkout body may name a `paymentToken`. `tok_ok`, the default, approves the charge, and `tok_decline` declines it, which is answered `402 PAYMENT_DECLINED`. The payment gateway is an in-process fake that moves no money, so the token alone decides the outcome. A declined checkout changes nothing, like any refused checkout: stock, the cart and the order numbers are as they were, and the same cart can be checked out again.

An order keeps the names, unit prices and totals it had when it was placed, so later price or name changes do not alter it. `GET /api/orders` lists the calling customer's orders, and `GET /api/orders/{orderId}` returns one. An order that belongs to another customer is reported as `ORDER_NOT_FOUND`, the same as an order that does not exist.

## Coupons

Every nth placed order is a milestone. With the default interval of 5, the fifth, tenth and fifteenth orders are milestones, and each milestone earns its customer one coupon. An administrator generates the coupon, and it is issued to the customer who placed the milestone order.

Generation issues one coupon per call, for the oldest milestone that has none. The response gives the coupon's code, its percentage off and its milestone, the customer it was issued to, and how many reached milestones are still waiting:

```sh
curl -X POST -H 'X-Admin-Key: local-admin-key' http://localhost:3000/api/admin/coupons
```

When no reached milestone is waiting, the call is refused with `409 NO_ELIGIBLE_MILESTONE`. The administrator lists every coupon with `GET /api/admin/coupons`, and a customer lists their own with `GET /api/coupons`.

The admin key is a shared placeholder, not sign-in. Anyone who holds it can issue coupons. The web app's administration panel asks for it and keeps it only until the page is reloaded.

Coupons are issued and listed, and they do not expire. Each coupon keeps the percentage that was in force when it was issued.

### Applying a coupon at checkout

The checkout body may name one of the customer's coupons by its code, in `couponCode`. The discount is the coupon's percentage of the subtotal, rounded down to a whole cent and taken once. Amounts are whole cents throughout, so 10% of 1,995 cents is 199 cents, and the total is the subtotal less the discount. The order records the coupon's code and percentage, the discount and the total. A checkout takes at most one coupon.

The discount is worked out on the subtotal, not line by line, so two lines of 995 cents at 10% give a discount of 199 cents. A checkout that also sends `expectedTotalCents` is checked against the discounted total, which is the total the customer sees.

```sh
curl -X POST -H 'X-Customer-Id: alice' -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  --data "{\"couponCode\":\"$COUPON\"}" http://localhost:3000/api/carts/$CART_ID/checkout
```

A coupon that is not the customer's is refused. `COUPON_NOT_FOUND` means no coupon has the code, and `COUPON_NOT_OWNED` means it was issued to another customer. A coupon that is already on an order is refused with `COUPON_ALREADY_REDEEMED`. Each of these is `422`, and nothing is placed.

A coupon is redeemed only by a placed order. A checkout that fails for any reason, including a declined payment, leaves the coupon unredeemed. When two checkouts name the same coupon at the same moment, one places its order and the other is refused with `COUPON_ALREADY_REDEEMED`, and its cart stays open.

The web app has a coupon field at checkout, and shows the coupon and discount on the order. Its coupon race tool redeems one of the customer's coupons from several carts at once and summarises the outcomes.

## Admin report and orders

`GET /api/admin/orders` lists every placed order, oldest first, with the customer it belongs to, its lines and its totals. `GET /api/admin/report` summarises the store: orders placed, units sold of each product, gross revenue, discounts, net revenue, coupons generated, redeemed and still available, and milestones reached without a coupon. Both need the admin key, and neither changes anything:

```sh
curl -H 'X-Admin-Key: local-admin-key' http://localhost:3000/api/admin/report
```

The report is calculated from the orders and coupons each time it is requested. Nothing is stored, so it reflects the store at the moment it is read, and it agrees with the lists read at that moment. Money is whole cents, and net revenue is gross revenue less discounts. `DECISIONS.md` explains why the report is calculated this way.

## Errors and request identifiers

Every response carries an `X-Request-Id` header. Send your own identifier to correlate a call with the server logs: it is echoed back if it is 1 to 128 characters of letters, digits, `.`, `_`, `:` or `-`. Otherwise the service generates one.

Errors are RFC 9457 Problem Details (`application/problem+json`). Each carries a stable `code` to branch on, and the `requestId`, which is the same value as the header. The `title` and `detail` are for people and may change between releases.

Logs are one JSON object per line. Every line written for a request carries that request's `requestId`.

## Layout

- `api/` is the Express 5 service. `src/` holds the application factory, the HTTP layer (request context, contract validation, Problem Details mapping), feature modules and the database code. `migrations/` holds plain SQL files. `test/` holds the unit and integration tests. `openapi.yaml` is the contract and `examples.sh` the executable examples.
- `web/` is the React and Vite app, with `nginx.conf` for the Compose image.
- `docker-compose.yml` runs the whole stack.
- `.github/workflows/ci.yml` runs type checks, lint and both test projects against a Postgres 18 service on every push and pull request.
- `DECISIONS.md` records the material design decisions, the options considered and their trade-offs.
