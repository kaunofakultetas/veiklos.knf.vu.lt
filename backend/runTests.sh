#!/bin/sh
# -----------------------------------------------------------
#  [*] Backend — regression test runner
#
#  Builds the PRODUCTION image (same tag docker-compose
#  deploys) and runs the suite inside a throwaway --rm
#  container — so what gets tested is exactly what ships.
#  The runner invokes node's test runner directly (same
#  command as package.json's test script). The glob is quoted
#  so node expands it itself — since Node 22 a bare directory
#  is no longer a valid test pattern. Exit code is the
#  suite's, so this works in CI. The repo's postgres/ dir is
#  mounted read-only so tests/schema.test.js can check the
#  routes' SQL against init.sql.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build -t veiklos-backend .
sudo docker run --rm --name veiklos-backend-tests \
    -v "$PWD/../postgres:/app/postgres:ro" \
    veiklos-backend \
    node --experimental-test-module-mocks --test 'tests/**/*.test.js'
