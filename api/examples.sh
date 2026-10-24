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
