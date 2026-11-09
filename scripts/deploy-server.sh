#!/usr/bin/env bash
# Deploy the Cloudflare Worker (multiplayer + storage). Client deploys automatically on push to main.
set -e
cd "$(dirname "$0")/../server" && npx wrangler deploy
