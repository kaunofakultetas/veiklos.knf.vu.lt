#!/bin/sh
# -----------------------------------------------------------
#  [*] Backend — regression test runner
#
#  Builds the PRODUCTION image (same tag docker-compose
#  deploys) and runs the suite inside a throwaway --rm
#  container — so what gets tested is exactly what ships.
#  The runner invokes node's test runner directly because
#  package.json carries no test script. Exit code is the
#  suite's, so this works in CI.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build -t veiklos-backend .
sudo docker run --rm --name veiklos-backend-tests veiklos-backend \
    node --experimental-test-module-mocks --test tests/
