# Checkout and Rewards

A backend for an ecommerce store where customers keep carts and check out, and every nth placed order earns the customer who placed it a single-use discount coupon. The service is a TypeScript API on Postgres, with a small React app for trying it by hand.

The API currently serves the product listing, customers' carts, and checkout with order viewing. The rest of the contract is added to `api/openapi.yaml` as each operation lands, and that file is the authoritative description of every endpoint, status code and error code.

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

The defaults are public development credentials. Compose and CI set their own values.

## Contract and executable examples

- `api/openapi.yaml` is the OpenAPI 3.0 document. Every request and response is validated against it at runtime, and the web app's API types are generated from it.
- `api/examples.sh` exercises the API with `curl` and `jq` against a running stack and fails if a response status differs from the expected one:

  ```sh
  docker compose up --build -d
  ./api/examples.sh
  ```

  Set `BASE_URL` to target another stack (default `http://localhost:8080/api`). The checkout section takes stock and places orders, so run the script once against a freshly started stack.

## Carts and customer identity

Cart operations name the customer in the `X-Customer-Id` header, a value of 1 to 128 letters, digits, `.`, `_`, `:` or `-`. A request without the header, or with a blank one, is refused with `CUSTOMER_ID_REQUIRED`. The identifier is claimed, not verified: any caller can send any identifier. It keeps one customer's carts out of another's view in normal use, and it is not a security control.

A cart line is set to a quantity, not added to. `PUT /api/carts/{cartId}/lines/{productId}` with `{"quantity": 2}` creates or replaces the line, so sending the same request again changes nothing. Quantities run from 1 to 99, and `DELETE` on the same path removes the line. Carts store no prices: every read shows the product's current unit price. Setting a line checks the requested quantity against stock but does not reduce stock.

## Checkout and orders

`POST /api/carts/{cartId}/checkout` places the cart's order and returns it with status 201. Checkout runs in one database transaction that either places the whole order or changes nothing: it locks the cart, prices the lines at current prices, takes stock with one conditional update per line, takes the next order number, and records the order and its lines.

Every checkout request must send an `Idempotency-Key` header, 1 to 128 letters, digits, `.`, `_`, `:` or `-`, that names one attempt. A retry with the same key and the same request returns the first attempt's response, byte for byte, and places no second order. Reusing the key for a different cart is refused with `IDEMPOTENCY_KEY_REUSED`. A request without the header is refused with `IDEMPOTENCY_KEY_REQUIRED`. Only a successful checkout is remembered: a checkout that fails, for example with `INSUFFICIENT_STOCK` or `CART_EMPTY`, stores nothing, so the same key works again once the cart is fixed.

If any line is short, the response is `409 INSUFFICIENT_STOCK`, and its `shortLines` list every short line with the quantity requested and the quantity available. A failed checkout takes no order number, so numbers run 1, 2, 3 with no gaps. A cart is checked out once: a second attempt, or a change to the cart afterwards, is refused with `CART_ALREADY_CHECKED_OUT`.

An order keeps the names, unit prices and totals it had when it was placed, so later price or name changes do not alter it. `GET /api/orders` lists the calling customer's orders, and `GET /api/orders/{orderId}` returns one. An order that belongs to another customer is reported as `ORDER_NOT_FOUND`, the same as an order that does not exist.

## Errors and request identifiers

Every response carries an `X-Request-Id` header. Send your own identifier to correlate a call with the server logs: it is echoed back if it is 1 to 128 characters of letters, digits, `.`, `_`, `:` or `-`. Otherwise the service generates one.

Errors are RFC 9457 Problem Details (`application/problem+json`). Each carries a stable `code` to branch on, and the `requestId`, which is the same value as the header. The `title` and `detail` are for people and may change between releases.

Logs are one JSON object per line. Every line written for a request carries that request's `requestId`.

## Layout

- `api/` is the Express 5 service. `src/` holds the application factory, the HTTP layer (request context, contract validation, Problem Details mapping), feature modules and the database code. `migrations/` holds plain SQL files. `test/` holds the unit and integration tests. `openapi.yaml` is the contract and `examples.sh` the executable examples.
- `web/` is the React and Vite app, with `nginx.conf` for the Compose image.
- `docker-compose.yml` runs the whole stack.
- `.github/workflows/ci.yml` runs type checks, lint and both test projects against a Postgres 18 service on every push.
- `DECISIONS.md` records the material design decisions, the options considered and their trade-offs.
