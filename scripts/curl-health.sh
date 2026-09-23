#!/usr/bin/env bash
# Phase 1 proof: the app boots and can reach the database.
# Usage: npm run dev (in one terminal), then in another: bash scripts/curl-health.sh
set -euo pipefail

URL="${1:-http://localhost:3000}/api/health"
echo "GET $URL"
curl -sS "$URL"
echo
