#!/bin/sh
# -----------------------------------------------------------
#  [*] Frontend — regression test runner
#
#  Builds the builder stage of the PRODUCTION Dockerfile (the
#  same node image and npm install that produce dist/) and
#  runs the vitest suite inside a throwaway container — so
#  what gets tested is exactly what ships, and the host needs
#  no node. Exit code is the suite's, so this works in CI.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build --target builder -t veiklos-vite-check .
sudo docker run --rm --name veiklos-vite-tests veiklos-vite-check npx vitest run
