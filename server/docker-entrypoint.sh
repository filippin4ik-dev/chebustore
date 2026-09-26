#!/bin/sh
set -e
./node_modules/.bin/prisma migrate deploy
node dist/scripts/seed.js
exec node --enable-source-maps dist/index.js
