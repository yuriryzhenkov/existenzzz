#!/usr/bin/env bash
# Usage: ./scripts/set-telegram-bot.sh <BOT_TOKEN> <bot_username_without_@>
# Before: in @BotFather send /setdomain -> choose bot -> yuriryzhenkov.github.io
set -e
TOKEN="$1"; NAME="${2#@}"
if [ -z "$TOKEN" ] || [ -z "$NAME" ]; then echo "usage: $0 <token> <bot_username>"; exit 1; fi
cd "$(dirname "$0")/../server"
printf '%s' "$TOKEN" | npx wrangler secret put BOT_TOKEN
sed -i.bak "s/^BOT_USERNAME = .*/BOT_USERNAME = \"$NAME\"/" wrangler.toml && rm -f wrangler.toml.bak
npx wrangler deploy
echo "Done. Telegram login is live: https://yuriryzhenkov.github.io/existenzzz/"
