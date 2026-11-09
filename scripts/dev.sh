#!/usr/bin/env bash
# Local dev: server on :8787, client on :5173 (also reachable from phone in the same Wi-Fi)
cd "$(dirname "$0")/.."
(cd server && npx wrangler dev --port 8787) &
SERVER=$!
trap "kill $SERVER 2>/dev/null" EXIT
cd client && npx vite --port 5173
