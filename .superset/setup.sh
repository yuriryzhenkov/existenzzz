#!/usr/bin/env bash
set -e
(cd client && npm ci --silent)
(cd server && npm ci --silent)
echo "existenzzz: deps installed"
