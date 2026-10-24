#!/usr/bin/env bash
# Executable examples for the API. Each request asserts its expected status and
# prints the response, so a run doubles as a smoke test.
#
#   docker compose up --build
#   ./api/examples.sh
#
# Requires bash, curl and jq. Point BASE_URL elsewhere to target another stack.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080/api}"

# The body of the most recent check, for examples that use a value from it.
LAST_BODY=''

# check EXPECTED_STATUS TITLE CURL_ARGS...
# Runs curl, prints the status and body (pretty-printed when it is JSON), and
# exits non-zero when the status differs from the expected one.
check() {
  local expected="$1"
  local title="$2"
  shift 2

  local response status body
  response="$(curl -sS -w '\n%{http_code}' "$@")"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  LAST_BODY="$body"

  printf '\n== %s\n%s %s\n' "$title" "$*" "→ HTTP $status"
  if printf '%s' "$body" | jq . >/dev/null 2>&1; then
    printf '%s' "$body" | jq .
  else
    printf '%s\n' "$body"
  fi

  if [[ "$status" != "$expected" ]]; then
    printf 'Expected HTTP %s but got %s\n' "$expected" "$status" >&2
    exit 1
  fi
}

# List every product with its unit price in cents and stock. No identity header.
check 200 "List products" "$BASE_URL/products"

# The scarce product: three units in stock at seed time.
printf '\n== The scarce product (limited-hoodie)\n'
curl -sS "$BASE_URL/products" | jq '.products[] | select(.id == "limited-hoodie")'

# A client request identifier is echoed back in the header and in error bodies.
check 400 "Echo a client request identifier in an error" \
  -H 'X-Request-Id: example-request-1' "$BASE_URL/products?colour=red"

# An unknown query parameter is rejected by the contract before any business logic.
check 400 "Reject an unknown query parameter" "$BASE_URL/products?colour=red"

# An unknown route answers with Problem Details, not an HTML page.
check 404 "Unknown route" "$BASE_URL/no-such-resource"

# A body that is not JSON is rejected with MALFORMED_JSON.
check 400 "Reject a malformed JSON body" \
  -X POST -H 'Content-Type: application/json' --data '{"name":' "$BASE_URL/products"

# Carts. A cart belongs to the customer named in the X-Customer-Id header. The
# identifier is claimed, not verified: anyone can send any identifier. It is a
# business rule of this service, not a security control.
ALICE=(-H 'X-Customer-Id: example-alice')
BOB=(-H 'X-Customer-Id: example-bob')
JSON_TYPE=(-H 'Content-Type: application/json')

# A cart operation that does not name the customer is refused before any business logic runs.
check 400 "Refuse a cart request without the customer header" -X POST "$BASE_URL/carts"

# Create an empty cart for alice and keep its identifier for the requests below.
check 201 "Create an empty cart for alice" -X POST "${ALICE[@]}" "$BASE_URL/carts"
CART_ID="$(printf '%s' "$LAST_BODY" | jq -r '.id')"

# Setting a quantity creates the line. Setting the same quantity again leaves the cart unchanged.
check 200 "Set two ceramic mugs in alice's cart" \
  -X PUT "${ALICE[@]}" "${JSON_TYPE[@]}" --data '{"quantity":2}' "$BASE_URL/carts/$CART_ID/lines/ceramic-mug"
check 200 "Repeat the same request: the cart is unchanged" \
  -X PUT "${ALICE[@]}" "${JSON_TYPE[@]}" --data '{"quantity":2}' "$BASE_URL/carts/$CART_ID/lines/ceramic-mug"

# A quantity replaces the earlier one rather than adding to it: still one line, now three mugs.
check 200 "Replace the quantity with three" \
  -X PUT "${ALICE[@]}" "${JSON_TYPE[@]}" --data '{"quantity":3}' "$BASE_URL/carts/$CART_ID/lines/ceramic-mug"

# The cart shows each line's current unit price and amount, the subtotal and the line count.
check 200 "View alice's cart" -X GET "${ALICE[@]}" "$BASE_URL/carts/$CART_ID"

# Another customer's cart is answered as not found, exactly as a missing cart is.
check 404 "Bob cannot see alice's cart" -X GET "${BOB[@]}" "$BASE_URL/carts/$CART_ID"

# Quantities are whole numbers from 1 to 99.
check 400 "Reject a quantity of zero" \
  -X PUT "${ALICE[@]}" "${JSON_TYPE[@]}" --data '{"quantity":0}' "$BASE_URL/carts/$CART_ID/lines/ceramic-mug"

# An unknown product is not found.
check 404 "Reject an unknown product" \
  -X PUT "${ALICE[@]}" "${JSON_TYPE[@]}" --data '{"quantity":1}' "$BASE_URL/carts/$CART_ID/lines/no-such-product"

# The scarce product has three units in stock. Asking for four is refused, and the body names the available quantity.
check 409 "Reject a quantity above stock" \
  -X PUT "${ALICE[@]}" "${JSON_TYPE[@]}" --data '{"quantity":4}' "$BASE_URL/carts/$CART_ID/lines/limited-hoodie"

# Removing a line returns the cart without it. Removing it again succeeds.
check 200 "Remove the mugs from alice's cart" \
  -X DELETE "${ALICE[@]}" "$BASE_URL/carts/$CART_ID/lines/ceramic-mug"
check 200 "Removing a line that is already gone succeeds" \
  -X DELETE "${ALICE[@]}" "$BASE_URL/carts/$CART_ID/lines/ceramic-mug"

# Checkout. Every checkout below takes stock and assigns order numbers, so run
# this section against a freshly started stack; the scarce-product part expects
# the seeded three hoodies to be unsold.
CAROL=(-H 'X-Customer-Id: example-carol')
DAN=(-H 'X-Customer-Id: example-dan')

# Carol's cart: two canvas totes and a notebook set, each at its current price.
check 201 "Create a cart for carol" -X POST "${CAROL[@]}" "$BASE_URL/carts"
TOTE_CART="$(printf '%s' "$LAST_BODY" | jq -r '.id')"
check 200 "Carol sets two canvas totes" \
  -X PUT "${CAROL[@]}" "${JSON_TYPE[@]}" --data '{"quantity":2}' "$BASE_URL/carts/$TOTE_CART/lines/canvas-tote"
check 200 "Carol adds a notebook set" \
  -X PUT "${CAROL[@]}" "${JSON_TYPE[@]}" --data '{"quantity":1}' "$BASE_URL/carts/$TOTE_CART/lines/notebook-set"

# Checkout places the order in one transaction and returns it: the order number,
# each line with the product name and unit price as they are at checkout, and the
# subtotal and total.
check 201 "Carol checks out her cart" -X POST "${CAROL[@]}" "$BASE_URL/carts/$TOTE_CART/checkout"
ORDER_ID="$(printf '%s' "$LAST_BODY" | jq -r '.id')"

# The cart is now checked out, so it cannot be changed or checked out again.
check 409 "Checking out the same cart again is refused" -X POST "${CAROL[@]}" "$BASE_URL/carts/$TOTE_CART/checkout"
check 409 "Changing a checked-out cart is refused" \
  -X PUT "${CAROL[@]}" "${JSON_TYPE[@]}" --data '{"quantity":3}' "$BASE_URL/carts/$TOTE_CART/lines/canvas-tote"

# An empty cart has nothing to order.
check 201 "Create an empty cart for carol" -X POST "${CAROL[@]}" "$BASE_URL/carts"
EMPTY_CART="$(printf '%s' "$LAST_BODY" | jq -r '.id')"
check 422 "Checking out an empty cart is refused" -X POST "${CAROL[@]}" "$BASE_URL/carts/$EMPTY_CART/checkout"

# The order is a snapshot of the checkout, and the stock taken for it is gone from the catalogue.
check 200 "Carol views her order" -X GET "${CAROL[@]}" "$BASE_URL/orders/$ORDER_ID"
check 200 "Carol lists her orders, oldest first" -X GET "${CAROL[@]}" "$BASE_URL/orders"
check 200 "Read the catalogue after the order" -X GET "$BASE_URL/products"
printf '%s' "$LAST_BODY" | jq '.products[] | select(.id == "canvas-tote") | {id, stock}'

# Another customer cannot see carol's order: it is answered as not found, exactly as a missing order is.
check 404 "Dan cannot see carol's order" -X GET "${DAN[@]}" "$BASE_URL/orders/$ORDER_ID"

# Conditional stock updates. Dan and Carol both set all three hoodies: stock is
# only checked when a line is set, so both lines are accepted. Carol checks out
# first and takes the stock, so Dan's checkout is refused and the body names the
# short line with the quantity he asked for and the stock left (zero).
check 201 "Create a cart for carol with the scarce hoodies" -X POST "${CAROL[@]}" "$BASE_URL/carts"
HOODIE_CAROL="$(printf '%s' "$LAST_BODY" | jq -r '.id')"
check 200 "Carol sets all three hoodies" \
  -X PUT "${CAROL[@]}" "${JSON_TYPE[@]}" --data '{"quantity":3}' "$BASE_URL/carts/$HOODIE_CAROL/lines/limited-hoodie"
check 201 "Dan creates a cart" -X POST "${DAN[@]}" "$BASE_URL/carts"
HOODIE_DAN="$(printf '%s' "$LAST_BODY" | jq -r '.id')"
check 200 "Dan also sets three hoodies: the line is accepted while stock remains" \
  -X PUT "${DAN[@]}" "${JSON_TYPE[@]}" --data '{"quantity":3}' "$BASE_URL/carts/$HOODIE_DAN/lines/limited-hoodie"
check 201 "Carol checks out first and takes the three hoodies" \
  -X POST "${CAROL[@]}" "$BASE_URL/carts/$HOODIE_CAROL/checkout"
check 409 "Dan's checkout is refused, and every short line is listed" \
  -X POST "${DAN[@]}" "$BASE_URL/carts/$HOODIE_DAN/checkout"
check 200 "Dan's cart is still open after the refusal" -X GET "${DAN[@]}" "$BASE_URL/carts/$HOODIE_DAN"

# Coupons. Every fifth order reaches a milestone (COUPON_EVERY_N_ORDERS, default 5), and an
# administrator generates the coupon for it. The section assumes the default of five and a freshly
# started stack: the orders placed above are numbers 1 and 2, and the orders below are 3 to 5.
#
# The admin key is a placeholder that keeps admin operations out of ordinary use. It is not
# security: anyone who knows it can issue coupons. ADMIN_KEY sets it; the default matches the README.
ADMIN=(-H "X-Admin-Key: ${ADMIN_KEY:-local-admin-key}")
GRACE=(-H 'X-Customer-Id: example-grace')

# assert_body FILTER...: fails the script unless the last response body satisfies the jq filter.
assert_body() {
  if ! printf '%s' "$LAST_BODY" | jq -e "$@" >/dev/null; then
    printf 'The response does not match %s\n' "$*" >&2
    exit 1
  fi
}

# place_order CUSTOMER_ID: a cart with one notebook set, checked out. Each call places one order.
place_order() {
  local customer="$1" cart
  check 201 "$customer creates a cart" -X POST -H "X-Customer-Id: $customer" "$BASE_URL/carts"
  cart="$(printf '%s' "$LAST_BODY" | jq -r '.id')"
  check 200 "$customer sets one notebook set" \
    -X PUT -H "X-Customer-Id: $customer" "${JSON_TYPE[@]}" --data '{"quantity":1}' \
    "$BASE_URL/carts/$cart/lines/notebook-set"
  check 201 "$customer checks out" -X POST -H "X-Customer-Id: $customer" "$BASE_URL/carts/$cart/checkout"
}

# The admin key is required. A missing key and a wrong one are refused the same way.
check 401 "Generating a coupon without the admin key is refused" -X POST "$BASE_URL/admin/coupons"
check 401 "Generating a coupon with a wrong admin key is refused" \
  -X POST -H 'X-Admin-Key: not-the-key' "$BASE_URL/admin/coupons"

# Orders 3 and 4 do not reach a milestone, so there is nothing to reward yet.
place_order example-erin
place_order example-frank
check 409 "With four orders no milestone is reached, so no coupon can be generated" \
  -X POST "${ADMIN[@]}" "$BASE_URL/admin/coupons"

# Order 5 reaches milestone 1. Its customer, Grace, is the one the coupon is issued to.
place_order example-grace
check 201 "The administrator generates the coupon for milestone 1" -X POST "${ADMIN[@]}" "$BASE_URL/admin/coupons"
assert_body '.customerId == "example-grace" and .coupon.milestone == 1 and .coupon.percentOff == 10 and .unrewardedMilestonesRemaining == 0'
COUPON="$(printf '%s' "$LAST_BODY" | jq -r '.coupon.code')"

# The milestone is rewarded, so a second generate has nothing to issue.
check 409 "A second generate is refused: no unrewarded milestone is left" -X POST "${ADMIN[@]}" "$BASE_URL/admin/coupons"

# A coupon belongs to the customer who placed the milestone order. Grace sees hers, unredeemed, and
# Carol, whose orders were not milestones, sees none.
check 200 "Grace lists her coupons" "${GRACE[@]}" "$BASE_URL/coupons"
assert_body --arg code "$COUPON" '.coupons | length == 1 and .[0].code == $code and .[0].redeemed == false'
check 200 "Carol lists her coupons and sees none" "${CAROL[@]}" "$BASE_URL/coupons"
assert_body '.coupons == []'

# The administrator lists every coupon with the customer it was issued to.
check 200 "The administrator lists all coupons" "${ADMIN[@]}" "$BASE_URL/admin/coupons"
assert_body --arg code "$COUPON" '[.coupons[] | select(.code == $code) | .customerId] == ["example-grace"]'
