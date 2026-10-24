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
