#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Seen backend — Lambda deployment packaging
#
# Canonical entrypoint: index.mjs  ->  AWS Lambda handler must be "index.handler"
#
# index.mjs contains the T-301 routing + Resonance Engine V2 (./resonance.mjs),
# the /match/candidate route, the Expression / QR Gift routes (./gift.mjs), and
# imports ./pushCopy.mjs and ./matchReason.mjs.
#
# Runtime modules imported by index.mjs MUST all be packaged. The set below is
# kept in sync with the `import ... from "./*.mjs"` lines in index.mjs.
#
# reflect-handler.mjs is the LEGACY standalone handler. It is packaged for
# reference/parity only and MUST NEVER overwrite index.mjs. The previous version
# of this script ran `cp reflect-handler.mjs index.mjs`, which silently shipped a
# build with none of the T-301 backend. That overwrite has been removed.
#
# Output package: seen-reflect-proxy.zip (matches the AWS Lambda function name
# `seen-reflect-proxy`, the single integration behind API Gateway `rtbzs3sjwe`).
# Test files (*.test.mjs) are never packaged.
# ---------------------------------------------------------------------------

PACKAGE="seen-reflect-proxy.zip"

echo "1. Cleaning up old zip..."
rm -f "$PACKAGE" function.zip

echo "2. Installing production dependencies..."
npm install --omit=dev

echo "3. Verifying canonical entrypoint (index.mjs)..."
if ! grep -q "export const handler" index.mjs; then
  echo "ERROR: index.mjs does not export a handler — refusing to package." >&2
  exit 1
fi
if ! grep -q "resonance.mjs" index.mjs; then
  echo "ERROR: index.mjs is missing the ./resonance.mjs import (T-301) — likely overwritten. Refusing to package." >&2
  exit 1
fi
if ! grep -q "/match/candidate" index.mjs; then
  echo "ERROR: index.mjs is missing the /match/candidate route — refusing to package." >&2
  exit 1
fi
if ! grep -q 'from "./gift.mjs"' index.mjs; then
  echo "ERROR: index.mjs is missing the ./gift.mjs import (Expression / QR Gift) — refusing to package." >&2
  exit 1
fi
if [ ! -f gift.mjs ]; then
  echo "ERROR: gift.mjs runtime module is missing — refusing to package." >&2
  exit 1
fi

echo "4. Creating zip file (index.mjs stays canonical; no overwrite)..."
# Explicit include list — runtime modules only. *.test.mjs is never listed and
# is additionally excluded via -x as a belt-and-braces guard.
zip -r "$PACKAGE" \
  index.mjs \
  gift.mjs \
  reflect-handler.mjs \
  reflectModes.mjs \
  resonance.mjs \
  matchReason.mjs \
  pushCopy.mjs \
  package.json \
  node_modules/ \
  -x "*.test.mjs" \
  > /dev/null

echo "5. Packaged runtime modules:"
unzip -l "$PACKAGE" | grep -E "\.mjs$|/package.json$" | grep -v "node_modules/" || true

echo
echo "6. Done. Upload $PACKAGE to AWS Lambda function 'seen-reflect-proxy' and ensure the handler is 'index.handler'."
